package verify

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/pvd"
	"github.com/djzivkovic/splittrust/internal/txtrec"
	"github.com/djzivkovic/splittrust/internal/validate"
)

// ----------------------------------------------------------------- fakes

type fakeResolver struct {
	calls   *int
	results map[string]validate.Evidence // qname -> evidence
}

func (f *fakeResolver) Resolve(_ context.Context, qname string, qtype uint16) (validate.Evidence, error) {
	*f.calls++
	ev, ok := f.results[dns.Fqdn(qname)]
	if !ok {
		return validate.Evidence{QName: qname, Security: validate.ErrorState, Why: "no scripted answer"}, errors.New("no scripted answer for " + qname)
	}
	ev.QName = dns.Fqdn(qname)
	if ev.Security == validate.ErrorState {
		return ev, errors.New(ev.Why)
	}
	return ev, nil
}

func (f *fakeResolver) Describe() (string, string) { return "via-network", "fake" }

type fakeConn struct {
	answers map[string]*dns.Msg // "qname/TYPE" -> msg
	queries *[]string
}

func (c *fakeConn) Query(_ context.Context, qname string, qtype uint16) (*dns.Msg, error) {
	key := dns.Fqdn(qname) + "/" + dns.TypeToString[qtype]
	*c.queries = append(*c.queries, key)
	if m, ok := c.answers[key]; ok {
		return m, nil
	}
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(qname), qtype)
	m.Rcode = dns.RcodeNameError
	return m, nil
}

func (c *fakeConn) Close() error { return nil }

type endpoint struct {
	identityErr bool
	dialErr     error
	answers     map[string]*dns.Msg
}

type fakeDialer struct {
	endpoints map[string]*endpoint // addr -> behaviour
	dials     []string             // "addr#serverName"
	queries   []string
}

func (d *fakeDialer) Dial(_ context.Context, addr, serverName string) (DoTConn, error) {
	d.dials = append(d.dials, addr+"#"+serverName)
	ep, ok := d.endpoints[addr]
	if !ok {
		return nil, errors.New("dial " + addr + ": connection refused")
	}
	if ep.dialErr != nil {
		return nil, ep.dialErr
	}
	if ep.identityErr {
		return nil, &IdentityError{ServerName: serverName, Err: errors.New("x509: certificate is valid for dns.hotel.lab, not " + serverName)}
	}
	return &fakeConn{answers: ep.answers, queries: &d.queries}, nil
}

type fakePvD struct {
	doc pvd.Document
	err error
}

func (p *fakePvD) Fetch(context.Context, string, string, time.Time) (pvd.Document, error) {
	return p.doc, p.err
}

// ----------------------------------------------------------------- fixtures

var now = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

