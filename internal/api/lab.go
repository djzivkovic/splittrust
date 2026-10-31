package api

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"net"
	"net/http"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/miekg/dns"
)

// LabProbe is one live check of a lab component, run from the app container.
type LabProbe struct {
	Name   string `json:"name"`
	Role   string `json:"role"`
	Addr   string `json:"addr"`
	Kind   string `json:"kind"` // dns, dot, http, https, control
	OK     bool   `json:"ok"`
	Millis int64  `json:"millis"`
	Detail string `json:"detail,omitempty"`
}

type labTarget struct {
	name, role, addr, kind, serverName, qname string
}

// The lab as the console knows it. Addresses match lab/compose.yaml.
var labTargets = []labTarget{
	{"public-dns", "BIND: private root, lab TLD, 7 signed zones", "172.30.97.10:53", "dns", "", "lab."},
	{"local-dot", "CoreDNS: office resolvers (DoT)", "172.30.97.20:853", "dot", "dns.splittrust.zivkovic.me", "internal.splittrust.zivkovic.me."},
	{"local-dot :53", "CoreDNS: Beta's plain office resolver", "172.30.97.20:53", "dns", "", "intranet.beta.example."},
	{"hotel-dot", "CoreDNS: the hotel's resolver (DoT, honest view)", "172.30.97.21:853", "dot", "dns.hotel.lab", "zivkovic.me."},
	{"hotel-dot :8853", "CoreDNS: the hotel's forging view", "172.30.97.21:8853", "dot", "dns.hotel.lab", "zivkovic.me."},
	{"hotel-dot :53", "CoreDNS: plain DNS for guests", "172.30.97.21:53", "dns", "", "intranet.beta.example."},
	{"pvd", "nginx: PvD documents (HTTPS)", "172.30.97.30:443", "https", "pvd.splittrust.zivkovic.me", ""},
	{"external", "unbound: quad9.lab (DoT)", "172.30.97.40:853", "dot", "quad9.lab", "lab."},
	{"proxy", "splittrust proxy: the client's DNS server", "172.30.97.60:53", "dns", "", "lab."},
	{"proxy control", "splittrust proxy: control API", "172.30.97.60:8001", "control", "", ""},
	{"intranet", "nginx: Alfa's intranet", "172.30.97.70:80", "http", "host.internal.splittrust.zivkovic.me", ""},
	{"beta-intranet", "nginx: Beta's intranet", "172.30.97.71:80", "http", "intranet.beta.example", ""},
	{"fake-bank", "nginx: the hotel's page", "172.30.97.66:80", "http", "www.zivkovic.me", ""},
	{"bank", "nginx: www.banka.lab", "172.30.97.80:80", "http", "www.banka.lab", ""},
}

// labStatus probes every lab component in parallel.
func (h *handler) labStatus(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 6*time.Second)
	defer cancel()
	roots := labRoots()
	out := make([]LabProbe, len(labTargets))
	var wg sync.WaitGroup
	for i, t := range labTargets {
		wg.Add(1)
		go func(i int, t labTarget) {
			defer wg.Done()
			out[i] = probe(ctx, t, roots)
		}(i, t)
	}
	wg.Wait()
	writeJSON(w, http.StatusOK, map[string]any{"checked_at": time.Now().UTC(), "probes": out})
}

func labRoots() *x509.CertPool {
	pool, _ := x509.SystemCertPool()
	if pool == nil {
		pool = x509.NewCertPool()
	}
	for _, f := range []string{os.Getenv("SPLITTRUST_LAB_CA"), "/gen/client/ca.pem"} {
		if f == "" {
			continue
		}
		if b, err := os.ReadFile(f); err == nil {
			pool.AppendCertsFromPEM(b)
		}
	}
	return pool
}

func probe(ctx context.Context, t labTarget, roots *x509.CertPool) LabProbe {
	p := LabProbe{Name: t.name, Role: t.role, Addr: t.addr, Kind: t.kind}
	start := time.Now()
	defer func() { p.Millis = time.Since(start).Milliseconds() }()
	d := net.Dialer{Timeout: 3 * time.Second}
	switch t.kind {
	case "dns":
		m := new(dns.Msg)
		m.SetQuestion(t.qname, dns.TypeSOA)
		c := &dns.Client{Net: "udp", Timeout: 3 * time.Second}
		in, _, err := c.ExchangeContext(ctx, m, t.addr)
		if err != nil {
			p.Detail = err.Error()
			return p
		}
		p.OK = true
		p.Detail = dns.RcodeToString[in.Rcode] + " for " + t.qname + " SOA"
	case "dot":
		conn, err := tls.DialWithDialer(&d, "tcp", t.addr, &tls.Config{ServerName: t.serverName, RootCAs: roots, MinVersion: tls.VersionTLS12})
		if err != nil {
			p.Detail = err.Error()
			return p
		}
		defer conn.Close()
		cs := conn.ConnectionState()
		p.OK = true
		if len(cs.PeerCertificates) > 0 {
			p.Detail = "TLS ok, certificate for " + strings.Join(cs.PeerCertificates[0].DNSNames, ", ")
		}
	case "http", "https":
		url := t.kind + "://" + t.addr + "/"
		if t.kind == "https" {
			url = "https://" + t.addr + "/.well-known/pvd"
		}
		client := &http.Client{Timeout: 3 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{ServerName: t.serverName, RootCAs: roots, MinVersion: tls.VersionTLS12}, DisableKeepAlives: true}}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		req.Host = t.serverName
		resp, err := client.Do(req)
		if err != nil {
			p.Detail = err.Error()
			return p
		}
		resp.Body.Close()
		p.OK = resp.StatusCode < 500
		p.Detail = "HTTP " + resp.Status
	case "control":
		client := &http.Client{Timeout: 3 * time.Second}
		req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+t.addr+"/status", nil)
		resp, err := client.Do(req)
		if err != nil {
			p.Detail = err.Error()
			return p
		}
		resp.Body.Close()
		p.OK = resp.StatusCode == 200
		p.Detail = "HTTP " + resp.Status
	}
	return p
}
