package democmd

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/djzivkovic/splittrust/internal/proxy"
	"github.com/djzivkovic/splittrust/internal/verify"
)

type fakeExecutor struct {
	outputs []CommandResult
	calls   [][]string
}

func (f *fakeExecutor) Execute(_ context.Context, name string, args ...string) CommandResult {
	f.calls = append(f.calls, append([]string{name}, args...))
	result := f.outputs[len(f.calls)-1]
	result.Command = append([]string{name}, args...)
	return result
}

func testConfig() Config {
	return Config{HotelDNS: "172.30.97.21:53", PublicDNS: "172.30.97.10:53", ProxyDNS: "172.30.97.63:53", ProxyURL: "http://172.30.97.63:8001",
		FakeIP: "172.30.97.66", IntranetIP: "172.30.97.70"}
}

func TestUnverifiedPresetUsesTheActualDNSAnswerForHTTP(t *testing.T) {
	executor := &fakeExecutor{outputs: []CommandResult{
		{Stdout: ";; ->>HEADER<<- opcode: QUERY, status: NOERROR\ngit.dev.corp.lab. 60 IN A 172.30.97.66\n"},
		{Stdout: "FAKE PAGE / GITLAB LOGIN: served by the hotel resolver\n"},
	}}
	runner, err := New(testConfig(), executor)
	if err != nil {
		t.Fatal(err)
	}
	report, err := runner.Run(context.Background(), "hotel-unverified")
	if err != nil {
		t.Fatal(err)
	}
	if report.Outcome != "redirected" || report.VerificationMode != "none" || report.DNSAnswer != "172.30.97.66" || report.Proxy != nil {
		t.Fatalf("report = %+v", report)
	}
	if len(executor.calls) != 2 || executor.calls[0][0] != "dig" || executor.calls[1][0] != "curl" {
		t.Fatalf("commands = %v", executor.calls)
	}
	if !strings.Contains(strings.Join(executor.calls[1], " "), "--resolve git.dev.corp.lab:80:172.30.97.66") {
		t.Fatalf("curl must connect to the observed DNS answer: %v", executor.calls[1])
	}
	if report.Commands[1].Stdout != executor.outputs[1].Stdout {
		t.Fatal("real command output must be retained")
	}
}

func TestUnverifiedPresetDoesNotConnectOutsideTheLabAllowlist(t *testing.T) {
	executor := &fakeExecutor{outputs: []CommandResult{
		{Stdout: ";; status: NOERROR\ngit.dev.corp.lab. 60 IN A 203.0.113.42\n"},
	}}
	runner, _ := New(testConfig(), executor)
	report, err := runner.Run(context.Background(), "hotel-unverified")
	if err != nil || report.Outcome != "inconclusive" || len(executor.calls) != 1 {
		t.Fatalf("must stop before HTTP: report=%+v err=%v calls=%v", report, err, executor.calls)
	}
}

func TestPresetNameCannotBecomeAShellCommand(t *testing.T) {
	executor := &fakeExecutor{}
	runner, _ := New(testConfig(), executor)
	_, err := runner.Run(context.Background(), "hotel-unverified; echo injected")
	if !errors.Is(err, ErrUnknownPreset) || len(executor.calls) != 0 {
		t.Fatalf("unknown preset executed: %v %v", err, executor.calls)
	}
}

const blockedDig = `;; ->>HEADER<<- opcode: QUERY, status: SERVFAIL, id: 2150
;; flags: qr rd ra; QUERY: 1, ANSWER: 0, AUTHORITY: 0, ADDITIONAL: 1
;; OPT PSEUDOSECTION:
; EDNS: version: 0, flags: do; udp: 1232
; EDE: 6 (DNSSEC Bogus): (DNSSEC validation failed)
`

const officeDig = `;; ->>HEADER<<- opcode: QUERY, status: NOERROR, id: 2151
;; flags: qr rd ra ad; QUERY: 1, ANSWER: 1, AUTHORITY: 0, ADDITIONAL: 1
; EDE: 0 (Other): (RFC 9704: authorised resolver dns.corp.lab, local DNSSEC delegated)
git.dev.corp.lab. 3600 IN A 172.30.97.70
`

const publicDig = `;; ->>HEADER<<- opcode: QUERY, status: NXDOMAIN, id: 2152
;; flags: qr aa; QUERY: 1, ANSWER: 0, AUTHORITY: 4, ADDITIONAL: 1
`

type proxyFixture struct {
	status       proxy.Status
	events       []proxy.Event
	joinCode     int
	evidenceCode int
}

