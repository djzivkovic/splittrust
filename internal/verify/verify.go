// Package verify implements the RFC 9704 verification pipeline for one network
// profile and one simulated device: claim validation, the section 6.2 DNSSEC
// path or the section 6.1 external-resolver path, Verification Record matching,
// resolver identity, section 7 key binding and the resulting grant.
package verify

import (
	"context"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dot"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/pvd"
	"github.com/djzivkovic/splittrust/internal/txtrec"
	"github.com/djzivkovic/splittrust/internal/validate"
)

// Device is the simulated client type (design section 6, DeviceProfile).
type Device string

const (
	// DeviceValidatingStub validates DNSSEC locally; the network resolver is its
	// forwarder; it has no external-resolver policy, so Insecure fails.
	DeviceValidatingStub Device = "validating-stub"
	// DevicePrivateDNS sends everything to an external encrypted resolver by
	// default and verifies through it (RFC 9704 section 6.1).
	DevicePrivateDNS Device = "private-dns"
	// DeviceHybrid validates locally and retries through the external resolver
	// when the zone is Insecure (the section 6.2 "SHOULD retry").
	DeviceHybrid Device = "hybrid"
)

// Devices lists the supported profiles.
var Devices = []Device{DeviceValidatingStub, DevicePrivateDNS, DeviceHybrid}

// Resolution is how a validating device resolves (design section 7).
type Resolution string

const (
	ViaNetwork Resolution = "via-network"
	Iterative  Resolution = "iterative"
)

// PublicFactory builds a fresh validator; fwd is the network's announced
// resolver (nil = iterative from the root hints).
type PublicFactory func(fwd *validate.Forwarder) (validate.PublicResolver, error)

// DoTConn is an authenticated DoT connection.
type DoTConn interface {
	Query(ctx context.Context, qname string, qtype uint16) (*dns.Msg, error)
	Close() error
}

// DoTDialer dials and authenticates DoT endpoints by name.
type DoTDialer interface {
	Dial(ctx context.Context, addr, serverName string) (DoTConn, error)
}

// IdentityError is re-exported so fakes and callers need not import dot.
type IdentityError = dot.IdentityError

// PvDFetcher fetches PvD Additional Information.
type PvDFetcher interface {
	Fetch(ctx context.Context, url, expectedID string, now time.Time) (pvd.Document, error)
}

// Deps are the verifier's injectable dependencies.
type Deps struct {
	Public PublicFactory
	DoT    DoTDialer
	PvD    PvDFetcher
	Now    func() time.Time
}

// Options select the simulated device and resolution path.
type Options struct {
	Device     Device
	Resolution Resolution
}

// Stage is one step of the ordered trace.
type Stage struct {
	ID       string `json:"id"`
	Status   string `json:"status"` // pass | fail | error | skipped
	Code     string `json:"code,omitempty"`
	Message  string `json:"message,omitempty"`
	Evidence any    `json:"evidence,omitempty"`
}

// Grant is the authority established for one resolver.
type Grant struct {
	Resolver        string    `json:"resolver"`
	Scopes          []string  `json:"scopes"`
	ExpiresAt       time.Time `json:"expires_at"`
	AuthorizedKeys  []string  `json:"authorized_keys"`
	LocalDNSSECMode string    `json:"local_dnssec_mode"` // delegated | not_established
	Path            string    `json:"path"`              // dnssec | external
	ExternalAD      bool      `json:"external_ad"`
	DoTAddr         string    `json:"dot_addr"`
}

// ClaimReport is the verdict for one claim.
type ClaimReport struct {
	Index      int               `json:"index"`
	Resolver   string            `json:"resolver"`
	Decision   string            `json:"decision"` // accepted | rejected | indeterminate
	Reason     string            `json:"reason"`
	Stages     []Stage           `json:"stages"`
	Inspection *claim.Inspection `json:"inspection,omitempty"`
	Grant      *Grant            `json:"grant,omitempty"`
}

// Run is the verdict for a whole scenario run.
type Run struct {
	SchemaVersion int           `json:"schema_version"`
	ScenarioID    string        `json:"scenario_id"`
	Device        Device        `json:"device"`
	Resolution    Resolution    `json:"resolution"`
	TrustContext  string        `json:"trust_context"`
	Decision      string        `json:"decision"`
	Claims        []ClaimReport `json:"claims"`
}

