package democmd

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/proxy"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/verify"
)

type DNSError struct {
	Code uint16 `json:"code"`
	Text string `json:"text"`
}

type DNSResponse struct {
	QName   string     `json:"qname"`
	QType   string     `json:"qtype"`
	Server  string     `json:"server"`
	Rcode   string     `json:"rcode"`
	Flags   []string   `json:"flags"`
	AD      bool       `json:"ad"`
	Answers []string   `json:"answers"`
	EDE     []DNSError `json:"ede"`
}

type ProxyEvidence struct {
	Status proxy.Status  `json:"status"`
	Events []proxy.Event `json:"events"`
}

var (
	digHeader = regexp.MustCompile(`(?m)^;; ->>HEADER<<- opcode: QUERY, status: ([A-Z]+), id: [0-9]+\r?$`)
	digFlags  = regexp.MustCompile(`(?m)^;; flags: ([a-z ]+);`)
	digEDE    = regexp.MustCompile(`(?m)^; EDE: ([0-9]+)([^\r\n]*)`)
)

func parseDig(output, qname, server string) (*DNSResponse, error) {
	headers, flags := digHeader.FindAllStringSubmatch(output, -1), digFlags.FindAllStringSubmatch(output, -1)
	if len(headers) != 1 || len(flags) != 1 {
		return nil, errors.New("dig output did not contain one complete DNS response header")
	}
	response := &DNSResponse{QName: dns.Fqdn(qname), QType: "A", Server: server,
		Rcode: headers[0][1], Flags: strings.Fields(flags[0][1]), Answers: aAnswers(output, qname), EDE: []DNSError{}}
	response.AD = slices.Contains(response.Flags, "ad")
	if !slices.Contains(response.Flags, "qr") || slices.Contains(response.Flags, "tc") {
		return nil, errors.New("dig output is not a complete DNS reply")
	}
	for _, match := range digEDE.FindAllStringSubmatch(output, -1) {
		code, err := strconv.ParseUint(match[1], 10, 16)
		if err != nil {
			return nil, fmt.Errorf("invalid extended DNS error: %w", err)
		}
		response.EDE = append(response.EDE, DNSError{Code: uint16(code), Text: strings.TrimSpace(match[2])})
	}
	return response, nil
}

