package route

import (
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/pvd"
	"github.com/djzivkovic/splittrust/internal/validate"
	"github.com/djzivkovic/splittrust/internal/verify"
)

const (
	localDoT    = "172.30.97.20:853"
	externalDoT = "172.30.97.40:853"
)

type fakePublic struct {
	calls   int
	answers map[string]validate.Evidence
}

func (f *fakePublic) Resolve(_ context.Context, qname string, qtype uint16) (validate.Evidence, error) {
	f.calls++
	if ev, ok := f.answers[dns.Fqdn(qname)+"/"+dns.TypeToString[qtype]]; ok {
		return ev, nil
	}
	return validate.Evidence{Security: validate.Secure, Rcode: "NXDOMAIN"}, nil
}

func (f *fakePublic) Describe() (string, string) { return "via-network", "fake" }

type fakeConn struct {
	addr    string
	queries *[]string
}

func (c *fakeConn) Query(_ context.Context, qname string, qtype uint16) (*dns.Msg, error) {
	*c.queries = append(*c.queries, c.addr+" "+dns.Fqdn(qname)+"/"+dns.TypeToString[qtype])
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(qname), qtype)
	if qtype == dns.TypeA {
		m.Answer = []dns.RR{&dns.A{Hdr: dns.RR_Header{Name: dns.Fqdn(qname), Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60}, A: []byte{172, 30, 97, 80}}}
	}
	return m, nil
}

func (c *fakeConn) Close() error { return nil }

type fakeDialer struct {
	dials   []string
	queries []string
}

func (d *fakeDialer) Dial(_ context.Context, addr, serverName string) (verify.DoTConn, error) {
	d.dials = append(d.dials, addr+"#"+serverName)
	return &fakeConn{addr: addr, queries: &d.queries}, nil
}

type fakePvD struct {
	doc pvd.Document
	err error
}

func (p *fakePvD) Fetch(context.Context, string, string, time.Time) (pvd.Document, error) {
	return p.doc, p.err
}

func profile() lab.Profile {
	return lab.Profile{
		ScenarioID: "legit", Discovery: "dnr", ClaimSource: "pvd", PvDID: "pvd.corp.lab", PvDURL: "https://pvd.corp.lab/.well-known/pvd",
		NetworkResolvers:    []lab.Announced{{ADN: "dns.corp.lab", Addr: localDoT}},
		External:            lab.Announced{ADN: "quad9.lab", Addr: externalDoT},
		DefaultDevice:       "validating-stub",
		PermittedNamespaces: []string{"lab.", "arpa."},
	}
}

func corpClaim() claim.RawClaim {
	salt := make([]byte, 16)
	return claim.RawClaim{Resolver: "dns.corp.lab", Parent: "corp.lab", Subdomains: []string{"internal"}, Algorithm: "SHA384", Salt: base64.RawURLEncoding.EncodeToString(salt)}
}

func newResolver(pub *fakePublic, dialer *fakeDialer, pvdErr error) *Resolver {
	doc := pvd.Document{Identifier: "pvd.corp.lab", Expires: time.Now().Add(time.Hour), Claims: []claim.RawClaim{corpClaim()}}
	deps := verify.Deps{
		Public: func(*validate.Forwarder) (validate.PublicResolver, error) { return pub, nil },
		DoT:    dialer,
		PvD:    &fakePvD{doc: doc, err: pvdErr},
	}
	return &Resolver{V: &verify.Verifier{Deps: deps}}
}

func TestInScopeIsLabelWise(t *testing.T) {
	if InScope("internal.corp.lab.evil.lab.", []string{"internal.corp.lab."}) {
		t.Error("string suffix accepted as scope")
	}
	if !InScope("host.internal.corp.lab", []string{"internal.corp.lab."}) || !InScope("INTERNAL.corp.lab.", []string{"internal.corp.lab."}) {
		t.Error("label-wise suffix not accepted")
	}
	if !InScope("www.banka.lab.", []string{"banka.lab."}) {
		t.Error("whole-zone scope not accepted")
	}
}

func TestLabelSuffixNotStringSuffix(t *testing.T) {
	pub := &fakePublic{}
	r := newResolver(pub, &fakeDialer{}, nil)
	rep := r.Resolve(context.Background(), profile(), "internal.corp.lab.evil.lab.", verify.Options{Device: verify.DeviceValidatingStub})
	if rep.Route != "default" || rep.Verification != nil {
		t.Fatalf("route=%s verification=%v", rep.Route, rep.Verification != nil)
	}
}

func TestOutOfLabMakesNoCalls(t *testing.T) {
	pub := &fakePublic{}
	d := &fakeDialer{}
	r := newResolver(pub, d, nil)
	rep := r.Resolve(context.Background(), profile(), "example.com.", verify.Options{Device: verify.DeviceValidatingStub})
	if rep.Route != "none" || rep.ErrorCode != "OUT_OF_LAB_SCOPE" {
		t.Fatalf("route=%s code=%s", rep.Route, rep.ErrorCode)
	}
	if pub.calls != 0 || len(d.dials) != 0 {
		t.Errorf("network touched: validator=%d dials=%v", pub.calls, d.dials)
	}
}

func TestRejectedClaimKeepsDefault(t *testing.T) {
	// The PvD fetch fails, so the claim is rejected; the in-scope name must still
	// resolve through the device's default path, never through the local resolver.
	pub := &fakePublic{answers: map[string]validate.Evidence{
		"host.internal.corp.lab./A": {Security: validate.Insecure, Rcode: "NOERROR", Records: []dns.RR{&dns.A{Hdr: dns.RR_Header{Name: "host.internal.corp.lab.", Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60}, A: []byte{10, 0, 5, 20}}}},
	}}
	d := &fakeDialer{}
	r := newResolver(pub, d, errors.New("pvd unreachable"))
	rep := r.Resolve(context.Background(), profile(), "host.internal.corp.lab.", verify.Options{Device: verify.DeviceValidatingStub})
	if rep.Route != "default" || rep.RouteReason != "DEFAULT_CLAIM_REJECTED" {
		t.Fatalf("route=%s reason=%s code=%s", rep.Route, rep.RouteReason, rep.ErrorCode)
	}
	if len(d.queries) != 0 {
		t.Errorf("local resolver queried after rejection: %v", d.queries)
	}
	if len(rep.Answers) != 1 || rep.Answers[0] != "10.0.5.20" {
		t.Errorf("default answers = %v", rep.Answers)
	}
}

func TestDefaultRouteFollowsDevice(t *testing.T) {
	pub := &fakePublic{}
	d := &fakeDialer{}
	r := newResolver(pub, d, nil)
	rep := r.Resolve(context.Background(), profile(), "www.banka.lab.", verify.Options{Device: verify.DevicePrivateDNS})
	if rep.Route != "default" || rep.RouteReason != "DEFAULT_OUT_OF_SCOPE" {
		t.Fatalf("route=%s reason=%s", rep.Route, rep.RouteReason)
	}
	if pub.calls != 0 || len(d.dials) != 1 || d.dials[0] != externalDoT+"#quad9.lab" {
		t.Errorf("private-dns default route must use the external resolver only: validator=%d dials=%v", pub.calls, d.dials)
	}
	if len(rep.Answers) != 1 || rep.Answers[0] != "172.30.97.80" {
		t.Errorf("answers = %v", rep.Answers)
	}
}
