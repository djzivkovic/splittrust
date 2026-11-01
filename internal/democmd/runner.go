// Package democmd executes a fixed, local-only set of DNS demonstration commands.
// The browser chooses a preset ID, never a command, target, argument or script.
package democmd

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"os"
	"strings"
	"time"

	"github.com/miekg/dns"
)

var (
	ErrUnknownPreset = errors.New("unknown demo preset")
	ErrBusy          = errors.New("a demo command is already running")
)

const gitlabName = "git.dev.corp.lab"

type Config struct {
	HotelDNS   string
	PublicDNS  string
	ProxyDNS   string
	ProxyURL   string
	FakeIP     string
	IntranetIP string
}

type Preset struct {
	ID               string   `json:"id"`
	Title            string   `json:"title"`
	Description      string   `json:"description"`
	VerificationMode string   `json:"verification_mode"`
	Preview          []string `json:"preview"`
	QName            string   `json:"qname"`
}

type Report struct {
	PresetID         string          `json:"preset_id"`
	Hostname         string          `json:"hostname"`
	VerificationMode string          `json:"verification_mode"`
	Outcome          string          `json:"outcome"`
	Summary          string          `json:"summary"`
	Commands         []CommandResult `json:"commands"`
	DNSAnswer        string          `json:"dns_answer,omitempty"`
	HTTPURL          string          `json:"http_url,omitempty"`
	DNS              *DNSResponse    `json:"dns,omitempty"`
	PublicDNS        *DNSResponse    `json:"public_dns,omitempty"`
	Proxy            *ProxyEvidence  `json:"proxy,omitempty"`
	DurationMS       int64           `json:"duration_ms"`
}

type Runner struct {
	cfg      Config
	executor Executor
	hostname string
	busy     chan struct{}
	client   *http.Client
}

func New(cfg Config, executor Executor) (*Runner, error) {
	host, port, err := net.SplitHostPort(cfg.HotelDNS)
	if err != nil || port != "53" {
		return nil, errors.New("demo hotel DNS must be a private IPv4 address on port 53")
	}
	proxyHost, proxyPort, err := net.SplitHostPort(cfg.ProxyDNS)
	if err != nil || proxyPort != "53" {
		return nil, errors.New("demo proxy DNS must be a private IPv4 address on port 53")
	}
	publicHost, publicPort, err := net.SplitHostPort(cfg.PublicDNS)
	if err != nil || publicPort != "53" {
		return nil, errors.New("demo public DNS must be a private IPv4 address on port 53")
	}
	for _, value := range []string{host, proxyHost, publicHost, cfg.FakeIP, cfg.IntranetIP} {
		addr, err := netip.ParseAddr(value)
		if err != nil || !addr.Is4() || !addr.IsPrivate() {
			return nil, fmt.Errorf("demo address %q must be a private IPv4 address", value)
		}
		control, err := url.Parse(cfg.ProxyURL)
		if err != nil || control.Scheme != "http" || control.User != nil || control.RawQuery != "" ||
			control.Fragment != "" || (control.Path != "" && control.Path != "/") {
			return nil, errors.New("demo proxy control must be a local HTTP base URL")
		}
		controlIP, err := netip.ParseAddr(control.Hostname())
		if err != nil || !controlIP.Is4() || (!controlIP.IsPrivate() && !controlIP.IsLoopback()) {
			return nil, errors.New("demo proxy control must use a private or loopback IPv4 address")
		}
		cfg.ProxyURL = strings.TrimSuffix(cfg.ProxyURL, "/")
	}
	hostname, err := os.Hostname()
	if err != nil {
		return nil, fmt.Errorf("demo hostname: %w", err)
	}
	if executor == nil {
		executor = SystemExecutor{}
	}
	return &Runner{cfg: cfg, executor: executor, hostname: hostname, busy: make(chan struct{}, 1),
		client: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{},
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}, nil
}

func (r *Runner) Presets() []Preset {
	host, _, _ := net.SplitHostPort(r.cfg.HotelDNS)
	proxyHost, _, _ := net.SplitHostPort(r.cfg.ProxyDNS)
	publicHost, _, _ := net.SplitHostPort(r.cfg.PublicDNS)
	return []Preset{
		{ID: "office-authorized", Title: "Office: open GitLab", VerificationMode: "splittrust", QName: gitlabName,
			Description: "Public DNS has no GitLab address. The approved office resolver supplies the private address, and the employee reaches the code repository.",
			Preview: []string{"dig @" + publicHost + " " + gitlabName + " A +dnssec",
				"dig @" + proxyHost + " " + gitlabName + " A +dnssec",
				"curl --resolve " + gitlabName + ":80:<DNS answer> http://" + gitlabName + "/"}},
		{ID: "hotel-unverified", Title: "Hotel: trust the Wi-Fi", VerificationMode: "none", QName: gitlabName,
			Description: "The employee opens the same bookmark at a hotel. Without validation, hotel DNS redirects it to a fake GitLab login page.",
			Preview:     []string{"dig @" + host + " " + gitlabName + " A", "curl --resolve " + gitlabName + ":80:<DNS answer> http://" + gitlabName + "/"}},
		{ID: "hotel-protected", Title: "Hotel: verify with SplitTrust", VerificationMode: "splittrust", QName: gitlabName,
			Description: "Same hotel, same bookmark. The company never authorized this resolver: SplitTrust rejects the claim and blocks the forged DNS answer.",
			Preview:     []string{"dig @" + proxyHost + " " + gitlabName + " A +dnssec"}},
	}
}

