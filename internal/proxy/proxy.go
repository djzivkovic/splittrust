// Package proxy is the DNS front door: a plain-DNS (Do53) forwarding resolver
// that ordinary stub resolvers can be pointed at. Names inside a verified RFC
// 9704 claim are sent to the authorised resolver over authenticated DoT and,
// when a key was delegated (section 7), validated locally (AD=1); token-only
// authority answers with AD=0; everything else takes the simulated device's
// default path. Rejected claims never route a single query. Verdicts are
// explained to EDNS clients with Extended DNS Errors (RFC 8914).
package proxy

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/validate"
	"github.com/djzivkovic/splittrust/internal/verify"
)

// Config wires the proxy to profiles and verifiers (the engine in production,
// fakes in tests).
type Config struct {
	Profile  func(id string) (lab.Profile, error)
	Verifier func(p lab.Profile) (*verify.Verifier, error)
	Now      func() time.Time
	Log      func(format string, a ...any)
}

// LogLines returns the most recent log lines (newest last), for the console's
// live view of what the proxy is doing.
func (s *Server) LogLines() []string {
	s.logMu.Lock()
	defer s.logMu.Unlock()
	out := make([]string, len(s.logBuf))
	copy(out, s.logBuf)
	return out
}

func (s *Server) logf(format string, a ...any) {
	line := time.Now().UTC().Format("15:04:05") + " " + fmt.Sprintf(format, a...)
	s.logMu.Lock()
	s.logBuf = append(s.logBuf, line)
	if len(s.logBuf) > 200 {
		s.logBuf = s.logBuf[len(s.logBuf)-200:]
	}
	s.logMu.Unlock()
	if s.cfg.Log != nil {
		s.cfg.Log(format, a...)
	}
}

// ErrBadDevice is returned by Join for an unknown device profile.
var ErrBadDevice = errors.New("unknown device")

const (
	edeOther       = dns.ExtendedErrorCodeOther
	rejectedRetry  = 30 * time.Second // re-verify a rejected claim after this
	expiryMargin   = 5 * time.Second  // re-verify a grant this long before it expires
	upstreamBudget = 8 * time.Second
)

type grantEntry struct {
	Resolver string
	Scopes   []string
	Decision string
	Reason   string
	Grant    *verify.Grant
	until    time.Time
}

// GrantStatus is one cached verdict in Status.
type GrantStatus struct {
	Resolver    string    `json:"resolver"`
	Scopes      []string  `json:"scopes"`
	Decision    string    `json:"decision"`
	Reason      string    `json:"reason"`
	ExpiresAt   time.Time `json:"expires_at,omitempty"`
	LocalDNSSEC string    `json:"local_dnssec_mode,omitempty"`
	Path        string    `json:"path,omitempty"`
}

// Status describes the network the proxy currently believes it joined.
type Status struct {
	Scenario     string            `json:"scenario_id"`
	Title        string            `json:"title"`
	Device       verify.Device     `json:"device"`
	Resolution   verify.Resolution `json:"resolution"`
	TrustContext string            `json:"trust_context"`
	Grants       []GrantStatus     `json:"grants"`
	Queries      uint64            `json:"queries"`
	LastVerified time.Time         `json:"last_verified,omitempty"`
}

// Server is the proxy.
type Server struct {
	cfg     Config
	queries atomic.Uint64

	mu           sync.Mutex
	profile      lab.Profile
	v            *verify.Verifier
	device       verify.Device
	resolution   verify.Resolution
	grants       []*grantEntry
	grantsUntil  time.Time
	lastVerified time.Time

	logMu  sync.Mutex
	logBuf []string
}

// New creates a proxy that has not joined a network yet.
func New(cfg Config) (*Server, error) {
	if cfg.Profile == nil || cfg.Verifier == nil {
		return nil, errors.New("proxy: Profile and Verifier are required")
	}
	if cfg.Now == nil {
		cfg.Now = time.Now
	}
	if cfg.Log == nil {
		cfg.Log = log.Printf
	}
	return &Server{cfg: cfg}, nil
}