const (
	localDoT    = "172.30.97.20:853"
	hotelDoT    = "172.30.97.21:853"
	externalDoT = "172.30.97.40:853"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func seq16() []byte {
	b := make([]byte, 16)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}

func corpClaim() claim.RawClaim {
	return claim.RawClaim{Resolver: "dns.corp.lab", Parent: "corp.lab", Subdomains: []string{"internal"}, Algorithm: "SHA384", Salt: b64(seq16())}
}

func corpProfile() lab.Profile {
	return lab.Profile{
		ScenarioID: "legit", Discovery: "dnr", ClaimSource: "pvd", PvDID: "pvd.corp.lab", PvDURL: "https://pvd.corp.lab/.well-known/pvd",
		NetworkResolvers:    []lab.Announced{{ADN: "dns.corp.lab", Addr: localDoT}},
		External:            lab.Announced{ADN: "quad9.lab", Addr: externalDoT},
		DefaultDevice:       "validating-stub",
		PermittedNamespaces: []string{"lab.", "arpa."},
	}
}

func tokenOf(t *testing.T, raw claim.RawClaim) (string, string) {
	t.Helper()
	ins, err := claim.Inspect(raw)
	if err != nil {
		t.Fatal(err)
	}
	return ins.Token, ins.RecordOwner
}

func txtRR(owner, rdata string, ttl uint32) dns.RR {
	return &dns.TXT{Hdr: dns.RR_Header{Name: owner, Rrtype: dns.TypeTXT, Class: dns.ClassINET, Ttl: ttl}, Txt: []string{rdata}}
}

func secureTXT(owner string, ttl uint32, sigExpiry time.Time, rdatas ...string) validate.Evidence {
	ev := validate.Evidence{Security: validate.Secure, Rcode: "NOERROR", TTL: ttl, Resolution: "via-network"}
	for _, r := range rdatas {
		rr := txtRR(owner, r, ttl)
		ev.Records = append(ev.Records, rr)
		ev.Answer = append(ev.Answer, rr.String())
	}
	exp := sigExpiry
	ev.RRSIGExpiresAt = &exp
	return ev
}

func newKey(t *testing.T, owner string, flags uint16) (*dns.DNSKEY, crypto.Signer) {
	t.Helper()
	k := &dns.DNSKEY{Hdr: dns.RR_Header{Name: owner, Rrtype: dns.TypeDNSKEY, Class: dns.ClassINET, Ttl: 3600}, Flags: flags, Protocol: 3, Algorithm: dns.ECDSAP256SHA256}
	priv, err := k.Generate(256)
	if err != nil {
		t.Fatal(err)
	}
	return k, priv.(*ecdsa.PrivateKey)
}

func dsOf(k *dns.DNSKEY) string {
	ds := k.ToDS(dns.SHA256)
	rdata := binary.BigEndian.AppendUint16(nil, ds.KeyTag)
	rdata = append(rdata, ds.Algorithm, ds.DigestType)
	digest, _ := hex.DecodeString(ds.Digest)
	return b64(append(rdata, digest...))
}

func signSet(t *testing.T, set []dns.RR, key *dns.DNSKEY, signer crypto.Signer, incep, exp time.Time) *dns.RRSIG {
	t.Helper()
	h := set[0].Header()
	sig := &dns.RRSIG{Hdr: dns.RR_Header{Name: h.Name, Rrtype: dns.TypeRRSIG, Class: dns.ClassINET, Ttl: h.Ttl},
		TypeCovered: h.Rrtype, Algorithm: key.Algorithm, Labels: uint8(dns.CountLabel(h.Name)), OrigTtl: h.Ttl,
		Expiration: uint32(exp.Unix()), Inception: uint32(incep.Unix()), KeyTag: key.KeyTag(), SignerName: key.Hdr.Name}
	if err := sig.Sign(signer, set); err != nil {
		t.Fatal(err)
	}
	return sig
}

func dnskeyMsg(owner string, keys ...*dns.DNSKEY) *dns.Msg {
	m := new(dns.Msg)
	m.SetQuestion(owner, dns.TypeDNSKEY)
	for _, k := range keys {
		kk := *k
		kk.Hdr.Name = owner
		m.Answer = append(m.Answer, &kk)
	}
	return m
}

type harness struct {
	resolverCalls int
	dialer        *fakeDialer
	v             *Verifier
}

func newHarness(t *testing.T, ev validate.Evidence, pvdDoc pvd.Document, endpoints map[string]*endpoint) *harness {
	t.Helper()
	h := &harness{dialer: &fakeDialer{endpoints: endpoints}}
	owner := ""
	for _, rr := range ev.Records {
		owner = rr.Header().Name
	}
	results := map[string]validate.Evidence{}
	if owner != "" {
		results[owner] = ev
	} else {
		_, owner = tokenOf(t, pvdDoc.Claims[0])
		results[owner] = ev
	}
	h.v = &Verifier{Deps: Deps{
		Public: func(*validate.Forwarder) (validate.PublicResolver, error) {
			return &fakeResolver{calls: &h.resolverCalls, results: results}, nil
		},
		DoT: h.dialer,
		PvD: &fakePvD{doc: pvdDoc},
		Now: func() time.Time { return now },
	}}
	return h
}

func pvdWith(claims ...claim.RawClaim) pvd.Document {
	return pvd.Document{Identifier: "pvd.corp.lab", Expires: now.Add(36 * time.Hour), Prefixes: []string{"2001:db8::/48"}, Claims: claims}
}

func localEndpoint(resolverArpa *dns.Msg) *endpoint {
	answers := map[string]*dns.Msg{}
	if resolverArpa != nil {
		answers["resolver.arpa./DNSKEY"] = resolverArpa
	}
	return &endpoint{answers: answers}
}

// ----------------------------------------------------------------- tests

func TestResolverMismatchRejectsBeforeDNS(t *testing.T) {
	evil := corpClaim()
	evil.Resolver = "dns.evil.lab"
	tok, _ := tokenOf(t, evil)
	_, owner := tokenOf(t, evil)
	h := newHarness(t, secureTXT(owner, 60, now.Add(time.Hour), txtrec.Format(tok, nil)), pvdWith(evil), map[string]*endpoint{localDoT: localEndpoint(nil)})
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	if run.Decision != "rejected" || run.Claims[0].Reason != "CLAIM_RESOLVER_MISMATCH" {
		t.Fatalf("decision %s reason %s", run.Decision, run.Claims[0].Reason)
	}
	if h.resolverCalls != 0 {
		t.Errorf("validator called %d times before the claim was accepted", h.resolverCalls)
	}
	// DDR discovery has no announced name: the certificate is the only binding.
	p := corpProfile()
	p.Discovery = "ddr"
	p.NetworkResolvers = []lab.Announced{{Addr: localDoT}}
	run = h.v.Verify(context.Background(), p, nil, Options{Device: DeviceValidatingStub})
	if run.Claims[0].Reason == "CLAIM_RESOLVER_MISMATCH" {
		t.Errorf("ddr profile must not require name binding")
	}
}

func TestWrongDSRejectsDespiteTokenOnlyRR(t *testing.T) {
	ksk, _ := newKey(t, "resolver.arpa.", 257)
	other, _ := newKey(t, "resolver.arpa.", 257)
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	ev := secureTXT(owner, 60, now.Add(time.Hour), txtrec.Format(tok, []string{dsOf(other)}), txtrec.Format(tok, nil))
	h := newHarness(t, ev, pvdWith(raw), map[string]*endpoint{localDoT: localEndpoint(dnskeyMsg("resolver.arpa.", ksk))})
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	if run.Decision != "rejected" || run.Claims[0].Reason != "DS_MISMATCH" || run.Claims[0].Grant != nil {
		t.Fatalf("%s %s grant=%v", run.Decision, run.Claims[0].Reason, run.Claims[0].Grant)
	}
}

func TestTokenOnlyGrantNotEstablished(t *testing.T) {
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	h := newHarness(t, secureTXT(owner, 60, now.Add(time.Hour), txtrec.Format(tok, nil)), pvdWith(raw), map[string]*endpoint{localDoT: localEndpoint(nil)})
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	c := run.Claims[0]
	if run.Decision != "accepted" || c.Reason != "AUTHORIZED" || c.Grant == nil || c.Grant.LocalDNSSECMode != "not_established" {
		t.Fatalf("%s %s grant=%+v", run.Decision, c.Reason, c.Grant)
	}
	if st := stage(c, "ds"); st.Status != "skipped" || st.Code != "DS_NOT_PRESENT" {
		t.Errorf("ds stage = %+v", st)
	}
	if len(h.dialer.dials) != 1 || h.dialer.dials[0] != localDoT+"#dns.corp.lab" {
		t.Errorf("dials = %v", h.dialer.dials)
	}
}

func TestDevicesOnInsecureZone(t *testing.T) {
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	insecure := validate.Evidence{Security: validate.Insecure, Rcode: "NOERROR", TTL: 60}
	insecure.Records = []dns.RR{txtRR(owner, txtrec.Format(tok, nil), 60)}
	externalAnswer := new(dns.Msg)
	externalAnswer.SetQuestion(owner, dns.TypeTXT)
	externalAnswer.Answer = []dns.RR{txtRR(owner, txtrec.Format(tok, nil), 60)}
	endpoints := map[string]*endpoint{
		localDoT:    localEndpoint(nil),
		externalDoT: {answers: map[string]*dns.Msg{owner + "/TXT": externalAnswer}},
	}

	h := newHarness(t, insecure, pvdWith(raw), endpoints)
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	if run.Decision != "rejected" || run.Claims[0].Reason != "DNSSEC_INSECURE_NO_FALLBACK" {
		t.Fatalf("validating-stub: %s %s", run.Decision, run.Claims[0].Reason)
	}

	h = newHarness(t, insecure, pvdWith(raw), endpoints)
	run = h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceHybrid})
	c := run.Claims[0]
	if run.Decision != "accepted" || c.Reason != "EXTERNAL_TOKEN_MATCH" || c.Grant == nil || c.Grant.Path != "external" || c.Grant.ExternalAD {
		t.Fatalf("hybrid: %s %s grant=%+v", run.Decision, c.Reason, c.Grant)
	}
	if h.resolverCalls != 1 {
		t.Errorf("hybrid should have tried DNSSEC first, calls=%d", h.resolverCalls)
	}

	h = newHarness(t, insecure, pvdWith(raw), endpoints)
	run = h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DevicePrivateDNS})
	c = run.Claims[0]
	if run.Decision != "accepted" || c.Reason != "EXTERNAL_TOKEN_MATCH" {
		t.Fatalf("private-dns: %s %s", run.Decision, c.Reason)
	}
	if h.resolverCalls != 0 {
		t.Errorf("private-dns device must not run the local validator, calls=%d", h.resolverCalls)
	}
	if st := stage(c, "public_dnssec"); st.Status != "skipped" || st.Code != "NOT_APPLICABLE" {
		t.Errorf("public_dnssec stage = %+v", st)
	}
}