// Verifier runs the pipeline.
type Verifier struct {
	Deps Deps
}

var stageOrder = []string{"pvd", "claim", "token", "resolver_tls", "public_dnssec", "external_resolver", "record", "ds", "grant"}

// Verify runs every claim of the profile (from its PvD document or, for inline
// profiles / an explicit claim, the given claim) and returns one report per claim.
func (v *Verifier) Verify(ctx context.Context, p lab.Profile, inline *claim.RawClaim, opt Options) Run {
	if opt.Device == "" {
		opt.Device = Device(p.DefaultDevice)
	}
	if opt.Device == "" {
		opt.Device = DeviceValidatingStub
	}
	if opt.Resolution == "" {
		opt.Resolution = ViaNetwork
	}
	now := v.now()
	run := Run{SchemaVersion: 1, ScenarioID: p.ScenarioID, Device: opt.Device, Resolution: opt.Resolution, TrustContext: "lab"}

	var claims []claim.RawClaim
	pvdStage := Stage{ID: "pvd", Status: "skipped", Code: "INLINE_CLAIM", Message: "claim supplied directly; no PvD document"}
	var pvdExpires time.Time
	switch {
	case inline != nil:
		claims = []claim.RawClaim{*inline}
	case p.ClaimSource == "inline":
		raws, err := readClaims(p.ClaimFile)
		if err != nil {
			run.Claims = []ClaimReport{failedClaim(0, "", pvdStage, Stage{ID: "claim", Status: "error", Code: "INVALID_CLAIM", Message: err.Error()}, "indeterminate", "INVALID_CLAIM")}
			run.Decision = "indeterminate"
			return run
		}
		claims = raws
	default:
		doc, err := v.Deps.PvD.Fetch(ctx, p.PvDURL, p.PvDID, now)
		if err != nil {
			code := "PVD_INVALID"
			var pe *pvd.Error
			if errors.As(err, &pe) {
				code = pe.Code
			}
			run.Claims = []ClaimReport{failedClaim(0, "", Stage{ID: "pvd", Status: "fail", Code: code, Message: err.Error(), Evidence: map[string]any{"url": p.PvDURL, "pvd_id": p.PvDID}}, Stage{}, "rejected", code)}
			run.Decision = "rejected"
			return run
		}
		pvdExpires = doc.Expires
		pvdStage = Stage{ID: "pvd", Status: "pass", Code: "PVD_OK", Message: fmt.Sprintf("%s: %d claim(s), expires %s", p.PvDID, len(doc.Claims), doc.Expires.Format(time.RFC3339)),
			Evidence: map[string]any{"url": p.PvDURL, "identifier": doc.Identifier, "expires": doc.Expires, "prefixes": doc.Prefixes, "claims": len(doc.Claims)}}
		claims = doc.Claims
		if len(claims) == 0 {
			run.Claims = []ClaimReport{failedClaim(0, "", pvdStage, Stage{ID: "claim", Status: "fail", Code: "PVD_INVALID", Message: "splitDnsClaims is empty"}, "rejected", "PVD_INVALID")}
			run.Decision = "rejected"
			return run
		}
	}

	for i, raw := range claims {
		run.Claims = append(run.Claims, v.verifyClaim(ctx, p, i, raw, pvdStage, pvdExpires, opt, now))
	}
	run.Decision = worst(run.Claims)
	return run
}

// LoadClaims returns the raw claims a run would verify (PvD document, inline
// claim file, or the explicit claim) without verifying anything.
func (v *Verifier) LoadClaims(ctx context.Context, p lab.Profile, inline *claim.RawClaim) ([]claim.RawClaim, error) {
	switch {
	case inline != nil:
		return []claim.RawClaim{*inline}, nil
	case p.ClaimSource == "inline":
		return readClaims(p.ClaimFile)
	default:
		doc, err := v.Deps.PvD.Fetch(ctx, p.PvDURL, p.PvDID, v.now())
		if err != nil {
			return nil, err
		}
		return doc.Claims, nil
	}
}

func (v *Verifier) now() time.Time {
	if v.Deps.Now != nil {
		return v.Deps.Now().UTC()
	}
	return time.Now().UTC()
}

type trace struct {
	stages []Stage
	seen   map[string]bool
}