func fixture(scenario string) *proxyFixture {
	name, resolver, decision, reason, rcode, mode := "git.dev.corp.lab", "dns.hotel.lab", "rejected", "RECORD_MISSING", "SERVFAIL", ""
	ad, ede := false, uint16(6)
	if scenario == "gitlab-office" {
		name, resolver, decision, reason, rcode, mode = "git.dev.corp.lab", "dns.corp.lab", "accepted", "AUTHORIZED", "NOERROR", "delegated"
		ad, ede = true, 0
	}
	return &proxyFixture{
		status: proxy.Status{Scenario: scenario, Device: verify.DeviceValidatingStub, Resolution: verify.ViaNetwork,
			TrustContext: "lab", Queries: 11, LastVerified: time.Now(),
			Grants: []proxy.GrantStatus{{Resolver: resolver, Scopes: []string{name}, Decision: decision, Reason: reason, LocalDNSSEC: mode}}},
		events: []proxy.Event{
			{Kind: "query", Name: "old.internal.corp.lab", Rcode: "NOERROR"},
			{Kind: "join", Scenario: scenario, Device: "validating-stub"},
			{Kind: "verify", Scenario: scenario, Resolver: resolver, Decision: decision, Reason: reason},
			{Kind: "query", Name: name, Qtype: "A", Rcode: rcode, AD: ad, EDE: ede},
		},
	}
}

func newProxyRunner(t *testing.T, executor Executor, f *proxyFixture) *Runner {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/join":
			var request struct {
				Scenario   string `json:"scenario_id"`
				Device     string `json:"device"`
				Resolution string `json:"resolution"`
			}
			if err := json.NewDecoder(r.Body).Decode(&request); err != nil || r.Method != http.MethodPost ||
				request.Scenario != f.status.Scenario || request.Device != "validating-stub" || request.Resolution != "via-network" {
				t.Errorf("unexpected proxy join: method=%s request=%+v err=%v", r.Method, request, err)
			}
			if f.joinCode != 0 {
				http.Error(w, "proxy could not join the network", f.joinCode)
				return
			}
			joined := f.status
			joined.Queries, joined.Grants, joined.LastVerified = 10, nil, time.Time{}
			json.NewEncoder(w).Encode(joined)
		case "/status", "/events":
			if f.evidenceCode != 0 {
				http.Error(w, "proxy evidence unavailable", f.evidenceCode)
				return
			}
			if r.URL.Path == "/status" {
				json.NewEncoder(w).Encode(f.status)
			} else {
				json.NewEncoder(w).Encode(map[string]any{"events": f.events})
			}
		default:
			t.Errorf("unexpected proxy endpoint %s", r.URL.Path)
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(server.Close)
	cfg := testConfig()
	cfg.ProxyURL = server.URL
	runner, err := New(cfg, executor)
	if err != nil {
		t.Fatal(err)
	}
	return runner
}

func TestProtectedDigUsesProxyAndRequiresBogusEvidence(t *testing.T) {
	for _, tc := range []struct {
		name    string
		command CommandResult
		want    string
	}{
		{"SERVFAIL is a DNS response, not a process failure", CommandResult{Stdout: blockedDig, ExitCode: 0}, "blocked"},
		{"generic SERVFAIL is not proven DNSSEC rejection", CommandResult{Stdout: strings.ReplaceAll(blockedDig, "6 (DNSSEC Bogus)", "23 (Network Error)")}, "inconclusive"},
		{"missing executable", CommandResult{ExitCode: -1, Error: "executable not found"}, "inconclusive"},
		{"invalid output", CommandResult{Stdout: "not a DNS response"}, "inconclusive"},
		{"truncated response", CommandResult{Stdout: blockedDig, Truncated: true}, "inconclusive"},
		{"timeout despite partial response", CommandResult{Stdout: blockedDig, ExitCode: 9}, "inconclusive"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executor := &fakeExecutor{outputs: []CommandResult{tc.command}}
			runner := newProxyRunner(t, executor, fixture("gitlab-hotel"))
			report, err := runner.Run(context.Background(), "hotel-protected")
			if err != nil || report.Outcome != tc.want {
				t.Fatalf("%+v %v", report, err)
			}
			if len(executor.calls) != 1 {
				t.Fatal("protected rejection must not fetch a page")
			}
			if executor.calls[0][0] != "dig" || executor.calls[0][1] != "@172.30.97.63" {
				t.Fatalf("lookup must use ordinary dig against the dedicated proxy: %v", executor.calls)
			}
			if tc.want == "blocked" && (report.DNS.Rcode != "SERVFAIL" || len(report.Proxy.Events) != 3) {
				t.Fatalf("response or current-run events missing: %+v", report)
			}
		})
	}
}