func TestPrivateDNSExternalUnreachable(t *testing.T) {
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	endpoints := map[string]*endpoint{
		localDoT:    localEndpoint(nil),
		externalDoT: {dialErr: errors.New("dial tcp 172.30.97.99:853: i/o timeout")},
	}
	h := newHarness(t, secureTXT(owner, 60, now.Add(time.Hour), txtrec.Format(tok, nil)), pvdWith(raw), endpoints)
	p := corpProfile()
	p.External.Addr = externalDoT
	run := h.v.Verify(context.Background(), p, nil, Options{Device: DevicePrivateDNS})
	if run.Decision != "rejected" || run.Claims[0].Reason != "EXTERNAL_TIMEOUT" || run.Claims[0].Grant != nil {
		t.Fatalf("%s %s", run.Decision, run.Claims[0].Reason)
	}
	for _, q := range h.dialer.queries {
		if strings.HasSuffix(q, "/TXT") {
			t.Errorf("TXT must never be fetched from the network resolver on the external path: %v", h.dialer.queries)
		}
	}
}

func TestForgedRecordIsBogus(t *testing.T) {
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	bogus := secureTXT(owner, 60, now.Add(time.Hour), txtrec.Format(tok, nil))
	bogus.Security = validate.Bogus
	bogus.Why = "no DNSSEC records for DS corp.lab. while building chain of trust"
	h := newHarness(t, bogus, pvdWith(raw), map[string]*endpoint{localDoT: localEndpoint(nil)})
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	if run.Decision != "rejected" || run.Claims[0].Reason != "DNSSEC_BOGUS" {
		t.Fatalf("a matching token must never override a bogus state: %s %s", run.Decision, run.Claims[0].Reason)
	}
	if st := stage(run.Claims[0], "record"); st.Status != "skipped" {
		t.Errorf("record stage should be skipped after bogus, got %+v", st)
	}
}