func (t *trace) add(s Stage) {
	if t.seen == nil {
		t.seen = map[string]bool{}
	}
	t.seen[s.ID] = true
	t.stages = append(t.stages, s)
}

// finish appends skipped stages for everything not yet reported, in order.
func (t *trace) finish(code, message string) []Stage {
	for _, id := range stageOrder {
		if !t.seen[id] {
			t.add(Stage{ID: id, Status: "skipped", Code: code, Message: message})
		}
	}
	ordered := make([]Stage, 0, len(stageOrder))
	for _, id := range stageOrder {
		for _, s := range t.stages {
			if s.ID == id {
				ordered = append(ordered, s)
			}
		}
	}
	return ordered
}

func failedClaim(i int, resolver string, pvdStage, failing Stage, decision, reason string) ClaimReport {
	tr := &trace{}
	tr.add(pvdStage)
	if failing.ID != "" {
		tr.add(failing)
	}
	return ClaimReport{Index: i, Resolver: resolver, Decision: decision, Reason: reason, Stages: tr.finish("NOT_REACHED", "")}
}

func (v *Verifier) verifyClaim(ctx context.Context, p lab.Profile, i int, raw claim.RawClaim, pvdStage Stage, pvdExpires time.Time, opt Options, now time.Time) ClaimReport {
	rep := ClaimReport{Index: i, Resolver: strings.TrimSuffix(raw.Resolver, ".")}
	tr := &trace{}
	tr.add(pvdStage)
	reject := func(stage, code, msg string, ev any) ClaimReport {
		tr.add(Stage{ID: stage, Status: "fail", Code: code, Message: msg, Evidence: ev})
		rep.Decision, rep.Reason = "rejected", code
		rep.Stages = tr.finish("NOT_REACHED", "")
		return rep
	}
	indeterminate := func(stage, code, msg string, ev any) ClaimReport {
		tr.add(Stage{ID: stage, Status: "error", Code: code, Message: msg, Evidence: ev})
		rep.Decision, rep.Reason = "indeterminate", code
		rep.Stages = tr.finish("NOT_REACHED", "")
		return rep
	}

	// --- claim: validation before any network traffic -----------------------
	c, err := claim.Canonicalize(raw)
	if err != nil {
		code := "INVALID_CLAIM"
		var ce *claim.Error
		if errors.As(err, &ce) {
			code = ce.Code
		}
		return reject("claim", code, err.Error(), nil)
	}
	rep.Resolver = strings.TrimSuffix(c.Resolver, ".")
	if err := claim.CheckSpecialUse(c); err != nil {
		return reject("claim", "SPECIAL_USE_NAME", err.Error(), map[string]any{"parent": c.Parent})
	}
	if !lab.Permitted(c.Parent, p.PermittedNamespaces) {
		return reject("claim", "OUT_OF_LAB_SCOPE", fmt.Sprintf("parent %s is outside the lab namespaces %v; no traffic sent", c.Parent, p.PermittedNamespaces), nil)
	}
	announced, ok := p.AnnouncedFor(c.Resolver)
	if !ok {
		return reject("claim", "CLAIM_RESOLVER_MISMATCH", fmt.Sprintf("claim names resolver %s but the network announced %v (RFC 9704 section 5: the DNR name MUST be the name used in the claim)", c.Resolver, adns(p.NetworkResolvers)), nil)
	}
	ins, err := claim.InspectCanonical(c)
	if err != nil {
		return reject("claim", "INVALID_CLAIM", err.Error(), nil)
	}
	rep.Inspection = &ins
	claimEv := map[string]any{"discovery": p.Discovery, "announced_addr": announced.Addr, "scopes": c.Scopes, "warnings": c.Warnings}
	tr.add(Stage{ID: "claim", Status: "pass", Code: "CLAIM_OK", Message: fmt.Sprintf("%s claims %s under %s", c.Resolver, strings.Join(c.Relative, ", "), c.Parent), Evidence: claimEv})
	tr.add(Stage{ID: "token", Status: "pass", Code: "TOKEN_COMPUTED", Message: "expected token " + ins.Token, Evidence: map[string]any{"token": ins.Token, "record_owner": ins.RecordOwner, "pseudo_wire_hex": ins.PseudoWireHex, "token_input_hex": ins.TokenInputHex}})

	// --- resolver_tls: authenticate the announced resolver before trusting a byte
	// from it (RFC 9704 section 8 steps 3-5; section 5 certificate requirement) ----
	conn, err := v.Deps.DoT.Dial(ctx, announced.Addr, strings.TrimSuffix(c.Resolver, "."))
	if err != nil {
		var ie *IdentityError
		if errors.As(err, &ie) {
			return reject("resolver_tls", "TLS_IDENTITY_FAILED", fmt.Sprintf("the resolver at %s does not hold a certificate for %s: %v — the claim's expected token %s was never looked up", announced.Addr, c.Resolver, ie.Err, ins.Token), map[string]any{"addr": announced.Addr, "server_name": c.Resolver, "expected_token": ins.Token})
		}
		return indeterminate("resolver_tls", "RESOLVER_UNREACHABLE", fmt.Sprintf("cannot reach the resolver at %s: %v", announced.Addr, err), map[string]any{"addr": announced.Addr})
	}
	defer conn.Close()
	tr.add(Stage{ID: "resolver_tls", Status: "pass", Code: "TLS_IDENTITY_OK", Message: fmt.Sprintf("%s authenticated as %s over DoT", announced.Addr, c.Resolver), Evidence: map[string]any{"addr": announced.Addr, "server_name": c.Resolver}})

	// --- public_dnssec (section 6.2) / external_resolver (section 6.1) ------
	var records []dns.RR
	var ttl uint32
	var sigExpiry *time.Time
	path := "dnssec"
	externalAD := false
	useExternal := opt.Device == DevicePrivateDNS

	if opt.Device == DevicePrivateDNS {
		tr.add(Stage{ID: "public_dnssec", Status: "skipped", Code: "NOT_APPLICABLE", Message: "this device does not validate DNSSEC; its default resolver is the external encrypted resolver"})
	} else {
		var fwd *validate.Forwarder
		if opt.Resolution == ViaNetwork {
			fwd = &validate.Forwarder{Addr: announced.Addr, ServerName: strings.TrimSuffix(announced.ADN, ".")}
			if p.Discovery == "ddr" {
				fwd.ServerName = strings.TrimSuffix(c.Resolver, ".")
			}
		}
		resolver, err := v.Deps.Public(fwd)
		if err != nil {
			return indeterminate("public_dnssec", "DNS_LOOKUP_FAILED", "validator unavailable: "+err.Error(), nil)
		}
		ev, err := resolver.Resolve(ctx, ins.RecordOwner, dns.TypeTXT)
		switch ev.Security {
		case validate.Secure:
			tr.add(Stage{ID: "public_dnssec", Status: "pass", Code: "DNSSEC_SECURE", Message: fmt.Sprintf("%s TXT validated Secure (%s)", ins.RecordOwner, describe(ev)), Evidence: ev})
			if ev.Rcode == "NXDOMAIN" || len(txtRecords(ev.Records)) == 0 {
				return reject("record", "RECORD_MISSING", fmt.Sprintf("authenticated denial: %s has no Verification Record (%s)", ins.RecordOwner, ev.Rcode), ev)
			}
			records, ttl, sigExpiry = ev.Records, ev.TTL, ev.RRSIGExpiresAt
		case validate.Bogus:
			return reject("public_dnssec", "DNSSEC_BOGUS", "DNSSEC validation failed: "+ev.Why, ev)
		case validate.Indeterminate:
			return reject("public_dnssec", "DNSSEC_INDETERMINATE", "no trust anchor covers this name: "+ev.Why, ev)
		case validate.Insecure:
			if opt.Device == DeviceHybrid {
				tr.add(Stage{ID: "public_dnssec", Status: "pass", Code: "DNSSEC_INSECURE", Message: "zone is provably unsigned; this device retries through its external resolver (RFC 9704 section 6.2)", Evidence: ev})
				useExternal = true
			} else {
				return reject("public_dnssec", "DNSSEC_INSECURE_NO_FALLBACK", "zone is provably unsigned and this device has no external-resolver policy: RFC 9704 section 6.2 says validation MUST be considered failed", ev)
			}
		default:
			msg := ev.Why
			if err != nil {
				msg = err.Error()
			}
			return indeterminate("public_dnssec", "DNS_LOOKUP_FAILED", "could not resolve the Verification Record: "+msg, ev)
		}
	}

	if useExternal {
		path = "external"
		conn, err := v.Deps.DoT.Dial(ctx, p.External.Addr, strings.TrimSuffix(p.External.ADN, "."))
		if err != nil {
			return reject("external_resolver", "EXTERNAL_TIMEOUT", fmt.Sprintf("no response from the external resolver %s (%s): %v — RFC 9704 section 6.1: verification MUST be considered failed", p.External.ADN, p.External.Addr, err), map[string]any{"external": p.External})
		}
		msg, err := conn.Query(ctx, ins.RecordOwner, dns.TypeTXT)
		conn.Close()
		if err != nil {
			return reject("external_resolver", "EXTERNAL_TIMEOUT", fmt.Sprintf("external resolver %s did not answer: %v", p.External.ADN, err), map[string]any{"external": p.External})
		}
		externalAD = msg.AuthenticatedData
		extEv := map[string]any{"external": p.External, "rcode": dns.RcodeToString[msg.Rcode], "ad": externalAD, "answers": rrStrings(msg.Answer)}
		if msg.Rcode == dns.RcodeNameError || len(txtRecords(msg.Answer)) == 0 {
			tr.add(Stage{ID: "external_resolver", Status: "pass", Code: "EXTERNAL_ANSWERED", Message: "external resolver answered", Evidence: extEv})
			return reject("record", "RECORD_MISSING", fmt.Sprintf("%s has no Verification Record according to %s (%s)", ins.RecordOwner, p.External.ADN, dns.RcodeToString[msg.Rcode]), extEv)
		}
		tr.add(Stage{ID: "external_resolver", Status: "pass", Code: "EXTERNAL_ANSWERED", Message: fmt.Sprintf("%s answered over authenticated DoT (AD=%v)", p.External.ADN, externalAD), Evidence: extEv})
		records = msg.Answer
		ttl = minTTL(records)
		sigExpiry = validate.EarliestRRSIGExpiry(msg.Answer)
	} else {
		tr.add(Stage{ID: "external_resolver", Status: "skipped", Code: "NOT_APPLICABLE", Message: "DNSSEC path succeeded; no external query needed"})
	}

	// --- record -------------------------------------------------------------
	var matching []txtrec.Record
	var parsed, invalid int
	var recordEv []string
	for _, rr := range txtRecords(records) {
		rec, err := txtrec.ParseRR(rr.Txt)
		recordEv = append(recordEv, rr.String())
		if err != nil {
			invalid++
			continue
		}
		parsed++
		if rec.Token == ins.Token {
			matching = append(matching, rec)
		}
	}
	if parsed == 0 {
		return reject("record", "RECORD_INVALID", fmt.Sprintf("%d TXT RR(s) at %s but none is a well-formed Verification Record", invalid, ins.RecordOwner), map[string]any{"rrs": recordEv})
	}
	if len(matching) == 0 {
		return reject("record", "TOKEN_MISMATCH", fmt.Sprintf("none of the %d Verification Record(s) carries the expected token %s", parsed, ins.Token), map[string]any{"rrs": recordEv, "expected_token": ins.Token})
	}
	tr.add(Stage{ID: "record", Status: "pass", Code: "TOKEN_MATCH", Message: fmt.Sprintf("%d of %d record(s) carry the expected token", len(matching), parsed), Evidence: map[string]any{"rrs": recordEv, "expected_token": ins.Token, "invalid_rrs": invalid}})

	// --- ds (section 7) -----------------------------------------------------
	var dsValues []string
	for _, rec := range matching {
		dsValues = append(dsValues, rec.DS...)
	}
	grant := &Grant{Resolver: c.Resolver, Scopes: c.Scopes, LocalDNSSECMode: "not_established", Path: path, ExternalAD: externalAD, DoTAddr: announced.Addr, AuthorizedKeys: []string{}}
	switch {
	case path == "external":
		tr.add(Stage{ID: "ds", Status: "skipped", Code: "NOT_APPLICABLE", Message: "RFC 9704 section 7 key binding presumes DNSSEC validation; not used on the external path"})
	case len(dsValues) == 0:
		tr.add(Stage{ID: "ds", Status: "skipped", Code: "DS_NOT_PRESENT", Message: "token-only Verification Record: resolver authorised, no local DNSSEC key delegated"})
	default:
		msg, err := conn.Query(ctx, "resolver.arpa.", dns.TypeDNSKEY)
		if err != nil {
			return indeterminate("ds", "RESOLVER_UNREACHABLE", "DNSKEY resolver.arpa. query failed: "+err.Error(), nil)
		}
		var keys []*dns.DNSKEY
		for _, rr := range msg.Answer {
			if k, ok := rr.(*dns.DNSKEY); ok {
				keys = append(keys, k)
			}
		}
		approved := MatchDS(dsValues, keys)
		dsEv := map[string]any{"ds_values": dsValues, "resolver_arpa_dnskeys": rrStrings(msg.Answer), "approved": len(approved)}
		if len(approved) == 0 {
			return reject("ds", "DS_MISMATCH", fmt.Sprintf("%d ds value(s) published, %d DNSKEY(s) presented for resolver.arpa., none matches (RFC 9704 section 7)", len(dsValues), len(keys)), dsEv)
		}
		for _, k := range approved {
			grant.AuthorizedKeys = append(grant.AuthorizedKeys, dnskeyRDATA(k))
		}
		grant.LocalDNSSECMode = "delegated"
		tr.add(Stage{ID: "ds", Status: "pass", Code: "DS_MATCH", Message: fmt.Sprintf("%d DNSKEY(s) for resolver.arpa. match the published ds value(s)", len(approved)), Evidence: dsEv})
	}

	// --- grant --------------------------------------------------------------
	grant.ExpiresAt = now.Add(time.Duration(ttl) * time.Second)
	if sigExpiry != nil && sigExpiry.Before(grant.ExpiresAt) {
		grant.ExpiresAt = sigExpiry.UTC()
	}
	if !pvdExpires.IsZero() && pvdExpires.Before(grant.ExpiresAt) {
		grant.ExpiresAt = pvdExpires.UTC()
	}
	reason := "AUTHORIZED"
	if path == "external" {
		reason = "EXTERNAL_TOKEN_MATCH"
	}
	tr.add(Stage{ID: "grant", Status: "pass", Code: reason, Message: fmt.Sprintf("%s may answer for %s until %s (%s, local DNSSEC %s)", c.Resolver, strings.Join(c.Scopes, ", "), grant.ExpiresAt.Format(time.RFC3339), path, grant.LocalDNSSECMode), Evidence: grant})
	rep.Decision, rep.Reason, rep.Grant = "accepted", reason, grant
	rep.Stages = tr.finish("NOT_REACHED", "")
	return rep
}

