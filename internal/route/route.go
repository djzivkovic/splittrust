// Package route is the demonstration of what a grant is *for*: an explicit
// resolution of one name by the simulated device. Names inside a verified claim
// go to the authorised local resolver with local-answer validation; everything
// else takes the device's default path. Nothing here touches the host's DNS.
package route

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/validate"
	"github.com/djzivkovic/splittrust/internal/verify"
)

// Resolver performs scoped resolution.
type Resolver struct {
	V *verify.Verifier
}

// Report is the outcome of one scoped resolution.
type Report struct {
	QName        string        `json:"qname"`
	QType        string        `json:"qtype"`
	Device       verify.Device `json:"device"`
	Route        string        `json:"route"`        // local | default | none
	RouteReason  string        `json:"route_reason"` // LOCAL_GRANTED | DEFAULT_OUT_OF_SCOPE | DEFAULT_CLAIM_REJECTED | DEFAULT_VERIFICATION_FAILED | BLOCKED_OUT_OF_LAB_SCOPE
	Via          string        `json:"via,omitempty"`
	Answers      []string      `json:"answers"`
	Security     string        `json:"security,omitempty"`
	Verification *verify.Run   `json:"verification,omitempty"`
	ErrorCode    string        `json:"error_code,omitempty"`
	Error        string        `json:"error,omitempty"`
	TrustContext string        `json:"trust_context"`
}

// InScope reports whether qname is at or below one of the scopes, label-wise.
func InScope(qname string, scopes []string) bool {
	q := dns.CanonicalName(qname)
	for _, s := range scopes {
		sc := dns.CanonicalName(s)
		if q == sc || strings.HasSuffix(q, "."+sc) {
			return true
		}
	}
	return false
}

// Resolve resolves qname (type A) for the device described by opt.
func (r *Resolver) Resolve(ctx context.Context, p lab.Profile, qname string, opt verify.Options) Report {
	if opt.Device == "" {
		opt.Device = verify.Device(p.DefaultDevice)
	}
	if opt.Device == "" {
		opt.Device = verify.DeviceValidatingStub
	}
	if opt.Resolution == "" && p.DefaultResolution != "" {
		opt.Resolution = verify.Resolution(p.DefaultResolution)
	}
	if opt.Resolution == "" {
		opt.Resolution = verify.ViaNetwork
	}
	rep := Report{QName: dns.Fqdn(strings.ToLower(qname)), QType: "A", Device: opt.Device, Answers: []string{}, TrustContext: "lab"}
	if p.TrustContext != "" {
		rep.TrustContext = p.TrustContext
	}
	if !lab.Permitted(rep.QName, p.PermittedNamespaces) {
		rep.Route, rep.RouteReason, rep.ErrorCode = "none", "BLOCKED_OUT_OF_LAB_SCOPE", "OUT_OF_LAB_SCOPE"
		rep.Error = fmt.Sprintf("%s is outside the lab namespaces %v; no query sent", rep.QName, p.PermittedNamespaces)
		return rep
	}

	// Which claim, if any, covers this name? Canonicalise without verifying.
	raws, err := r.V.LoadClaims(ctx, p, nil)
	var covering *claim.Canonical
	if err == nil {
		for _, raw := range raws {
			c, err := claim.Canonicalize(raw)
			if err != nil {
				continue
			}
			if InScope(rep.QName, c.Scopes) {
				cc := c
				covering = &cc
				break
			}
		}
	}
	if covering == nil && err == nil {
		rep.Route, rep.RouteReason = "default", "DEFAULT_OUT_OF_SCOPE"
		r.defaultPath(ctx, p, opt, &rep)
		return rep
	}
	// err != nil: the claims could not even be loaded; the verification run below
	// records why (e.g. PVD_INVALID) and the name takes the default path.

	run := r.V.Verify(ctx, p, nil, opt)
	rep.Verification = &run
	var grant *verify.Grant
	for _, cr := range run.Claims {
		if cr.Grant != nil && InScope(rep.QName, cr.Grant.Scopes) {
			grant = cr.Grant
		}
	}
	switch {
	case grant != nil && covering != nil:
		rep.Route, rep.RouteReason = "local", "LOCAL_GRANTED"
		r.localPath(ctx, grant, covering, &rep)
	case run.Decision == "indeterminate":
		rep.Route, rep.RouteReason = "default", "DEFAULT_VERIFICATION_FAILED"
		r.defaultPath(ctx, p, opt, &rep)
	default:
		rep.Route, rep.RouteReason = "default", "DEFAULT_CLAIM_REJECTED"
		r.defaultPath(ctx, p, opt, &rep)
	}
	return rep
}

