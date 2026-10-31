package claim

import (
	"encoding/base64"
	"encoding/hex"
	"errors"
	"strings"
	"testing"
)

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func mustHex(t *testing.T, s string) []byte {
	t.Helper()
	b, err := hex.DecodeString(s)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func seq16() []byte {
	b := make([]byte, 16)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}

// Expected values come from docs/research/rfc9704_token_check.py (independent, stdlib Python).
func TestTokenVectors(t *testing.T) {
	firmaSalt := mustHex(t, "567de4436afd6d7cf4a4b9b862df301c")
	const firmaToken = "PJv5v0eMID1V22B3Cp2bw1ge0yxBGVMtNaMatP_7HBuNyQn4Xu8WlsnYOI9v7z2E"
	rfcSubs := []string{"payroll.parent.example", "secret.project.parent.example"}

	cases := []struct {
		name       string
		parent     string
		subs       []string
		salt       []byte
		alg        string
		token      string // full token, or prefix when tokenPrefix is set
		prefix     bool
		xHex       string
		relative   []string
		scopes     []string
		wholeZone  bool
		wantWarn   string
		tokenChars int
	}{
		{name: "rfc-printed-salt", parent: "parent.example", subs: rfcSubs,
			salt: []byte("example salt octets (should be random)"), alg: "SHA384",
			token:    "wA1lI3Tdnm2z3rbjAa6A998luwSDTU9LU45SoruhsTBtmcdL5BhalHS2v5UCSzal",
			xHex:     "07706179726f6c6c00067365637265740770726f6a65637400",
			relative: []string{"payroll", "secret.project"}},
		{name: "rfc-draft07-salt", parent: "parent.example", subs: rfcSubs,
			salt: []byte("example salt bytes (should be random)"), alg: "SHA384",
			token: "z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8AEtcHrFQkfiiQ79nhcHyXFkD"},
		{name: "firma", parent: "firma.rs", subs: []string{"mail", "intranet"}, salt: firmaSalt, alg: "SHA384",
			token: firmaToken, relative: []string{"intranet", "mail"},
			scopes: []string{"intranet.firma.rs.", "mail.firma.rs."}},
		{name: "canonical-order", parent: "firma.rs", subs: []string{"intranet", "mail", "vpn.intranet"},
			salt: firmaSalt, alg: "SHA384", token: "oBAmDEGau4IBs4j1-bdpE_rN", prefix: true,
			relative: []string{"intranet", "vpn.intranet", "mail"}, wantWarn: "canonical order"},
		{name: "uppercase", parent: "Firma.RS", subs: []string{"INTRANET", "Mail"}, salt: firmaSalt, alg: "SHA384",
			token: firmaToken},
		{name: "star", parent: "banka.lab", subs: []string{"*"}, salt: seq16(), alg: "SHA384",
			token: "9-HnyhDM_B27C98dkKRyEh7hf-5AmnfczEY6zxV1oF-BZ2WlBshc2h5On-JxZLSF",
			xHex:  "012a00", relative: []string{"*"}, scopes: []string{"banka.lab."}, wholeZone: true},
		{name: "idn", parent: "фирма.срб", subs: []string{"интранет"}, salt: seq16(), alg: "SHA384",
			token:    "-5Rv_3o1Ibw8plTfnafxrTVi28j2012nMBMJTlvYLS6GzeJ1DEfQpUwmoLbFqGI-",
			relative: []string{"xn--80akhubqne"}},
		{name: "sha512", parent: "firma.rs", subs: []string{"intranet", "mail"}, salt: firmaSalt, alg: "SHA512",
			token: "_YSpJx7AMUTsDLZJ", prefix: true, tokenChars: 86},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			raw := RawClaim{Resolver: "dns.example", Parent: tc.parent, Subdomains: tc.subs, Algorithm: tc.alg, Salt: b64(tc.salt)}
			c, err := Canonicalize(raw)
			if err != nil {
				t.Fatalf("Canonicalize: %v", err)
			}
			tok, _, err := Token(c)
			if err != nil {
				t.Fatalf("Token: %v", err)
			}
			if tc.prefix {
				if !strings.HasPrefix(tok, tc.token) {
					t.Errorf("token %q does not start with %q", tok, tc.token)
				}
			} else if tok != tc.token {
				t.Errorf("token = %q, want %q", tok, tc.token)
			}
			if tc.tokenChars != 0 && len(tok) != tc.tokenChars {
				t.Errorf("token length %d, want %d", len(tok), tc.tokenChars)
			}
			if tc.xHex != "" {
				if got := hex.EncodeToString(PseudoWire(c)); got != tc.xHex {
					t.Errorf("X = %s, want %s", got, tc.xHex)
				}
			}
			if tc.relative != nil && strings.Join(c.Relative, ",") != strings.Join(tc.relative, ",") {
				t.Errorf("Relative = %v, want %v", c.Relative, tc.relative)
			}
			if tc.scopes != nil && strings.Join(c.Scopes, ",") != strings.Join(tc.scopes, ",") {
				t.Errorf("Scopes = %v, want %v", c.Scopes, tc.scopes)
			}
			if c.WholeZone != tc.wholeZone {
				t.Errorf("WholeZone = %v, want %v", c.WholeZone, tc.wholeZone)
			}
			if tc.wantWarn != "" {
				found := false
				for _, w := range c.Warnings {
					if strings.Contains(w, tc.wantWarn) {
						found = true
					}
				}
				if !found {
					t.Errorf("Warnings %v lack %q", c.Warnings, tc.wantWarn)
				}
			}
		})
	}
}