func (r *Runner) proxyRequest(ctx context.Context, method, path string, body any, out any) error {
	var payload bytes.Buffer
	if body != nil {
		if err := json.NewEncoder(&payload).Encode(body); err != nil {
			return err
		}
	}
	req, err := http.NewRequestWithContext(ctx, method, r.cfg.ProxyURL+path, &payload)
	if err != nil {
		return err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	resp, err := r.client.Do(req)
	if err != nil {
		return fmt.Errorf("demo proxy %s: %w", path, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("demo proxy %s returned HTTP %d", path, resp.StatusCode)
	}
	const maxEvidenceBytes = 256 << 10
	data, err := io.ReadAll(io.LimitReader(resp.Body, maxEvidenceBytes+1))
	if err != nil {
		return fmt.Errorf("read demo proxy %s: %w", path, err)
	}
	if len(data) > maxEvidenceBytes {
		return fmt.Errorf("demo proxy %s exceeded the evidence size limit", path)
	}
	if err := json.Unmarshal(data, out); err != nil {
		return fmt.Errorf("invalid demo proxy %s report: %w", path, err)
	}
	return nil
}

func (r *Runner) validated(ctx context.Context, report *Report) {
	scenario, qname := "gitlab-hotel", gitlabName
	if report.PresetID == "office-authorized" {
		scenario = "gitlab-office"
		if !r.publicView(ctx, report) {
			return
		}
	}
	var joined proxy.Status
	err := r.proxyRequest(ctx, http.MethodPost, "/join",
		map[string]string{"scenario_id": scenario, "device": "validating-stub", "resolution": "via-network"}, &joined)
	if err != nil {
		report.Summary = "No DNS query was sent: " + err.Error()
		return
	}
	if joined.Scenario != scenario || joined.Device != verify.DeviceValidatingStub || !joined.LastVerified.IsZero() {
		report.Summary = "The demo proxy did not confirm a fresh join to the selected network. No DNS query was sent."
		return
	}
	host, _, _ := net.SplitHostPort(r.cfg.ProxyDNS)
	command := r.command(ctx, report, "dig", "@"+host, qname, "A", "+dnssec",
		"+time=15", "+tries=1", "+noall", "+comments", "+answer", "+stats")
	if unusable(command) || command.ExitCode != 0 {
		report.Summary = "The dig command did not complete successfully; no successful or blocked lookup is inferred."
		return
	}
	report.DNS, err = parseDig(command.Stdout, qname, r.cfg.ProxyDNS)
	if err != nil {
		report.Summary = err.Error()
		return
	}
	evidence, err := r.proxyEvidence(ctx, scenario, joined.Queries, report.DNS)
	if err != nil {
		report.Summary = err.Error()
		return
	}
	report.Proxy = evidence
	for _, grant := range evidence.Status.Grants {
		if !route.InScope(qname, grant.Scopes) {
			continue
		}
		verified := slices.ContainsFunc(evidence.Events, func(event proxy.Event) bool {
			return event.Kind == "verify" && event.Scenario == scenario &&
				dns.CanonicalName(event.Resolver) == dns.CanonicalName(grant.Resolver) &&
				event.Decision == grant.Decision && event.Reason == grant.Reason
		})
		if !verified {
			continue
		}
		bogus := slices.ContainsFunc(report.DNS.EDE, func(ede DNSError) bool { return ede.Code == dns.ExtendedErrorCodeDNSBogus })
		if scenario == "gitlab-hotel" && grant.Decision == "rejected" && report.DNS.Rcode == "SERVFAIL" &&
			!report.DNS.AD && len(report.DNS.Answers) == 0 && bogus {
			report.Outcome = "blocked"
			report.Summary = "The company did not authorize the hotel's resolver for its developer services. The proxy rejected its claim and returned SERVFAIL with DNSSEC Bogus for GitLab. The fake page was never requested."
			return
		}
		if scenario == "gitlab-office" && grant.Decision == "accepted" && grant.LocalDNSSEC == "delegated" &&
			report.DNS.Rcode == "NOERROR" && report.DNS.AD && len(report.DNS.Answers) == 1 && report.DNS.Answers[0] == r.cfg.IntranetIP {
			report.DNSAnswer = report.DNS.Answers[0]
			page := r.page(ctx, report)
			if unusable(page) || page.ExitCode != 0 || !strings.HasPrefix(strings.TrimSpace(page.Stdout), "INTERNAL GITLAB") {
				report.Summary = "The approved office resolver returned the private GitLab address, but its page did not load as expected. Repository access was not established."
				return
			}
			report.Outcome = "authorized"
			report.Summary = "Public DNS has no GitLab address. The authorized office resolver supplied the signed private address, and the employee reached the company GitLab page."
			return
		}
	}
	report.Summary = "The DNS response and proxy evidence do not establish the expected outcome. Inspect the actual response below."
}

func (r *Runner) publicView(ctx context.Context, report *Report) bool {
	host, _, _ := net.SplitHostPort(r.cfg.PublicDNS)
	command := r.command(ctx, report, "dig", "@"+host, gitlabName, "A", "+dnssec",
		"+time=2", "+tries=1", "+norecurse", "+noall", "+comments", "+answer", "+stats")
	if unusable(command) || command.ExitCode != 0 {
		report.Summary = "Public DNS did not respond successfully. The split-horizon comparison could not be established."
		return false
	}
	var err error
	report.PublicDNS, err = parseDig(command.Stdout, gitlabName, r.cfg.PublicDNS)
	if err != nil {
		report.Summary = err.Error()
		return false
	}
	if report.PublicDNS.Rcode != "NXDOMAIN" || len(report.PublicDNS.Answers) != 0 || !slices.Contains(report.PublicDNS.Flags, "aa") {
		report.Summary = "The public DNS response was not the expected authoritative denial. The demo cannot claim this hostname is private."
		return false
	}
	return true
}

func (r *Runner) proxyEvidence(ctx context.Context, scenario string, beforeQueries uint64, response *DNSResponse) (*ProxyEvidence, error) {
	evidence := &ProxyEvidence{}
	if err := r.proxyRequest(ctx, http.MethodGet, "/status", nil, &evidence.Status); err != nil {
		return nil, err
	}
	if err := r.proxyRequest(ctx, http.MethodGet, "/events", nil, evidence); err != nil {
		return nil, err
	}
	status := evidence.Status
	if status.Scenario != scenario || status.Device != verify.DeviceValidatingStub || status.Resolution != verify.ViaNetwork ||
		status.TrustContext != "lab" || status.Queries <= beforeQueries || status.LastVerified.IsZero() {
		return nil, errors.New("demo proxy status does not match a fresh validating lookup on the selected lab network")
	}
	// The dedicated proxy is used only by this serialized runner. A fresh join
	// clears its grants; discard all events preceding that join, including old queries.
	lastJoin := -1
	for i := len(evidence.Events) - 1; i >= 0; i-- {
		if evidence.Events[i].Kind == "join" {
			lastJoin = i
			break
		}
	}
	if lastJoin < 0 || evidence.Events[lastJoin].Scenario != scenario || evidence.Events[lastJoin].Device != "validating-stub" {
		return nil, errors.New("demo proxy events belong to a different or missing network join")
	}
	evidence.Events = evidence.Events[lastJoin:]
	for i := len(evidence.Events) - 1; i >= 0; i-- {
		event := evidence.Events[i]
		if event.Kind != "query" {
			continue
		}
		if dns.CanonicalName(event.Name) != dns.CanonicalName(response.QName) || event.Qtype != "A" ||
			event.Rcode != response.Rcode || event.AD != response.AD {
			return nil, errors.New("demo proxy query event does not match the dig response")
		}
		if !slices.ContainsFunc(response.EDE, func(ede DNSError) bool { return ede.Code == event.EDE }) {
			return nil, errors.New("demo proxy extended DNS error does not match the dig response")
		}
		return evidence, nil
	}
	return nil, errors.New("demo proxy did not record this DNS query")
}
