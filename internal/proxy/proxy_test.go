package proxy

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"errors"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/pvd"
	"github.com/djzivkovic/splittrust/internal/txtrec"
	"github.com/djzivkovic/splittrust/internal/validate"
	"github.com/djzivkovic/splittrust/internal/verify"
)

const (
	localDoT    = "172.30.97.20:853"
	externalDoT = "172.30.97.40:853"
)

var now = time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)

// ------------------------------------------------------------------ fakes

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
	answers map[string]*dns.Msg
	queries *[]string
}

func (c *fakeConn) Query(_ context.Context, qname string, qtype uint16) (*dns.Msg, error) {
	key := dns.Fqdn(qname) + "/" + dns.TypeToString[qtype]
	*c.queries = append(*c.queries, c.addr+" "+key)
	if m, ok := c.answers[key]; ok {
		return m, nil
	}
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(qname), qtype)
	m.Rcode = dns.RcodeNameError
	return m, nil
}

func (c *fakeConn) Close() error { return nil }

type fakeDialer struct {
	answers map[string]map[string]*dns.Msg // addr -> key -> msg
	dials   []string
	queries []string
}

func (d *fakeDialer) Dial(_ context.Context, addr, serverName string) (verify.DoTConn, error) {
	d.dials = append(d.dials, addr+"#"+serverName)
	return &fakeConn{addr: addr, answers: d.answers[addr], queries: &d.queries}, nil
}

type fakePvD struct {
	doc pvd.Document
	err error
}

func (p *fakePvD) Fetch(context.Context, string, string, time.Time) (pvd.Document, error) {
	return p.doc, p.err
}

// ------------------------------------------------------------------ fixtures

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

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
	kk := *k
	kk.Hdr.Name = "resolver.arpa."
	ds := kk.ToDS(dns.SHA256)
	rdata := binary.BigEndian.AppendUint16(nil, ds.KeyTag)
	rdata = append(rdata, ds.Algorithm, ds.DigestType)
	digest, _ := hex.DecodeString(ds.Digest)
	return b64(append(rdata, digest...))
}

func sign(t *testing.T, set []dns.RR, key *dns.DNSKEY, signer crypto.Signer) *dns.RRSIG {
	t.Helper()
	h := set[0].Header()
	sig := &dns.RRSIG{Hdr: dns.RR_Header{Name: h.Name, Rrtype: dns.TypeRRSIG, Class: dns.ClassINET, Ttl: h.Ttl},
		TypeCovered: h.Rrtype, Algorithm: key.Algorithm, Labels: uint8(dns.CountLabel(h.Name)), OrigTtl: h.Ttl,
		Expiration: uint32(now.Add(time.Hour).Unix()), Inception: uint32(now.Add(-time.Minute).Unix()), KeyTag: key.KeyTag(), SignerName: key.Hdr.Name}
	if err := sig.Sign(signer, set); err != nil {
		t.Fatal(err)
	}
	return sig
}

func txt(owner, rdata string) dns.RR {
	return &dns.TXT{Hdr: dns.RR_Header{Name: owner, Rrtype: dns.TypeTXT, Class: dns.ClassINET, Ttl: 60}, Txt: []string{rdata}}
}

func aRR(name string, ip byte) *dns.A {
	return &dns.A{Hdr: dns.RR_Header{Name: name, Rrtype: dns.TypeA, Class: dns.ClassINET, Ttl: 60}, A: []byte{172, 30, 97, ip}}
}

type world struct {
	pub    *fakePublic
	dialer *fakeDialer
	pvd    *fakePvD
	srv    *Server
}

func profile(id string) lab.Profile {
	return lab.Profile{
		ScenarioID: id, Discovery: "dnr", ClaimSource: "pvd", PvDID: "pvd.corp.lab", PvDURL: "https://pvd.corp.lab/.well-known/pvd",
		NetworkResolvers:    []lab.Announced{{ADN: "dns.corp.lab", Addr: localDoT}, {ADN: "dns2.corp.lab", Addr: localDoT}},
		External:            lab.Announced{ADN: "quad9.lab", Addr: externalDoT},
		DefaultDevice:       "validating-stub",
		PermittedNamespaces: []string{"lab.", "arpa."},
	}
}