// localPath queries the authorised resolver and validates the answer with the
// delegated keys (RFC 9704 section 7). Without delegated keys the device cannot
// establish local DNSSEC and returns no answer rather than an unverified one.
func (r *Resolver) localPath(ctx context.Context, g *verify.Grant, c *claim.Canonical, rep *Report) {
	now := time.Now()
	if r.V.Deps.Now != nil {
		now = r.V.Deps.Now()
	}
	rep.Via = g.Resolver + " (" + g.DoTAddr + ")"
	if !g.ExpiresAt.After(now) {
		rep.ErrorCode, rep.Error = "GRANT_EXPIRED", "the grant expired at "+g.ExpiresAt.Format(time.RFC3339)
		return
	}
	if g.LocalDNSSECMode != "delegated" {
		rep.ErrorCode = "LOCAL_DNSSEC_NOT_ESTABLISHED"
		rep.Error = "token-only authorisation: the resolver may answer, but no key was delegated through the Verification Record, so this device cannot validate local answers (RFC 9704 section 7)"
		return
	}
	conn, err := r.V.Deps.DoT.Dial(ctx, g.DoTAddr, strings.TrimSuffix(g.Resolver, "."))
	if err != nil {
		rep.ErrorCode, rep.Error = "LOCAL_LOOKUP_FAILED", err.Error()
		return
	}
	defer conn.Close()
	apex := ""
	for _, s := range c.Scopes {
		if InScope(rep.QName, []string{s}) {
			apex = s
		}
	}
	keysMsg, err := conn.Query(ctx, apex, dns.TypeDNSKEY)
	if err != nil {
		rep.ErrorCode, rep.Error = "LOCAL_LOOKUP_FAILED", err.Error()
		return
	}
	aMsg, err := conn.Query(ctx, rep.QName, dns.TypeA)
	if err != nil {
		rep.ErrorCode, rep.Error = "LOCAL_LOOKUP_FAILED", err.Error()
		return
	}
	var approved []*dns.DNSKEY
	for _, k := range g.AuthorizedKeys {
		rr, err := dns.NewRR(apex + " 3600 IN DNSKEY " + k)
		if err == nil {
			if dk, ok := rr.(*dns.DNSKEY); ok {
				approved = append(approved, dk)
			}
		}
	}
	answers, err := verify.ValidateLocalA(approved, keysMsg, aMsg, now)
	if err != nil {
		rep.ErrorCode, rep.Error = "LOCAL_SIGNATURE_INVALID", err.Error()
		var ve *verify.Error
		if errorsAs(err, &ve) {
			rep.ErrorCode = ve.Code
		}
		return
	}
	rep.Answers = answers
	rep.Security = "secure (local key delegated via ds)"
}

// defaultPath is the device's ordinary resolution: the validating devices use
// their validator (forwarding through the network resolver or iterating); the
// private-dns device asks its external resolver over DoT.
func (r *Resolver) defaultPath(ctx context.Context, p lab.Profile, opt verify.Options, rep *Report) {
	if opt.Device == verify.DevicePrivateDNS {
		rep.Via = p.External.ADN + " (" + p.External.Addr + ")"
		conn, err := r.V.Deps.DoT.Dial(ctx, p.External.Addr, strings.TrimSuffix(p.External.ADN, "."))
		if err != nil {
			rep.ErrorCode, rep.Error = "DEFAULT_LOOKUP_FAILED", err.Error()
			return
		}
		defer conn.Close()
		msg, err := conn.Query(ctx, rep.QName, dns.TypeA)
		if err != nil {
			rep.ErrorCode, rep.Error = "DEFAULT_LOOKUP_FAILED", err.Error()
			return
		}
		rep.Answers = aStrings(msg.Answer)
		rep.Security = fmt.Sprintf("%s, AD=%v (as reported by the external resolver)", dns.RcodeToString[msg.Rcode], msg.AuthenticatedData)
		return
	}
	var fwd *validate.Forwarder
	if opt.Resolution != verify.Iterative && len(p.NetworkResolvers) > 0 {
		a := p.NetworkResolvers[0]
		fwd = &validate.Forwarder{Addr: a.Addr, ServerName: strings.TrimSuffix(a.ADN, ".")}
		rep.Via = "local validator forwarding through " + a.ADN + " (" + a.Addr + ")"
	} else {
		rep.Via = "local validator, iterative from the lab root"
	}
	pub, err := r.V.Deps.Public(fwd)
	if err != nil {
		rep.ErrorCode, rep.Error = "DEFAULT_LOOKUP_FAILED", err.Error()
		return
	}
	ev, err := pub.Resolve(ctx, rep.QName, dns.TypeA)
	rep.Security = string(ev.Security)
	switch ev.Security {
	case validate.Secure, validate.Insecure:
		rep.Answers = aStrings(ev.Records)
		if ev.Rcode != "" && ev.Rcode != "NOERROR" {
			rep.Security = ev.Security.String() + " " + ev.Rcode
		}
	case validate.Bogus:
		rep.ErrorCode, rep.Error = "DEFAULT_LOOKUP_FAILED", "bogus: "+ev.Why
	default:
		msg := ev.Why
		if err != nil {
			msg = err.Error()
		}
		rep.ErrorCode, rep.Error = "DEFAULT_LOOKUP_FAILED", msg
	}
}

func aStrings(rrs []dns.RR) []string {
	out := []string{}
	for _, rr := range rrs {
		if a, ok := rr.(*dns.A); ok {
			out = append(out, a.A.String())
		}
	}
	return out
}