// Join switches the simulated network (scenario) and device; cached grants are
// dropped, as a real device would forget the previous network's authority.
func (s *Server) Join(scenario string, device verify.Device, resolution verify.Resolution) error {
	p, err := s.cfg.Profile(scenario)
	if err != nil {
		return err
	}
	if device == "" {
		device = verify.Device(p.DefaultDevice)
	}
	switch device {
	case verify.DeviceValidatingStub, verify.DevicePrivateDNS, verify.DeviceHybrid:
	default:
		return fmt.Errorf("%w: %q", ErrBadDevice, device)
	}
	if resolution == "" && p.DefaultResolution != "" {
		resolution = verify.Resolution(p.DefaultResolution)
	}
	if resolution == "" {
		resolution = verify.ViaNetwork
	}
	v, err := s.cfg.Verifier(p)
	if err != nil {
		return err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	s.profile, s.v, s.device, s.resolution = p, v, device, resolution
	s.grants, s.grantsUntil, s.lastVerified = nil, time.Time{}, time.Time{}
	s.logf("joined network %q as %s (%s)", scenario, device, resolution)
	return nil
}

// Status reports the current network and cached verdicts.
func (s *Server) Status() Status {
	s.mu.Lock()
	defer s.mu.Unlock()
	st := Status{Scenario: s.profile.ScenarioID, Title: s.profile.Title, Device: s.device, Resolution: s.resolution, TrustContext: "lab", Queries: s.queries.Load(), LastVerified: s.lastVerified, Grants: []GrantStatus{}}
	if s.profile.TrustContext != "" {
		st.TrustContext = s.profile.TrustContext
	}
	for _, g := range s.grants {
		gs := GrantStatus{Resolver: g.Resolver, Scopes: g.Scopes, Decision: g.Decision, Reason: g.Reason}
		if g.Grant != nil {
			gs.ExpiresAt, gs.LocalDNSSEC, gs.Path = g.Grant.ExpiresAt, g.Grant.LocalDNSSECMode, g.Grant.Path
		}
		st.Grants = append(st.Grants, gs)
	}
	return st
}

// ServeDNS implements dns.Handler.
func (s *Server) ServeDNS(w dns.ResponseWriter, r *dns.Msg) {
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	resp := s.Handle(ctx, r)
	if w.RemoteAddr() != nil && w.RemoteAddr().Network() == "udp" {
		resp.Truncate(dns.MinMsgSize)
	}
	_ = w.WriteMsg(resp)
}

// Handle answers one request (pure: no sockets), so tests can call it directly.
func (s *Server) Handle(ctx context.Context, req *dns.Msg) *dns.Msg {
	s.queries.Add(1)
	resp := new(dns.Msg)
	resp.SetReply(req)
	resp.RecursionAvailable = true
	resp.Compress = true
	if req.Opcode != dns.OpcodeQuery || len(req.Question) != 1 {
		resp.Rcode = dns.RcodeNotImplemented
		return resp
	}
	q := req.Question[0]
	if q.Qclass != dns.ClassINET {
		resp.Rcode = dns.RcodeNotImplemented
		return resp
	}
	qname := dns.CanonicalName(q.Name)
	do := false
	if opt := req.IsEdns0(); opt != nil {
		do = opt.Do()
	}

	s.mu.Lock()
	p, v, device, resolution := s.profile, s.v, s.device, s.resolution
	s.mu.Unlock()
	if v == nil {
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNotReady, "proxy has not joined a network")
		return resp
	}
	if !lab.Permitted(qname, p.PermittedNamespaces) {
		s.finish(req, resp, dns.RcodeRefused, false, edeOther, fmt.Sprintf("RFC 9704 lab proxy: %s is outside the permitted namespaces %v; no query sent", qname, p.PermittedNamespaces))
		return resp
	}

	ctx, cancel := context.WithTimeout(ctx, upstreamBudget)
	defer cancel()
	entry := s.covering(ctx, qname, p, v, device, resolution)
	switch {
	case entry != nil && entry.Grant != nil:
		s.localPath(ctx, req, resp, qname, q.Qtype, do, v, entry)
	case entry != nil:
		s.defaultPath(ctx, req, resp, qname, q.Qtype, do, p, v, device, resolution,
			fmt.Sprintf("RFC 9704: claim by %s for %s was %s (%s); using the device's default path", entry.Resolver, strings.Join(entry.Scopes, ","), entry.Decision, entry.Reason))
	default:
		s.defaultPath(ctx, req, resp, qname, q.Qtype, do, p, v, device, resolution, "")
	}
	return resp
}

// covering returns the cached verdict for the claim whose scope contains qname,
// (re)verifying the network's claims when nothing is cached or a grant is due.
func (s *Server) covering(ctx context.Context, qname string, p lab.Profile, v *verify.Verifier, device verify.Device, resolution verify.Resolution) *grantEntry {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := s.cfg.Now()
	if s.grants == nil || !now.Before(s.grantsUntil) {
		run := v.Verify(ctx, p, nil, verify.Options{Device: device, Resolution: resolution})
		s.grants, s.grantsUntil, s.lastVerified = nil, now.Add(rejectedRetry), now
		for _, c := range run.Claims {
			e := &grantEntry{Resolver: c.Resolver, Decision: c.Decision, Reason: c.Reason, Grant: c.Grant, until: now.Add(rejectedRetry)}
			if c.Inspection != nil {
				e.Scopes = c.Inspection.Scopes
			}
			if c.Grant != nil {
				e.Scopes = c.Grant.Scopes
				e.until = c.Grant.ExpiresAt.Add(-expiryMargin)
				if !e.until.After(now) {
					e.until = now.Add(rejectedRetry)
				}
			}
			if e.until.Before(s.grantsUntil) || len(s.grants) == 0 {
				s.grantsUntil = e.until
			}
			s.grants = append(s.grants, e)
			s.logf("verified %s on %q: %s %s", c.Resolver, p.ScenarioID, c.Decision, c.Reason)
		}
	}
	for _, e := range s.grants {
		if route.InScope(qname, e.Scopes) {
			return e
		}
	}
	return nil
}

