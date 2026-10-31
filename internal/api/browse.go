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

// BrowserFromEnv reads SPLITTRUST_PROXY_DNS / SPLITTRUST_NAIVE_DNS; namespaces
// are the union of the manifest's permitted namespaces.
func BrowserFromEnv(namespaces []string) *Browser {
	b := &Browser{ProxyDNS: os.Getenv("SPLITTRUST_PROXY_DNS"), NaiveDNS: os.Getenv("SPLITTRUST_NAIVE_DNS"), Namespaces: namespaces}
	if b.ProxyDNS == "" && b.NaiveDNS == "" {
		return nil
	}
	if len(b.Namespaces) == 0 {
		b.Namespaces = []string{"lab.", "arpa."}
	}
	// Company Beta (the company that did not adopt RFC 9704) lives under the
	// reserved documentation TLD "example." (RFC 2606); it has no scenario of its
	// own because it never verifies anything.
	b.Namespaces = append(b.Namespaces, "example.")
	return b
}

// Lookup is one side of the comparison.
type Lookup struct {
	Via       string   `json:"via"`
	Rcode     string   `json:"rcode"`
	AD        bool     `json:"ad"`
	Answers   []string `json:"answers"`
	EDE       string   `json:"ede,omitempty"`
	Dig       string   `json:"dig,omitempty"` // the response as dig would print it
	Page      string   `json:"page,omitempty"`
	PageURL   string   `json:"page_url,omitempty"`
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

// Browse resolves and fetches name through both paths. naiveDNS overrides the
// resolver of the device without SplitTrust (a lab address on port 53), so the
// comparison can use the office resolver on the office scene and the hotel's on
// the hotel scene.
func (b *Browser) Browse(ctx context.Context, name string, withNaive bool, naiveDNS string) (BrowseResult, error) {
	qname := dns.Fqdn(strings.ToLower(strings.TrimSpace(name)))
	if _, ok := dns.IsDomainName(qname); !ok {
		return BrowseResult{}, fmt.Errorf("not a domain name")
	}
	if !lab.Permitted(qname, b.Namespaces) {
		return BrowseResult{}, fmt.Errorf("%s is outside the lab namespaces %v", qname, b.Namespaces)
	}
	res := BrowseResult{Name: strings.TrimSuffix(qname, ".")}
	res.Device = b.lookupAndFetch(ctx, b.ProxyDNS, "SplitTrust proxy "+b.ProxyDNS, qname)
	naive := b.NaiveDNS
	if naiveDNS != "" {
		host, port, err := net.SplitHostPort(naiveDNS)
		if err != nil || port != "53" || !labIP(host) {
			return BrowseResult{}, fmt.Errorf("naive_dns must be a lab resolver address on port 53")
		}
		naive = naiveDNS
	}
	if withNaive && naive != "" {
		n := b.lookupAndFetch(ctx, naive, "the network's plain DNS "+naive, qname)
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
	in, rtt, err := c.ExchangeContext(ctx, m, server)
	if err != nil {
		l.Error = "DNS query failed: " + err.Error()
		return l
	}
	l.Rcode = dns.RcodeToString[in.Rcode]
	l.Dig = digFormat(server, m, in, rtt)
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
	l.Page, l.PageURL, l.PageError = fetchPage(ctx, l.Answers[0], strings.TrimSuffix(qname, "."))
	return l
}

// digFormat renders a real exchange the way dig prints it: the command line,
// the header, the question and the sections, and the EDNS/EDE pseudo section.
func digFormat(server string, q, in *dns.Msg, rtt time.Duration) string {
	var b strings.Builder
	qn := strings.TrimSuffix(q.Question[0].Name, ".")
	fmt.Fprintf(&b, "$ dig @%s %s %s +dnssec\n", strings.TrimSuffix(server, ":53"), qn, dns.TypeToString[q.Question[0].Qtype])
	fmt.Fprintf(&b, ";; ->>HEADER<<- opcode: QUERY, status: %s, id: %d\n", dns.RcodeToString[in.Rcode], in.Id)
	flags := []string{"qr"}
	if in.RecursionDesired {
		flags = append(flags, "rd")
	}
	if in.RecursionAvailable {
		flags = append(flags, "ra")
	}
	if in.AuthenticatedData {
		flags = append(flags, "ad")
	}
	fmt.Fprintf(&b, ";; flags: %s; QUERY: %d, ANSWER: %d, AUTHORITY: %d, ADDITIONAL: %d\n", strings.Join(flags, " "), len(in.Question), len(in.Answer), len(in.Ns), len(in.Extra))
	if opt := in.IsEdns0(); opt != nil {
		fmt.Fprintf(&b, ";; OPT PSEUDOSECTION: EDNS: version: %d, flags:%s; udp: %d\n", opt.Version(), map[bool]string{true: " do", false: ""}[opt.Do()], opt.UDPSize())
		for _, o := range opt.Option {
			if e, ok := o.(*dns.EDNS0_EDE); ok {
				fmt.Fprintf(&b, ";; EDE: %d (%s): %s\n", e.InfoCode, dns.ExtendedErrorCodeToString[e.InfoCode], e.ExtraText)
			}
		}
	}
	fmt.Fprintf(&b, ";; QUESTION SECTION:\n;%s\n", q.Question[0].Name+"\t\tIN\t"+dns.TypeToString[q.Question[0].Qtype])
	section := func(title string, rrs []dns.RR) {
		var lines []string
		for _, rr := range rrs {
			if _, isOpt := rr.(*dns.OPT); !isOpt {
				lines = append(lines, rr.String())
			}
		}
		if len(lines) == 0 {
			return
		}
		fmt.Fprintf(&b, ";; %s SECTION:\n%s\n", title, strings.Join(lines, "\n"))
	}
	section("ANSWER", in.Answer)
	section("AUTHORITY", in.Ns)
	section("ADDITIONAL", in.Extra)
	fmt.Fprintf(&b, ";; Query time: %d msec\n;; SERVER: %s", rtt.Milliseconds(), server)
	return b.String()
}

// labIP reports whether an address belongs to the lab (172.30.97.0/24).
func labIP(ip string) bool { return strings.HasPrefix(ip, "172.30.97.") }

// fetchPage follows the answer: a lab address serves one line of text over
// plain HTTP (fetched by IP with the Host header); a real address is fetched
// over HTTPS by name and summarised as status, server header and title, so the
// screen shows that the device reached the real site.
func fetchPage(ctx context.Context, ip, host string) (page, url, errText string) {
	if !labIP(ip) {
		return fetchReal(ctx, host)
	}
	page, errText = fetchLab(ctx, ip, host)
	return page, "http://" + host + "/", errText
}

func fetchReal(ctx context.Context, host string) (string, string, string) {
	url := "https://" + host + "/"
	client := &http.Client{Timeout: 8 * time.Second, CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 3 {
			return fmt.Errorf("too many redirects")
		}
		return nil
	}}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", url, err.Error()
	}
	req.Header.Set("User-Agent", "SplitTrust-lab/0.2")
	resp, err := client.Do(req)
	if err != nil {
		return "", url, err.Error()
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	title := ""
	if i := strings.Index(strings.ToLower(string(body)), "<title>"); i >= 0 {
		rest := string(body)[i+7:]
		if j := strings.Index(strings.ToLower(rest), "</title>"); j >= 0 {
			title = strings.TrimSpace(rest[:j])
		}
	}
	parts := []string{fmt.Sprintf("HTTP %d", resp.StatusCode)}
	if srv := resp.Header.Get("Server"); srv != "" {
		parts = append(parts, "server: "+srv)
	}
	if title != "" {
		parts = append(parts, "title: "+title)
	}
	if resp.Request != nil && resp.Request.URL.String() != url {
		parts = append(parts, "final URL: "+resp.Request.URL.String())
	}
	return strings.Join(parts, "; "), url, ""
}

func fetchLab(ctx context.Context, ip, host string) (string, string) {
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
		NaiveDNS  string `json:"naive_dns"`
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
	res, err := h.browser.Browse(ctx, req.Name, withNaive, req.NaiveDNS)
	if err != nil {
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, res)
}
