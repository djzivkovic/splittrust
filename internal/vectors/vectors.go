// Package vectors generates the published test vectors (vectors/*.json) and the
// forensic computation behind the RFC 9704 section 5.1 erratum. Every expected
// value in the committed files was produced independently by
// docs/research/rfc9704_token_check.py (stdlib Python) before this code existed.
package vectors

import (
	"bytes"
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dhcp"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/txtrec"
)

// PrintedRFCToken is the token printed in RFC 9704 section 5.1 (63 characters).
const PrintedRFCToken = "z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR-KJDv2eFwfJcWQM"

// Draft07Salt is the salt string of draft-ietf-add-split-horizon-authority-07.
const Draft07Salt = "example salt bytes (should be random)"

// RFCSalt is the salt string as printed in RFC 9704 (reworded in draft-10).
const RFCSalt = "example salt octets (should be random)"

type encodingVector struct {
	Name              string   `json:"name"`
	Parent            string   `json:"parent"`
	SubdomainsInput   []string `json:"subdomains_input"`
	SaltB64URL        string   `json:"salt_b64url"`
	SaltASCII         string   `json:"salt_ascii,omitempty"`
	Algorithm         string   `json:"algorithm"`
	Resolver          string   `json:"resolver"`
	CanonicalRelative []string `json:"canonical_relative"`
	Scopes            []string `json:"scopes"`
	PseudoWireHex     string   `json:"pseudo_wire_hex"`
	TokenInputHex     string   `json:"token_input_hex"`
	Token             string   `json:"token"`
	RecordOwner       string   `json:"record_owner"`
	Warnings          []string `json:"warnings"`
	Note              string   `json:"note,omitempty"`
}

// Forensics documents how the printed RFC token came to be.
type Forensics struct {
	PrintedToken            string `json:"printed_token"`
	PrintedTokenChars       int    `json:"printed_token_chars"`
	PrintedTokenOctets      int    `json:"printed_token_octets"`
	CorrectTokenRFCSalt     string `json:"correct_token_for_printed_salt"`
	CorrectTokenDraft07Salt string `json:"correct_token_for_draft07_salt"`
	Draft07DigestHex        string `json:"draft07_digest_hex"`
	NulOffsetInDigest       int    `json:"nul_offset_in_draft07_digest"`
	NulStrippedToken        string `json:"draft07_digest_with_nul_removed_b64url"`
	Reproduced              bool   `json:"reproduces_printed_token"`
	Explanation             string `json:"explanation"`
}

type txtCase struct {
	Name        string   `json:"name"`
	CharStrings []string `json:"character_strings"`
	Valid       bool     `json:"valid"`
	Token       string   `json:"token,omitempty"`
	DS          []string `json:"ds,omitempty"`
	Error       string   `json:"error,omitempty"`
	Note        string   `json:"note"`
}

type dhcpVector struct {
	Name          string `json:"name"`
	Claim         any    `json:"claim"`
	Replay        uint64 `json:"replay_detection"`
	PayloadHex    string `json:"payload_hex"`
	PayloadOctets int    `json:"payload_octets"`
	V4Chunks      []int  `json:"dhcpv4_rfc3396_chunk_octets"`
	Note          string `json:"note"`
}

type pvdVector struct {
	Name     string `json:"name"`
	Document any    `json:"document"`
	Valid    bool   `json:"valid"`
	Error    string `json:"error,omitempty"`
	Note     string `json:"note"`
}

type verificationCase struct {
	Scenario    string `json:"scenario"`
	Title       string `json:"title"`
	Device      string `json:"device"`
	Decision    string `json:"decision"`
	Reason      string `json:"reason"`
	Exercises   string `json:"exercises"`
	Explanation string `json:"explanation"`
}