func worst(claims []ClaimReport) string {
	out := "accepted"
	for _, c := range claims {
		switch c.Decision {
		case "indeterminate":
			return "indeterminate"
		case "rejected":
			out = "rejected"
		}
	}
	return out
}

func readClaims(path string) ([]claim.RawClaim, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	var raws []claim.RawClaim
	if err := jsonUnmarshalClaims(b, &raws); err != nil {
		return nil, err
	}
	if len(raws) == 0 {
		return nil, errors.New("claim file is empty")
	}
	return raws, nil
}

func txtRecords(rrs []dns.RR) []*dns.TXT {
	var out []*dns.TXT
	for _, rr := range rrs {
		if t, ok := rr.(*dns.TXT); ok {
			out = append(out, t)
		}
	}
	return out
}

func rrStrings(rrs []dns.RR) []string {
	out := []string{}
	for _, rr := range rrs {
		out = append(out, rr.String())
	}
	return out
}

func adns(a []lab.Announced) []string {
	var out []string
	for _, x := range a {
		out = append(out, x.ADN)
	}
	return out
}

func minTTL(rrs []dns.RR) uint32 {
	var ttl uint32
	for _, rr := range rrs {
		if rr.Header().Rrtype == dns.TypeRRSIG {
			continue
		}
		if ttl == 0 || rr.Header().Ttl < ttl {
			ttl = rr.Header().Ttl
		}
	}
	return ttl
}

func describe(ev validate.Evidence) string {
	if ev.Forwarder != "" {
		return "via " + ev.Forwarder
	}
	return ev.Resolution
}

func dnskeyRDATA(k *dns.DNSKEY) string {
	return fmt.Sprintf("%d %d %d %s", k.Flags, k.Protocol, k.Algorithm, k.PublicKey)
}