// localPath forwards to the authorised resolver; with delegated keys the
// answer is validated locally (AD=1), token-only authority answers with AD=0.
func (s *Server) localPath(ctx context.Context, req, resp *dns.Msg, qname string, qtype uint16, do bool, v *verify.Verifier, e *grantEntry) {
	g := e.Grant
	conn, err := v.Deps.DoT.Dial(ctx, g.DoTAddr, strings.TrimSuffix(g.Resolver, "."))
	if err != nil {
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, "authorised resolver "+g.Resolver+" unreachable: "+err.Error())
		return
	}
	defer conn.Close()
	ans, err := conn.Query(ctx, qname, qtype)
	if err != nil {
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, "authorised resolver "+g.Resolver+" did not answer: "+err.Error())
		return
	}
	resp.Rcode = ans.Rcode
	hasData := false
	for _, rr := range ans.Answer {
		if rr.Header().Rrtype == qtype && dns.CanonicalName(rr.Header().Name) == qname {
			hasData = true
		}
	}
	if g.LocalDNSSECMode != "delegated" || !hasData {
		// Token-only authority, or a negative/indirect answer we cannot validate
		// without NSEC support: pass through unvalidated.
		resp.Answer = stripSigs(ans.Answer, do)
		resp.Ns = stripSigs(ans.Ns, do)
		note := "RFC 9704: answered by the authorised resolver " + g.Resolver + " (token-only authority: no key delegated, answer not validated)"
		if g.LocalDNSSECMode == "delegated" {
			note = "RFC 9704: answered by the authorised resolver " + g.Resolver + " (negative or indirect answer: not validated)"
		}
		s.finish(req, resp, resp.Rcode, false, edeOther, note)
		return
	}
	apex := ""
	for _, sc := range g.Scopes {
		if route.InScope(qname, []string{sc}) {
			apex = sc
		}
	}
	keys, err := conn.Query(ctx, apex, dns.TypeDNSKEY)
	if err != nil {
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, "DNSKEY "+apex+" query failed: "+err.Error())
		return
	}
	var approved []*dns.DNSKEY
	for _, k := range g.AuthorizedKeys {
		if rr, err := dns.NewRR(apex + " 3600 IN DNSKEY " + k); err == nil {
			if dk, ok := rr.(*dns.DNSKEY); ok {
				approved = append(approved, dk)
			}
		}
	}
	validated, err := verify.ValidateLocal(approved, keys, ans, qname, qtype, s.cfg.Now())
	if err != nil {
		resp.Answer = nil
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeDNSBogus, "RFC 9704 section 7: local answer from "+g.Resolver+" failed validation under the delegated key: "+err.Error())
		return
	}
	resp.Answer = validated
	if do {
		for _, rr := range ans.Answer {
			if sig, ok := rr.(*dns.RRSIG); ok && sig.TypeCovered == qtype {
				resp.Answer = append(resp.Answer, sig)
			}
		}
	}
	s.finish(req, resp, dns.RcodeSuccess, true, edeOther, "RFC 9704 section 7: validated under the key delegated to "+g.Resolver+" via the Verification Record")
}