var exercises = map[string]string{
	"legit":                 "RFC 9704 s5 token, s6.2 Secure, s7 ds binding (claim 1) and token-only authority (claim 2)",
	"hotel":                 "s6.2 authenticated denial relayed by the hostile network -> RECORD_MISSING",
	"hotel-forged":          "s6.2 Bogus: correct token in a record the parent zone never signed",
	"stale-salt":            "s11 ordering: record must change before the claim -> TOKEN_MISMATCH",
	"expired-signature":     "s6.2 Bogus: RRSIG validity ended",
	"unsigned":              "s6.2 Insecure -> fail without policy; s6.1 external path for devices that have one",
	"wrong-ds":              "s7: ds RDATA must equal a DS computed over resolver.arpa. for a presented DNSKEY",
	"replay":                "s5: resolver must present a certificate for the claimed ADN (RFC 9525)",
	"hotel-blocks-external": "s6.1: no response from the external resolver -> verification failed",
	"special-use":           "s3: Special-Use Domain Names MUST NOT be validated",
}

func b64(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

func seq(n int) []byte {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(i)
	}
	return b
}

func encode(name, resolver, parent string, subs []string, salt []byte, alg, note string) (encodingVector, error) {
	raw := claim.RawClaim{Resolver: resolver, Parent: parent, Subdomains: subs, Algorithm: alg, Salt: b64(salt)}
	ins, err := claim.Inspect(raw)
	if err != nil {
		return encodingVector{}, fmt.Errorf("%s: %v", name, err)
	}
	v := encodingVector{Name: name, Parent: parent, SubdomainsInput: subs, SaltB64URL: b64(salt), Algorithm: alg, Resolver: resolver,
		CanonicalRelative: ins.Relative, Scopes: ins.Scopes, PseudoWireHex: ins.PseudoWireHex, TokenInputHex: ins.TokenInputHex, Token: ins.Token,
		RecordOwner: ins.RecordOwner, Warnings: ins.Warnings, Note: note}
	if isASCII(salt) {
		v.SaltASCII = string(salt)
	}
	return v, nil
}

func isASCII(b []byte) bool {
	for _, c := range b {
		if c < 0x20 || c > 0x7e {
			return false
		}
	}
	return len(b) > 0
}

// ComputeForensics recomputes the section 5.1 example under both salts.
func ComputeForensics() (Forensics, error) {
	subs := []string{"payroll.parent.example", "secret.project.parent.example"}
	printed, err := encode("x", "resolver17.parent.example", "parent.example", subs, []byte(RFCSalt), "SHA384", "")
	if err != nil {
		return Forensics{}, err
	}
	draft, err := encode("x", "resolver17.parent.example", "parent.example", subs, []byte(Draft07Salt), "SHA384", "")
	if err != nil {
		return Forensics{}, err
	}
	in, _ := hex.DecodeString(draft.TokenInputHex)
	digest := sha512.Sum384(in)
	nul := bytes.IndexByte(digest[:], 0)
	stripped := b64(bytes.ReplaceAll(digest[:], []byte{0}, nil))
	decoded, _ := base64.RawURLEncoding.DecodeString(PrintedRFCToken)
	return Forensics{
		PrintedToken: PrintedRFCToken, PrintedTokenChars: len(PrintedRFCToken), PrintedTokenOctets: len(decoded),
		CorrectTokenRFCSalt: printed.Token, CorrectTokenDraft07Salt: draft.Token,
		Draft07DigestHex: hex.EncodeToString(digest[:]), NulOffsetInDigest: nul, NulStrippedToken: stripped,
		Reproduced:  stripped == PrintedRFCToken,
		Explanation: "The printed token is the SHA-384 digest for the draft-07 salt with its single 0x00 octet removed before base64url encoding (a NUL-terminated string bug in the helper that produced the example), and the salt text was later reworded from \"bytes\" to \"octets\" without recomputing the token.",
	}, nil
}