func TestOfficeDigNeedsBothAuthenticatedAnswerAndDelegatedGrant(t *testing.T) {
	for _, tc := range []struct{ name, output, mode, want string }{
		{"delegated secure local answer", officeDig, "delegated", "authorized"},
		{"AD absent", strings.ReplaceAll(officeDig, " ra ad;", " ra;"), "delegated", "inconclusive"},
		{"token-only grant", officeDig, "token-only", "inconclusive"},
		{"unexpected address", strings.ReplaceAll(officeDig, "172.30.97.70", "172.30.97.66"), "delegated", "inconclusive"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := fixture("gitlab-office")
			f.status.Grants[0].LocalDNSSEC = tc.mode
			executor := &fakeExecutor{outputs: []CommandResult{{Stdout: publicDig}, {Stdout: tc.output}, {Stdout: "INTERNAL GITLAB: private repositories\n"}}}
			report, _ := newProxyRunner(t, executor, f).Run(context.Background(), "office-authorized")
			if report.Outcome != tc.want {
				t.Fatalf("%+v", report)
			}
			if tc.want == "authorized" {
				if report.PublicDNS == nil || report.PublicDNS.Rcode != "NXDOMAIN" || len(executor.calls) != 3 {
					t.Fatalf("office must demonstrate public/private DNS and actually fetch GitLab: %+v", report)
				}
				if executor.calls[0][1] != "@172.30.97.10" || executor.calls[1][1] != "@172.30.97.63" ||
					!strings.Contains(strings.Join(executor.calls[2], " "), "--resolve git.dev.corp.lab:80:172.30.97.70") {
					t.Fatalf("incorrect split-horizon demonstration: %v", executor.calls)
				}
			}
		})
	}
}

func TestFailedJoinStopsBeforeDNSAndMissingEvidenceStaysInconclusive(t *testing.T) {
	for _, tc := range []struct {
		name                             string
		joinCode, evidenceCode, commands int
	}{
		{"failed join", 503, 0, 0}, {"failed evidence", 0, 503, 1},
	} {
		t.Run(tc.name, func(t *testing.T) {
			f := fixture("gitlab-hotel")
			f.joinCode, f.evidenceCode = tc.joinCode, tc.evidenceCode
			executor := &fakeExecutor{outputs: []CommandResult{{Stdout: blockedDig}}}
			report, _ := newProxyRunner(t, executor, f).Run(context.Background(), "hotel-protected")
			if report.Outcome != "inconclusive" || len(executor.calls) != tc.commands || !strings.Contains(report.Summary, "503") {
				t.Fatalf("failure was hidden: report=%+v calls=%v", report, executor.calls)
			}
		})
	}
}

func TestPreviousNetworkEvidenceCannotValidateCurrentDig(t *testing.T) {
	f := fixture("gitlab-hotel")
	f.events = []proxy.Event{{Kind: "join", Scenario: "legit", Device: "validating-stub"},
		{Kind: "query", Name: "git.dev.corp.lab", Qtype: "A", Rcode: "SERVFAIL", EDE: 6}}
	executor := &fakeExecutor{outputs: []CommandResult{{Stdout: blockedDig}}}
	report, _ := newProxyRunner(t, executor, f).Run(context.Background(), "hotel-protected")
	if report.Outcome != "inconclusive" {
		t.Fatalf("stale evidence accepted: %+v", report)
	}
}

func TestOfficeStoryNeedsPublicDenialAndAWorkingGitLabPage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		outputs []CommandResult
		calls   int
	}{
		{"public DNS unavailable", []CommandResult{{ExitCode: 9, Stderr: "timed out"}}, 1},
		{"public DNS has an address", []CommandResult{{Stdout: officeDig}}, 1},
		{"GitLab page unreachable", []CommandResult{{Stdout: publicDig}, {Stdout: officeDig}, {ExitCode: 7, Stderr: "connection refused"}}, 3},
	} {
		t.Run(tc.name, func(t *testing.T) {
			executor := &fakeExecutor{outputs: tc.outputs}
			report, _ := newProxyRunner(t, executor, fixture("gitlab-office")).Run(context.Background(), "office-authorized")
			if report.Outcome != "inconclusive" || len(executor.calls) != tc.calls {
				t.Fatalf("story must not invent private access: %+v, calls=%v", report, executor.calls)
			}
		})
	}
}

type waitingExecutor struct {
	entered chan struct{}
	release chan struct{}
}

func (e *waitingExecutor) Execute(ctx context.Context, name string, args ...string) CommandResult {
	close(e.entered)
	select {
	case <-e.release:
	case <-ctx.Done():
	}
	return CommandResult{Command: append([]string{name}, args...), ExitCode: -1, Error: "stopped"}
}

func TestOnlyOnePresetRunsAtATime(t *testing.T) {
	executor := &waitingExecutor{entered: make(chan struct{}), release: make(chan struct{})}
	runner := newProxyRunner(t, executor, fixture("gitlab-hotel"))
	done := make(chan struct{})
	go func() { defer close(done); runner.Run(context.Background(), "hotel-protected") }()
	<-executor.entered
	_, err := runner.Run(context.Background(), "hotel-unverified")
	close(executor.release)
	<-done
	if !errors.Is(err, ErrBusy) {
		t.Fatalf("expected busy, got %v", err)
	}
}