func TestKeySubstitutionFailsLocalValidation(t *testing.T) {
	zone := "internal.corp.lab."
	approved, approvedPriv := newKey(t, zone, 257)
	attacker, attackerPriv := newKey(t, zone, 257)
	a := &dns.A{Hdr: dns.RR_Header{Name: "host." + zone, Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60}, A: []byte{10, 0, 5, 20}}

	// DNSKEY set contains the approved key but is signed only by the attacker's key.
	keyset := []dns.RR{approved, attacker}
	bad := new(dns.Msg)
	bad.SetQuestion(zone, dns.TypeDNSKEY)
	bad.Answer = append(keyset, signSet(t, keyset, attacker, attackerPriv, now.Add(-time.Minute), now.Add(time.Hour)))
	aMsg := new(dns.Msg)
	aMsg.SetQuestion(a.Hdr.Name, dns.TypeA)
	aMsg.Answer = []dns.RR{a, signSet(t, []dns.RR{a}, attacker, attackerPriv, now.Add(-time.Minute), now.Add(time.Hour))}
	_, err := ValidateLocalA([]*dns.DNSKEY{approved}, bad, aMsg, now)
	var le *Error
	if !errors.As(err, &le) || le.Code != "LOCAL_SIGNATURE_INVALID" {
		t.Fatalf("key substitution accepted: %v", err)
	}

	// Positive control: approved key signs the key set, which signs the A record.
	good := new(dns.Msg)
	good.SetQuestion(zone, dns.TypeDNSKEY)
	good.Answer = append([]dns.RR{approved}, signSet(t, []dns.RR{approved}, approved, approvedPriv, now.Add(-time.Minute), now.Add(time.Hour)))
	aGood := new(dns.Msg)
	aGood.SetQuestion(a.Hdr.Name, dns.TypeA)
	aGood.Answer = []dns.RR{a, signSet(t, []dns.RR{a}, approved, approvedPriv, now.Add(-time.Minute), now.Add(time.Hour))}
	addrs, err := ValidateLocalA([]*dns.DNSKEY{approved}, good, aGood, now)
	if err != nil || len(addrs) != 1 || addrs[0] != "10.0.5.20" {
		t.Fatalf("positive control: %v %v", addrs, err)
	}
}