// defaultPath is the device's ordinary resolution.
func (s *Server) defaultPath(ctx context.Context, req, resp *dns.Msg, qname string, qtype uint16, do bool, p lab.Profile, v *verify.Verifier, device verify.Device, resolution verify.Resolution, note string) {
	if device == verify.DevicePrivateDNS {
		conn, err := v.Deps.DoT.Dial(ctx, p.External.Addr, strings.TrimSuffix(p.External.ADN, "."))
		if err != nil {
			s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, "external resolver "+p.External.ADN+" unreachable: "+err.Error())
			return
		}
		defer conn.Close()
		ans, err := conn.Query(ctx, qname, qtype)
		if err != nil {
			s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, "external resolver "+p.External.ADN+" did not answer: "+err.Error())
			return
		}
		resp.Rcode, resp.Answer, resp.Ns = ans.Rcode, stripSigs(ans.Answer, do), stripSigs(ans.Ns, do)
		s.finish(req, resp, ans.Rcode, ans.AuthenticatedData, edeOther, note)
		return
	}
	var fwd *validate.Forwarder
	if resolution != verify.Iterative && len(p.NetworkResolvers) > 0 {
		a := p.NetworkResolvers[0]
		fwd = &validate.Forwarder{Addr: a.Addr, ServerName: strings.TrimSuffix(a.ADN, ".")}
	}
	pub, err := v.Deps.Public(fwd)
	if err != nil {
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNotReady, "validator unavailable: "+err.Error())
		return
	}
	ev, err := pub.Resolve(ctx, qname, qtype)
	switch ev.Security {
	case validate.Secure, validate.Insecure:
		rcode := dns.RcodeSuccess
		if ev.Raw != nil {
			rcode = ev.Raw.Rcode
			resp.Answer = stripSigs(ev.Raw.Answer, do)
			resp.Ns = stripSigs(ev.Raw.Ns, do)
		} else {
			if r, ok := dns.StringToRcode[ev.Rcode]; ok {
				rcode = r
			}
			resp.Answer = ev.Records
		}
		s.finish(req, resp, rcode, ev.Security == validate.Secure, edeOther, note)
	case validate.Bogus:
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeDNSBogus, "DNSSEC validation failed: "+ev.Why)
	case validate.Indeterminate:
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeDNSSECIndeterminate, ev.Why)
	default:
		msg := ev.Why
		if err != nil {
			msg = err.Error()
		}
		s.finish(req, resp, dns.RcodeServerFailure, false, dns.ExtendedErrorCodeNetworkError, msg)
	}
}

// finish sets the rcode and AD bit and, for EDNS clients, attaches an Extended
// DNS Error with the verdict text (RFC 8914).
func (s *Server) finish(req, resp *dns.Msg, rcode int, ad bool, code uint16, text string) {
	resp.Rcode = rcode
	resp.AuthenticatedData = ad
	if opt := req.IsEdns0(); opt != nil {
		resp.SetEdns0(1232, opt.Do())
		if text != "" {
			resp.IsEdns0().Option = append(resp.IsEdns0().Option, &dns.EDNS0_EDE{InfoCode: code, ExtraText: text})
		}
	}
	q := req.Question[0]
	s.logf("%s %s -> %s ad=%v %s", q.Name, dns.TypeToString[q.Qtype], dns.RcodeToString[rcode], ad, text)
}

func stripSigs(rrs []dns.RR, keep bool) []dns.RR {
	if keep {
		return rrs
	}
	out := make([]dns.RR, 0, len(rrs))
	for _, rr := range rrs {
		if rr.Header().Rrtype != dns.TypeRRSIG {
			out = append(out, rr)
		}
	}
	return out
}

// ListenAndServe serves DNS on addr over UDP and TCP until ctx is done.
func (s *Server) ListenAndServe(ctx context.Context, addr string) error {
	udp := &dns.Server{Addr: addr, Net: "udp", Handler: s}
	tcp := &dns.Server{Addr: addr, Net: "tcp", Handler: s}
	errc := make(chan error, 2)
	go func() { errc <- udp.ListenAndServe() }()
	go func() { errc <- tcp.ListenAndServe() }()
	select {
	case <-ctx.Done():
		_ = udp.Shutdown()
		_ = tcp.Shutdown()
		return ctx.Err()
	case err := <-errc:
		_ = udp.Shutdown()
		_ = tcp.Shutdown()
		return err
	}
}

// ControlHandler exposes the proxy's state: GET /status, POST /join
// {"scenario_id","device","resolution"}.
func (s *Server) ControlHandler() http.Handler {
	mux := http.NewServeMux()
	writeJSON := func(w http.ResponseWriter, status int, v any) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(status)
		enc := json.NewEncoder(w)
		enc.SetIndent("", "  ")
		_ = enc.Encode(v)
	}
	mux.HandleFunc("GET /status", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, s.Status()) })
	mux.HandleFunc("GET /log", func(w http.ResponseWriter, r *http.Request) { writeJSON(w, 200, map[string]any{"lines": s.LogLines()}) })
	mux.HandleFunc("POST /join", func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			ScenarioID string `json:"scenario_id"`
			Device     string `json:"device"`
			Resolution string `json:"resolution"`
		}
		dec := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
		dec.DisallowUnknownFields()
		if err := dec.Decode(&req); err != nil || req.ScenarioID == "" {
			writeJSON(w, 422, map[string]string{"error": "invalid request"})
			return
		}
		if err := s.Join(req.ScenarioID, verify.Device(req.Device), verify.Resolution(req.Resolution)); err != nil {
			status := 404
			if errors.Is(err, ErrBadDevice) {
				status = 422
			}
			writeJSON(w, status, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, 200, s.Status())
	})
	return mux
}
