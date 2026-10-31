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
	Group  string `json:"group"` // demo: runs the scenes; testbed: the RFC's corner cases and the plain clients
	Role   string `json:"role"`
	Addr   string `json:"addr"`
	Kind   string `json:"kind"` // dns, dot, http, https, control
	OK     bool   `json:"ok"`
	Micros int64  `json:"micros"`
	Detail string `json:"detail,omitempty"`
}

type labTarget struct {
	name, group, role, addr, kind, serverName, qname string
}

// The lab as the console knows it. Addresses match lab/compose.yaml. The
// "demo" group is what the scenes use; "testbed" serves the RFC's corner-case
// scenarios, the plain clients used from the CLI, and the integration suite.
var labTargets = []labTarget{
	{"local-dot", "demo", "CoreDNS: SecureCompany's office resolver (DoT)", "172.30.97.20:853", "dot", "dns.splittrust.zivkovic.me", "internal.splittrust.zivkovic.me."},
	{"local-dot :53", "demo", "CoreDNS: UnsecureCompany's plain office resolver", "172.30.97.20:53", "dns", "", "intranet.unsecure.example."},
	{"hotel-dot :8853", "demo", "CoreDNS: the hotel's forging resolver (DoT)", "172.30.97.21:8853", "dot", "dns.hotel.lab", "zivkovic.me."},
	{"hotel-dot :53", "demo", "CoreDNS: the hotel's plain DNS for guests", "172.30.97.21:53", "dns", "", "intranet.unsecure.example."},
	{"pvd", "demo", "nginx: the networks' PvD documents (HTTPS)", "172.30.97.30:443", "https", "pvd.splittrust.zivkovic.me", ""},
	{"proxy", "demo", "splittrust proxy: SecureCompany's laptop's DNS server", "172.30.97.60:53", "dns", "", "lab."},
	{"proxy control", "demo", "splittrust proxy: control API (join, status, log)", "172.30.97.60:8001", "control", "", ""},
	{"intranet", "demo", "nginx: SecureCompany's intranet", "172.30.97.70:80", "http", "host.internal.splittrust.zivkovic.me", ""},
	{"unsecure-intranet", "demo", "nginx: UnsecureCompany's intranet", "172.30.97.71:80", "http", "intranet.unsecure.example", ""},
	{"fake-bank", "demo", "nginx: the hotel's page", "172.30.97.66:80", "http", "www.zivkovic.me", ""},
	{"public-dns", "testbed", "BIND: private root, lab TLD, 7 parent zones (1 unsigned)", "172.30.97.10:53", "dns", "", "lab."},
	{"hotel-dot :853", "testbed", "CoreDNS: the hotel's honest view (lab scenario)", "172.30.97.21:853", "dot", "dns.hotel.lab", "banka.lab."},
	{"external", "testbed", "unbound: quad9.lab, the lab's external resolver", "172.30.97.40:853", "dot", "quad9.lab", "lab."},
	{"bank", "testbed", "nginx: www.banka.lab", "172.30.97.80:80", "http", "www.banka.lab", ""},
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

func probe(ctx context.Context, t labTarget, roots *x509.CertPool) (p LabProbe) {
	p = LabProbe{Name: t.name, Group: t.group, Role: t.role, Addr: t.addr, Kind: t.kind}
	start := time.Now()
	defer func() { p.Micros = time.Since(start).Microseconds() }() // named result: the deferred write reaches the caller
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