func (r *Runner) Run(ctx context.Context, id string) (Report, error) {
	mode := ""
	for _, preset := range r.Presets() {
		if preset.ID == id {
			mode = preset.VerificationMode
			break
		}
	}
	if mode == "" {
		return Report{}, ErrUnknownPreset
	}
	select {
	case r.busy <- struct{}{}:
		defer func() { <-r.busy }()
	default:
		return Report{}, ErrBusy
	}
	ctx, cancel := context.WithTimeout(ctx, 35*time.Second)
	defer cancel()
	start := time.Now()
	report := Report{PresetID: id, Hostname: r.hostname, VerificationMode: mode,
		Outcome: "inconclusive", Commands: []CommandResult{}}
	if id == "hotel-unverified" {
		r.unverified(ctx, &report)
	} else {
		r.validated(ctx, &report)
	}
	report.DurationMS = time.Since(start).Milliseconds()
	return report, nil
}

func (r *Runner) command(ctx context.Context, report *Report, name string, args ...string) CommandResult {
	result := r.executor.Execute(ctx, name, args...)
	report.Commands = append(report.Commands, result)
	return result
}

func unusable(result CommandResult) bool {
	return result.Error != "" || result.Truncated || result.ExitCode < 0
}

func (r *Runner) unverified(ctx context.Context, report *Report) {
	host, _, _ := net.SplitHostPort(r.cfg.HotelDNS)
	dig := r.command(ctx, report, "dig", "@"+host, gitlabName, "A",
		"+time=2", "+tries=1", "+noall", "+comments", "+answer")
	if unusable(dig) || dig.ExitCode != 0 {
		report.Summary = "The DNS command did not complete successfully; no page request was made."
		return
	}
	addresses := aAnswers(dig.Stdout, gitlabName)
	if !strings.Contains(dig.Stdout, "status: NOERROR") || len(addresses) != 1 {
		report.Summary = "The DNS output did not contain one unambiguous successful lab A answer; no page request was made."
		return
	}
	report.DNSAnswer = addresses[0]
	if report.DNSAnswer != r.cfg.FakeIP && report.DNSAnswer != r.cfg.IntranetIP {
		report.Summary = "The returned address is outside the two approved demo web servers; no page request was made."
		return
	}
	curl := r.page(ctx, report)
	if unusable(curl) || curl.ExitCode != 0 {
		report.Summary = "DNS returned an address, but the HTTP request failed. A successful redirect was not established."
		return
	}
	if report.DNSAnswer == r.cfg.FakeIP && strings.HasPrefix(strings.TrimSpace(curl.Stdout), "FAKE PAGE") {
		report.Outcome = "redirected"
		report.Summary = "The same GitLab bookmark reached the hotel's fake login page. The client trusted hotel DNS without checking the company's authorization or DNSSEC."
	} else if report.DNSAnswer == r.cfg.IntranetIP {
		report.Outcome = "not_redirected"
		report.Summary = "The client reached the company server; this run did not demonstrate the hotel redirect."
	} else {
		report.Summary = "The address matched the fake server, but its response did not identify the expected lab page."
	}
}

func (r *Runner) page(ctx context.Context, report *Report) CommandResult {
	report.HTTPURL = "http://" + gitlabName + "/"
	return r.command(ctx, report, "curl", "--silent", "--show-error", "--fail", "--max-time", "5",
		"--noproxy", "*", "--resolve", gitlabName+":80:"+report.DNSAnswer, report.HTTPURL)
}

func aAnswers(output, qname string) []string {
	answers := []string{}
	for _, line := range strings.Split(output, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, ";") {
			continue
		}
		rr, err := dns.NewRR(line)
		if err != nil {
			continue
		}
		if a, ok := rr.(*dns.A); ok && dns.CanonicalName(a.Hdr.Name) == dns.CanonicalName(qname) {
			answers = append(answers, a.A.String())
		}
	}
	return answers
}