// Generate returns the vector files keyed by file name.
func Generate() (map[string][]byte, error) {
	out := map[string][]byte{}
	firmaSalt, _ := hex.DecodeString("567de4436afd6d7cf4a4b9b862df301c")
	rfcSubs := []string{"payroll.parent.example", "secret.project.parent.example"}
	specs := []struct {
		name, resolver, parent string
		subs                   []string
		salt                   []byte
		alg, note              string
	}{
		{"rfc9704-5.1-printed-salt", "resolver17.parent.example", "parent.example", rfcSubs, []byte(RFCSalt), "SHA384", "the RFC 9704 section 5.1 claim with the salt exactly as printed; the RFC prints a different (63-character) token, see forensics"},
		{"rfc9704-5.1-draft07-salt", "resolver17.parent.example", "parent.example", rfcSubs, []byte(Draft07Salt), "SHA384", "the same claim with the draft-07 salt string; its first 40 characters equal the printed token"},
		{"firma-rs", "dns.firma.rs", "firma.rs", []string{"mail", "intranet"}, firmaSalt, "SHA384", "two relative names supplied out of canonical order; the verifier re-sorts (intranet, mail) before hashing"},
		{"canonical-not-alphabetical", "dns.firma.rs", "firma.rs", []string{"intranet", "mail", "vpn.intranet"}, firmaSalt, "SHA384", "RFC 4034 s6.1 order is intranet, vpn.intranet, mail: labels compare right to left"},
		{"uppercase-normalised", "dns.firma.rs", "Firma.RS", []string{"INTRANET", "Mail"}, firmaSalt, "SHA384", "must equal firma-rs: canonical form is lowercase"},
		{"whole-zone-star", "dns.hotel.lab", "banka.lab", []string{"*"}, seq(16), "SHA384", "implementation choice documented in the design: '*' is hashed as the literal label \\x01* (RFC 4034 s6.2 item 4), the only form the DHCP encoding can carry"},
		{"idn-srb", "dns.firma.rs", "фирма.срб", []string{"интранет"}, seq(16), "SHA384", "U-labels are converted to A-labels before hashing; RFC 9704 does not mention IDNA"},
		{"sha512", "dns.firma.rs", "firma.rs", []string{"intranet", "mail"}, firmaSalt, "SHA512", "ZONEMD hash algorithm 2; 64-octet digest, 86 base64url characters"},
		{"empty-salt", "dns.firma.rs", "firma.rs", []string{"intranet"}, []byte{}, "SHA384", "a zero-length salt is allowed by the text (up to 255 octets); the verifier warns"},
	}
	var enc []encodingVector
	for _, s := range specs {
		v, err := encode(s.name, s.resolver, s.parent, s.subs, s.salt, s.alg, s.note)
		if err != nil {
			return nil, err
		}
		enc = append(enc, v)
	}
	forensics, err := ComputeForensics()
	if err != nil {
		return nil, err
	}
	out["encoding.json"] = marshal(map[string]any{
		"description":                   "RFC 9704 section 5 Verification Token vectors. token = base64url(hash(len(salt) || salt || X)) without padding; X = canonical relative wire names, each terminated by a zero octet, in RFC 4034 section 6.1 order.",
		"vectors":                       enc,
		"rfc9704_section_5_1_forensics": forensics,
	})

	tok := enc[2].Token
	txtCases := []txtCase{
		{Name: "fragments-within-one-rr", CharStrings: []string{"token=" + tok + ",ds=AAEN", ",future=ignored,ds=AAIN"}, Valid: true, Token: tok, DS: []string{"AAEN", "AAIN"}, Note: "character-strings of one RR are concatenated; unknown keys are ignored; multiple ds values are kept"},
		{Name: "duplicate-token", CharStrings: []string{"token=" + tok + ",token=" + tok}, Valid: false, Error: "duplicate token key in one RR", Note: "two token keys in one RR are ambiguous; the RR is ignored for matching"},
		{Name: "token-47-octets", CharStrings: []string{"token=" + tok[:63]}, Valid: false, Error: "token decodes to 47 octets", Note: "the RFC's own printed example would be rejected by this rule"},
		{Name: "no-token", CharStrings: []string{"ds=AAEN"}, Valid: false, Error: "no token key in RR", Note: "a Verification Record without a token authorises nothing"},
	}
	for i := range txtCases {
		rec, err := txtrec.ParseRR(txtCases[i].CharStrings)
		if (err == nil) != txtCases[i].Valid {
			return nil, fmt.Errorf("txt case %s: valid=%v err=%v", txtCases[i].Name, txtCases[i].Valid, err)
		}
		if err == nil {
			txtCases[i].Token, txtCases[i].DS = rec.Token, rec.DS
		} else {
			txtCases[i].Error = err.Error()
		}
	}
	out["txt.json"] = marshal(map[string]any{"description": "Verification Record TXT parsing cases (RFC 9704 sections 5, 6 and 7).", "cases": txtCases})

	firma := claim.RawClaim{Resolver: "dns.firma.rs", Parent: "firma.rs", Subdomains: []string{"intranet", "mail"}, Algorithm: "SHA384", Salt: b64(firmaSalt)}
	fc, _ := claim.Canonicalize(firma)
	fp, _ := dhcp.EncodeV4(fc, 0)
	var longSubs []string
	for i := 0; i < 16; i++ {
		longSubs = append(longSubs, fmt.Sprintf("department-%02d-very-long-label-for-splitting", i))
	}
	long := claim.RawClaim{Resolver: "dns.firma.rs", Parent: "firma.rs", Subdomains: longSubs, Algorithm: "SHA384", Salt: b64(seq(32))}
	lc, err := claim.Canonicalize(long)
	if err != nil {
		return nil, err
	}
	lp, _ := dhcp.EncodeV4(lc, 0x0102030405060708)
	out["dhcp.json"] = marshal(map[string]any{
		"description": "RFC 9704 section 5.2.1: DHCPv4 option 90 / DHCPv6 option 11 Authentication option payload, Protocol 4. Header: protocol, algorithm (ZONEMD value), RDM 0, 64-bit replay detection; body: ADN wire, parent wire, salt length, salt, X.",
		"notes": []string{
			"RFC 8415 section 20.2 forbids more than one Authentication option per DHCPv6 message and RFC 3396 concatenates repeated DHCPv4 option 90 instances, so a DHCP message carries exactly one claim.",
			"RFC 9704 fixes RDM to 0 but does not say what the 64-bit replay detection field holds; RFC 3118/8415 require a strictly increasing counter for RDM 0.",
		},
		"vectors": []dhcpVector{
			{Name: "firma-rs", Claim: firma, Replay: 0, PayloadHex: hex.EncodeToString(fp), PayloadOctets: len(fp), V4Chunks: lens(dhcp.SplitV4(fp)), Note: "fits one DHCPv4 option"},
			{Name: "sixteen-long-subdomains", Claim: long, Replay: 0x0102030405060708, PayloadHex: hex.EncodeToString(lp), PayloadOctets: len(lp), V4Chunks: lens(dhcp.SplitV4(lp)), Note: "exceeds 255 octets: DHCPv4 MUST split per RFC 3396 section 8"},
		},
	})

	twoClaims := []claim.RawClaim{firma, {Resolver: "dns2.firma.rs", Parent: "firma.rs", Subdomains: []string{"mail"}, Algorithm: "SHA384", Salt: b64(seq(16))}}
	out["pvd.json"] = marshal(map[string]any{
		"description": "RFC 8801 PvD Additional Information documents carrying RFC 9704 splitDnsClaims.",
		"vectors": []pvdVector{
			{Name: "valid-one-claim", Valid: true, Document: map[string]any{"identifier": "pvd.firma.rs", "expires": "2026-11-02T06:00:00Z", "prefixes": []string{"2001:db8:1::/48"}, "splitDnsClaims": []claim.RawClaim{firma}}, Note: "mandatory keys present; one claim"},
			{Name: "valid-two-claims", Valid: true, Document: map[string]any{"identifier": "pvd.firma.rs", "expires": "2026-11-02T06:00:00Z", "prefixes": []string{"2001:db8:1::/48"}, "splitDnsClaims": twoClaims}, Note: "RFC 9704 section 5: one or more claims; each is verified independently"},
			{Name: "missing-prefixes", Valid: false, Error: "PVD_INVALID", Document: map[string]any{"identifier": "pvd.firma.rs", "expires": "2026-11-02T06:00:00Z", "splitDnsClaims": []claim.RawClaim{firma}}, Note: "RFC 8801 section 4.3: identifier, expires and prefixes are mandatory"},
			{Name: "expired", Valid: false, Error: "PVD_EXPIRED", Document: map[string]any{"identifier": "pvd.firma.rs", "expires": "2020-01-01T00:00:00Z", "prefixes": []string{"2001:db8:1::/48"}, "splitDnsClaims": []claim.RawClaim{firma}}, Note: "RFC 8801 section 4.1: an object whose expiry has passed MUST be ignored"},
			{Name: "wrong-identifier", Valid: false, Error: "PVD_INVALID", Document: map[string]any{"identifier": "pvd.hotel.example", "expires": "2026-11-02T06:00:00Z", "prefixes": []string{"2001:db8:1::/48"}, "splitDnsClaims": []claim.RawClaim{firma}}, Note: "fetched as pvd.firma.rs: identifier MUST match the PvD ID"},
		},
	})

	cat, err := lab.LoadCatalogue()
	if err != nil {
		return nil, err
	}
	var cases []verificationCase
	for _, sc := range cat.Scenarios {
		for _, e := range sc.Expected {
			cases = append(cases, verificationCase{Scenario: sc.ID, Title: sc.Title, Device: e.Device, Decision: e.Decision, Reason: e.Reason, Exercises: exercises[sc.ID], Explanation: sc.Explanation})
		}
	}
	out["verification-cases.json"] = marshal(map[string]any{
		"description":  "Expected verdicts of the SplitTrust lab scenarios per simulated device. trust_context is always \"lab\": a private root, not the global DNS.",
		"devices":      map[string]string{"validating-stub": "validates DNSSEC locally, network resolver as DoT forwarder, no external policy", "private-dns": "external encrypted resolver by default; RFC 9704 section 6.1", "hybrid": "validating-stub that retries through the external resolver on Insecure"},
		"cases":        cases,
		"reason_codes": reasonCodes(),
	})
	return out, nil
}