// build a corp network: claim 1 (internal, ds) and claim 2 (mail, token-only).
func newWorld(t *testing.T, device verify.Device, rejectAll bool) *world {
	t.Helper()
	zone := "internal.corp.lab."
	ksk, kpriv := newKey(t, "resolver.arpa.", 257)
	c1 := claim.RawClaim{Resolver: "dns.corp.lab", Parent: "corp.lab", Subdomains: []string{"internal"}, Algorithm: "SHA384", Salt: b64(make([]byte, 16))}
	c2 := claim.RawClaim{Resolver: "dns2.corp.lab", Parent: "corp.lab", Subdomains: []string{"mail"}, Algorithm: "SHA384", Salt: b64(make([]byte, 16))}
	i1, _ := claim.Inspect(c1)
	i2, _ := claim.Inspect(c2)

	exp := now.Add(time.Hour)
	pub := &fakePublic{answers: map[string]validate.Evidence{
		i1.RecordOwner + "/TXT": {Security: validate.Secure, Rcode: "NOERROR", TTL: 60, RRSIGExpiresAt: &exp, Records: []dns.RR{txt(i1.RecordOwner, txtrec.Format(i1.Token, []string{dsOf(ksk)}))}},
		i2.RecordOwner + "/TXT": {Security: validate.Secure, Rcode: "NOERROR", TTL: 60, RRSIGExpiresAt: &exp, Records: []dns.RR{txt(i2.RecordOwner, txtrec.Format(i2.Token, nil))}},
		"www.corp.lab./A":       {Security: validate.Secure, Rcode: "NOERROR", TTL: 60, Records: []dns.RR{aRR("www.corp.lab.", 10)}},
		"www.banka.lab./A":      {Security: validate.Bogus, Rcode: "NOERROR", Why: "no DNSSEC records for DS banka.lab. while building chain of trust"},
	}}
	if rejectAll {
		pub.answers[i1.RecordOwner+"/TXT"] = validate.Evidence{Security: validate.Bogus, Why: "forged"}
		pub.answers[i2.RecordOwner+"/TXT"] = validate.Evidence{Security: validate.Bogus, Why: "forged"}
		pub.answers["host.internal.corp.lab./A"] = validate.Evidence{Security: validate.Insecure, Rcode: "NOERROR", TTL: 60, Records: []dns.RR{aRR("host.internal.corp.lab.", 99)}}
	}

	// local resolver: resolver.arpa DNSKEY, the zone's DNSKEY set (signed by the approved key) and a signed A record
	zoneKey := *ksk
	zoneKey.Hdr.Name = zone
	keyset := []dns.RR{&zoneKey}
	dnskeyMsg := new(dns.Msg)
	dnskeyMsg.SetQuestion(zone, dns.TypeDNSKEY)
	dnskeyMsg.Answer = append(keyset, sign(t, keyset, &zoneKey, kpriv))
	arpa := new(dns.Msg)
	arpa.SetQuestion("resolver.arpa.", dns.TypeDNSKEY)
	arpa.Answer = []dns.RR{ksk}
	host := aRR("host."+zone, 70)
	aMsg := new(dns.Msg)
	aMsg.SetQuestion(host.Hdr.Name, dns.TypeA)
	aMsg.Answer = []dns.RR{host, sign(t, []dns.RR{host}, &zoneKey, kpriv)}
	mail := aRR("host.mail.corp.lab.", 71)
	mailMsg := new(dns.Msg)
	mailMsg.SetQuestion(mail.Hdr.Name, dns.TypeA)
	mailMsg.Answer = []dns.RR{mail}
	bank := aRR("www.banka.lab.", 80)
	bankMsg := new(dns.Msg)
	bankMsg.SetQuestion(bank.Hdr.Name, dns.TypeA)
	bankMsg.Answer = []dns.RR{bank}
	bankMsg.AuthenticatedData = true
	dialer := &fakeDialer{answers: map[string]map[string]*dns.Msg{
		localDoT:    {"resolver.arpa./DNSKEY": arpa, zone + "/DNSKEY": dnskeyMsg, host.Hdr.Name + "/A": aMsg, mail.Hdr.Name + "/A": mailMsg},
		externalDoT: {"www.banka.lab./A": bankMsg},
	}}
	pv := &fakePvD{doc: pvd.Document{Identifier: "pvd.corp.lab", Expires: now.Add(36 * time.Hour), Claims: []claim.RawClaim{c1, c2}}}

	deps := verify.Deps{
		Public: func(*validate.Forwarder) (validate.PublicResolver, error) { return pub, nil },
		DoT:    dialer, PvD: pv, Now: func() time.Time { return now },
	}
	srv, err := New(Config{
		Profile:  func(id string) (lab.Profile, error) { return profile(id), nil },
		Verifier: func(lab.Profile) (*verify.Verifier, error) { return &verify.Verifier{Deps: deps}, nil },
		Now:      func() time.Time { return now },
		Log:      func(string, ...any) {},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := srv.Join("legit", device, ""); err != nil {
		t.Fatal(err)
	}
	return &world{pub: pub, dialer: dialer, pvd: pv, srv: srv}
}

func query(name string, qtype uint16) *dns.Msg {
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(name), qtype)
	m.SetEdns0(1232, true)
	return m
}

func ede(m *dns.Msg) *dns.EDNS0_EDE {
	if opt := m.IsEdns0(); opt != nil {
		for _, o := range opt.Option {
			if e, ok := o.(*dns.EDNS0_EDE); ok {
				return e
			}
		}
	}
	return nil
}

func ips(m *dns.Msg) []string {
	var out []string
	for _, rr := range m.Answer {
		if a, ok := rr.(*dns.A); ok {
			out = append(out, a.A.String())
		}
	}
	return out
}

// ------------------------------------------------------------------ tests

func TestDelegatedScopeValidatedLocally(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, false)
	resp := w.srv.Handle(context.Background(), query("host.internal.corp.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeSuccess || !resp.AuthenticatedData || len(ips(resp)) != 1 || ips(resp)[0] != "172.30.97.70" {
		t.Fatalf("resp: rcode=%s ad=%v ips=%v", dns.RcodeToString[resp.Rcode], resp.AuthenticatedData, ips(resp))
	}
	// second query reuses the grant: no new verification
	calls := w.pub.calls
	w.srv.Handle(context.Background(), query("host.internal.corp.lab", dns.TypeA))
	if w.pub.calls != calls {
		t.Errorf("grant not cached: validator calls %d -> %d", calls, w.pub.calls)
	}
}

func TestTokenOnlyScopeAnswersWithoutAD(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, false)
	resp := w.srv.Handle(context.Background(), query("host.mail.corp.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeSuccess || resp.AuthenticatedData || len(ips(resp)) != 1 || ips(resp)[0] != "172.30.97.71" {
		t.Fatalf("resp: rcode=%s ad=%v ips=%v", dns.RcodeToString[resp.Rcode], resp.AuthenticatedData, ips(resp))
	}
}

func TestRejectedClaimUsesDefaultPath(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, true)
	resp := w.srv.Handle(context.Background(), query("host.internal.corp.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeSuccess || resp.AuthenticatedData || len(ips(resp)) != 1 || ips(resp)[0] != "172.30.97.99" {
		t.Fatalf("resp: rcode=%s ad=%v ips=%v", dns.RcodeToString[resp.Rcode], resp.AuthenticatedData, ips(resp))
	}
	for _, q := range w.dialer.queries {
		if q != "" && q[:len(localDoT)] == localDoT {
			t.Errorf("local resolver queried for data after rejection: %v", w.dialer.queries)
		}
	}
	if e := ede(resp); e == nil || e.InfoCode != edeOther {
		t.Errorf("expected an EDE explaining the rejected claim, got %+v", e)
	}
}

func TestOutOfScopeFollowsDeviceAndBogusIsServfail(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, false)
	resp := w.srv.Handle(context.Background(), query("www.corp.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeSuccess || !resp.AuthenticatedData || ips(resp)[0] != "172.30.97.10" {
		t.Fatalf("default secure: rcode=%s ad=%v ips=%v", dns.RcodeToString[resp.Rcode], resp.AuthenticatedData, ips(resp))
	}
	resp = w.srv.Handle(context.Background(), query("www.banka.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeServerFailure {
		t.Fatalf("bogus must be SERVFAIL, got %s", dns.RcodeToString[resp.Rcode])
	}
	if e := ede(resp); e == nil || e.InfoCode != dns.ExtendedErrorCodeDNSBogus {
		t.Errorf("expected EDE bogus, got %+v", e)
	}

	// the private-dns device asks its external resolver instead
	w2 := newWorld(t, verify.DevicePrivateDNS, false)
	resp = w2.srv.Handle(context.Background(), query("www.banka.lab", dns.TypeA))
	if resp.Rcode != dns.RcodeSuccess || ips(resp)[0] != "172.30.97.80" || w2.pub.calls != 0 {
		t.Fatalf("private-dns default: rcode=%s ips=%v validator calls=%d", dns.RcodeToString[resp.Rcode], ips(resp), w2.pub.calls)
	}
}

func TestOutOfLabIsRefusedWithoutTraffic(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, false)
	resp := w.srv.Handle(context.Background(), query("example.com", dns.TypeA))
	if resp.Rcode != dns.RcodeRefused || w.pub.calls != 0 || len(w.dialer.dials) != 0 {
		t.Fatalf("rcode=%s validator=%d dials=%v", dns.RcodeToString[resp.Rcode], w.pub.calls, w.dialer.dials)
	}
}

func TestJoinClearsGrants(t *testing.T) {
	w := newWorld(t, verify.DeviceValidatingStub, false)
	w.srv.Handle(context.Background(), query("host.internal.corp.lab", dns.TypeA))
	if st := w.srv.Status(); len(st.Grants) != 2 { // the network's two claims are verified together
		t.Fatalf("grants = %+v", st.Grants)
	}
	if err := w.srv.Join("legit", verify.DevicePrivateDNS, ""); err != nil {
		t.Fatal(err)
	}
	if st := w.srv.Status(); len(st.Grants) != 0 || st.Device != verify.DevicePrivateDNS {
		t.Fatalf("status after join = %+v", st)
	}
	if err := w.srv.Join("legit", "toaster", ""); !errors.Is(err, ErrBadDevice) {
		t.Errorf("bad device accepted: %v", err)
	}
}