func TestCanonicalizeRejects(t *testing.T) {
	ok := RawClaim{Resolver: "dns.corp.lab", Parent: "corp.lab", Subdomains: []string{"internal"}, Algorithm: "SHA384", Salt: b64(seq16())}
	cases := []struct {
		name string
		mut  func(r *RawClaim)
		code string
	}{
		{"star with others", func(r *RawClaim) { r.Subdomains = []string{"*", "x"} }, "INVALID_CLAIM"},
		{"duplicates", func(r *RawClaim) { r.Subdomains = []string{"a", "A"} }, "INVALID_CLAIM"},
		{"empty list", func(r *RawClaim) { r.Subdomains = nil }, "INVALID_CLAIM"},
		{"salt too long", func(r *RawClaim) { r.Salt = b64(make([]byte, 256)) }, "INVALID_CLAIM"},
		{"bad algorithm", func(r *RawClaim) { r.Algorithm = "MD5" }, "INVALID_CLAIM"},
		{"bad salt encoding", func(r *RawClaim) { r.Salt = "***" }, "INVALID_CLAIM"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			r := ok
			r.Subdomains = append([]string(nil), ok.Subdomains...)
			tc.mut(&r)
			_, err := Canonicalize(r)
			var ce *Error
			if !errors.As(err, &ce) {
				t.Fatalf("want *Error, got %v", err)
			}
			if ce.Code != tc.code {
				t.Errorf("code = %s, want %s (%s)", ce.Code, tc.code, ce.Detail)
			}
		})
	}
	if _, err := Canonicalize(ok); err != nil {
		t.Fatalf("baseline claim rejected: %v", err)
	}
	// PvD subdomains are relative by definition: a name outside the parent is accepted
	// as relative but flagged when it reads like an absolute name.
	r := ok
	r.Subdomains = []string{"x.other.lab"}
	c, err := Canonicalize(r)
	if err != nil {
		t.Fatalf("relative multi-label name rejected: %v", err)
	}
	if c.Scopes[0] != "x.other.lab.corp.lab." || len(c.Warnings) == 0 {
		t.Errorf("scopes %v warnings %v", c.Scopes, c.Warnings)
	}
}

// Special-use parents are flagged at canonicalisation (so the RFC's own
// parent.example example can still be inspected) and rejected by the verifier.
func TestSpecialUseFlaggedThenRejected(t *testing.T) {
	for _, parent := range []string{"home.arpa", "printers.home.arpa", "parent.example", "corp.test"} {
		c, err := Canonicalize(RawClaim{Resolver: "dns.corp.lab", Parent: parent, Subdomains: []string{"a"}, Algorithm: "SHA384", Salt: b64(seq16())})
		if err != nil {
			t.Fatalf("%s: %v", parent, err)
		}
		if !c.SpecialUse {
			t.Errorf("%s: SpecialUse not set", parent)
		}
		var ce *Error
		if err := CheckSpecialUse(c); !errors.As(err, &ce) || ce.Code != "SPECIAL_USE_NAME" {
			t.Errorf("%s: CheckSpecialUse = %v", parent, err)
		}
	}
	c, _ := Canonicalize(RawClaim{Resolver: "dns.corp.lab", Parent: "corp.lab", Subdomains: []string{"a"}, Algorithm: "SHA384", Salt: b64(seq16())})
	if c.SpecialUse || CheckSpecialUse(c) != nil {
		t.Errorf("corp.lab wrongly flagged")
	}
}

func TestEmptySaltWarns(t *testing.T) {
	c, err := Canonicalize(RawClaim{Resolver: "dns.firma.rs", Parent: "firma.rs", Subdomains: []string{"intranet"}, Algorithm: "SHA384", Salt: ""})
	if err != nil {
		t.Fatal(err)
	}
	if len(c.Warnings) == 0 || !strings.Contains(strings.Join(c.Warnings, " "), "salt") {
		t.Errorf("expected a salt-length warning, got %v", c.Warnings)
	}
	tok, _, _ := Token(c)
	if tok != "lid8k8K7tj1hX3O6tCtPAb7n2pHfqqTv3kIyimUL3rF7NUiD-Bxj3s6V9UZ3k25Y" {
		t.Errorf("empty-salt token = %q", tok)
	}
}

func TestRecordOwner(t *testing.T) {
	got := RecordOwner("resolver17.parent.example", "parent.example")
	if got != "resolver17.parent.example._splitdns-challenge.parent.example." {
		t.Errorf("RecordOwner = %q", got)
	}
	ins, err := Inspect(RawClaim{Resolver: "Resolver17.Parent.Example.", Parent: "parent.example", Subdomains: []string{"payroll", "secret.project"}, Algorithm: "SHA384", Salt: b64([]byte("example salt octets (should be random)"))})
	if err != nil {
		t.Fatal(err)
	}
	if ins.RecordOwner != "resolver17.parent.example._splitdns-challenge.parent.example." {
		t.Errorf("Inspection.RecordOwner = %q", ins.RecordOwner)
	}
	if ins.SaltLength != 38 || ins.TokenInputHex[:2] != "26" {
		t.Errorf("salt length %d, token input %s", ins.SaltLength, ins.TokenInputHex[:8])
	}
}

func TestRawClaimKeepsUnknownKeys(t *testing.T) {
	var r RawClaim
	if err := r.UnmarshalJSON([]byte(`{"resolver":"dns.x.lab","parent":"x.lab","subdomains":["a"],"algorithm":"SHA384","salt":"AAAA","future":{"k":1}}`)); err != nil {
		t.Fatal(err)
	}
	if _, ok := r.Extra["future"]; !ok || r.Resolver != "dns.x.lab" {
		t.Errorf("unknown key not preserved: %+v", r)
	}
}