func TestGrantExpiryUsesRRSIG(t *testing.T) {
	raw := corpClaim()
	tok, owner := tokenOf(t, raw)
	h := newHarness(t, secureTXT(owner, 3600, now.Add(60*time.Second), txtrec.Format(tok, nil)), pvdWith(raw), map[string]*endpoint{localDoT: localEndpoint(nil)})
	run := h.v.Verify(context.Background(), corpProfile(), nil, Options{Device: DeviceValidatingStub})
	g := run.Claims[0].Grant
	if g == nil || !g.ExpiresAt.Equal(now.Add(60*time.Second)) {
		t.Fatalf("grant = %+v", g)
	}
}

func TestTwoClaimsTwoReports(t *testing.T) {
	first := corpClaim()
	second := corpClaim()
	second.Resolver = "dns2.corp.lab"
	second.Subdomains = []string{"mail"}
	tok1, owner1 := tokenOf(t, first)
	tok2, owner2 := tokenOf(t, second)
	h := newHarness(t, secureTXT(owner1, 60, now.Add(time.Hour), txtrec.Format(tok1, nil)), pvdWith(first, second), map[string]*endpoint{localDoT: localEndpoint(nil)})
	// second claim: announced resolver dns2 exists but its record is bogus
	bogus := secureTXT(owner2, 60, now.Add(time.Hour), txtrec.Format(tok2, nil))
	bogus.Security = validate.Bogus
	h.v.Deps.Public = func(*validate.Forwarder) (validate.PublicResolver, error) {
		return &fakeResolver{calls: &h.resolverCalls, results: map[string]validate.Evidence{
			owner1: secureTXT(owner1, 60, now.Add(time.Hour), txtrec.Format(tok1, nil)), owner2: bogus}}, nil
	}
	p := corpProfile()
	p.NetworkResolvers = append(p.NetworkResolvers, lab.Announced{ADN: "dns2.corp.lab", Addr: localDoT})
	run := h.v.Verify(context.Background(), p, nil, Options{Device: DeviceValidatingStub})
	if len(run.Claims) != 2 || run.Claims[0].Decision != "accepted" || run.Claims[1].Decision != "rejected" || run.Decision != "rejected" {
		t.Fatalf("claims=%d first=%s second=%s run=%s", len(run.Claims), run.Claims[0].Decision, run.Claims[1].Decision, run.Decision)
	}
}

func stage(c ClaimReport, id string) Stage {
	for _, s := range c.Stages {
		if s.ID == id {
			return s
		}
	}
	return Stage{}
}
