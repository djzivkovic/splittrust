package api

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/lab"
)

// Browser performs the "now browse" demonstration from inside the lab: resolve a
// name the way the simulated client does (through the SplitTrust DNS proxy) and
// the way a naive device on the same hostile network does (the network's plain
// DNS), then fetch the page each answer points at.
type Browser struct {
	ProxyDNS   string // e.g. 172.30.97.60:53
	NaiveDNS   string // e.g. 172.30.97.21:53 (the hotel's plain resolver)
	Namespaces []string
}

// BrowserFromEnv reads SPLITTRUST_PROXY_DNS / SPLITTRUST_NAIVE_DNS.
func BrowserFromEnv() *Browser {
	b := &Browser{ProxyDNS: os.Getenv("SPLITTRUST_PROXY_DNS"), NaiveDNS: os.Getenv("SPLITTRUST_NAIVE_DNS"), Namespaces: []string{"lab.", "arpa."}}
	if b.ProxyDNS == "" && b.NaiveDNS == "" {
		return nil
	}
	return b
}

// Lookup is one side of the comparison.
type Lookup struct {
	Via       string   `json:"via"`
	Rcode     string   `json:"rcode"`
	AD        bool     `json:"ad"`
	Answers   []string `json:"answers"`
	EDE       string   `json:"ede,omitempty"`
	Page      string   `json:"page,omitempty"`
	PageError string   `json:"page_error,omitempty"`
	Error     string   `json:"error,omitempty"`
	Millis    int64    `json:"millis"`
}

// BrowseResult compares the two devices.
type BrowseResult struct {
	Name   string  `json:"name"`
	Device Lookup  `json:"device"`
	Naive  *Lookup `json:"naive,omitempty"`
}

// Browse resolves and fetches name through both paths.
func (b *Browser) Browse(ctx context.Context, name string, withNaive bool) (BrowseResult, error) {
	qname := dns.Fqdn(strings.ToLower(strings.TrimSpace(name)))
	if _, ok := dns.IsDomainName(qname); !ok {
		return BrowseResult{}, fmt.Errorf("not a domain name")
	}
	if !lab.Permitted(qname, b.Namespaces) {
		return BrowseResult{}, fmt.Errorf("%s is outside the lab namespaces %v", qname, b.Namespaces)
	}
	res := BrowseResult{Name: strings.TrimSuffix(qname, ".")}
	res.Device = b.lookupAndFetch(ctx, b.ProxyDNS, "SplitTrust proxy "+b.ProxyDNS, qname)
	if withNaive && b.NaiveDNS != "" {
		n := b.lookupAndFetch(ctx, b.NaiveDNS, "the network's plain DNS "+b.NaiveDNS, qname)
		res.Naive = &n
	}
	return res, nil
}

func (b *Browser) lookupAndFetch(ctx context.Context, server, via, qname string) Lookup {
	start := time.Now()
	l := Lookup{Via: via, Answers: []string{}}
	defer func() { l.Millis = time.Since(start).Milliseconds() }()
	if server == "" {
		l.Error = "no resolver configured"
		return l
	}
	m := new(dns.Msg)
	m.SetQuestion(qname, dns.TypeA)
	m.SetEdns0(1232, true)
	c := &dns.Client{Timeout: 12 * time.Second}
	in, _, err := c.ExchangeContext(ctx, m, server)
	if err != nil {
		l.Error = "DNS query failed: " + err.Error()
		return l
	}
	l.Rcode = dns.RcodeToString[in.Rcode]
	l.AD = in.AuthenticatedData
	for _, rr := range in.Answer {
		if a, ok := rr.(*dns.A); ok {
			l.Answers = append(l.Answers, a.A.String())
		}
	}
	if opt := in.IsEdns0(); opt != nil {
		for _, o := range opt.Option {
			if e, ok := o.(*dns.EDNS0_EDE); ok {
				l.EDE = fmt.Sprintf("EDE %d (%s): %s", e.InfoCode, dns.ExtendedErrorCodeToString[e.InfoCode], e.ExtraText)
			}
		}
	}
	if len(l.Answers) == 0 {
		return l
	}
	l.Page, l.PageError = fetchPage(ctx, l.Answers[0], strings.TrimSuffix(qname, "."))
	return l
}

// fetchPage GETs http://ip/ with the Host header set to name and returns the
// body (lab pages are one line of text), capped.
func fetchPage(ctx context.Context, ip, host string) (string, string) {
	client := &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{
		DialContext:       (&net.Dialer{Timeout: 3 * time.Second}).DialContext,
		DisableKeepAlives: true,
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "http://"+net.JoinHostPort(ip, "80")+"/", nil)
	if err != nil {
		return "", err.Error()
	}
	req.Host = host
	resp, err := client.Do(req)
	if err != nil {
		return "", err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Sprintf("HTTP %d", resp.StatusCode)
	}
	return strings.TrimSpace(string(body)), ""
}

func (h *handler) browse(w http.ResponseWriter, r *http.Request) {
	if h.browser == nil {
		writeError(w, http.StatusNotFound, "browsing is only available inside the lab (SPLITTRUST_PROXY_DNS)")
		return
	}
	var req struct {
		Name      string `json:"name"`
		WithNaive *bool  `json:"with_naive"`
	}
	if !decode(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: name is required")
		return
	}
	withNaive := req.WithNaive == nil || *req.WithNaive
	ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
	defer cancel()
	res, err := h.browser.Browse(ctx, req.Name, withNaive)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