func reasonCodes() []string {
	codes := []string{"AUTHORIZED", "EXTERNAL_TOKEN_MATCH", "INVALID_CLAIM", "SPECIAL_USE_NAME", "CLAIM_RESOLVER_MISMATCH", "OUT_OF_LAB_SCOPE", "PVD_EXPIRED", "PVD_INVALID",
		"DNSSEC_BOGUS", "DNSSEC_INDETERMINATE", "DNSSEC_INSECURE_NO_FALLBACK", "DNS_LOOKUP_FAILED", "RECORD_MISSING", "RECORD_INVALID", "TOKEN_MISMATCH",
		"TLS_IDENTITY_FAILED", "RESOLVER_UNREACHABLE", "DS_MISMATCH", "LOCAL_SIGNATURE_INVALID", "LOCAL_RESPONSE_UNSUPPORTED", "LOCAL_DNSSEC_NOT_ESTABLISHED", "GRANT_EXPIRED", "EXTERNAL_TIMEOUT"}
	sort.Strings(codes)
	return codes
}

func lens(chunks [][]byte) []int {
	var out []int
	for _, c := range chunks {
		out = append(out, len(c))
	}
	return out
}

func marshal(v any) []byte {
	b, _ := json.MarshalIndent(v, "", "  ")
	return append(bytes.ReplaceAll(b, []byte("\\u003c"), []byte("<")), '\n')
}

// FileNames lists the generated files in a stable order.
func FileNames(files map[string][]byte) []string {
	var names []string
	for n := range files {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Describe renders a short human summary (for `splittrust vectors`).
func Describe(files map[string][]byte) string {
	var b strings.Builder
	for _, n := range FileNames(files) {
		fmt.Fprintf(&b, "%-24s %6d bytes\n", n, len(files[n]))
	}
	return b.String()
}
