// Package claim implements the authorization-claim model of RFC 9704 section 5:
// canonical names, canonical order (RFC 4034 section 6.1), the $X pseudo-FQDN
// concatenation, the Verification Token and the Verification Record owner name.
package claim

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"strings"

	"golang.org/x/net/idna"
)

// RawClaim is an authorization claim as conveyed by the network (RFC 9704
// section 5.2.2 PvD shape). Unknown JSON keys are preserved in Extra so that
// future registry additions are neither lost nor rejected.
type RawClaim struct {
	Resolver   string   `json:"resolver"`
	Parent     string   `json:"parent"`
	Subdomains []string `json:"subdomains"`
	Algorithm  string   `json:"algorithm"`
	Salt       string   `json:"salt"`

	Extra map[string]json.RawMessage `json:"-"`
}

var knownKeys = map[string]bool{"resolver": true, "parent": true, "subdomains": true, "algorithm": true, "salt": true}

// UnmarshalJSON decodes the five registered keys and keeps every other key in Extra.
func (c *RawClaim) UnmarshalJSON(b []byte) error {
	type plain RawClaim
	var p plain
	if err := json.Unmarshal(b, &p); err != nil {
		return err
	}
	var all map[string]json.RawMessage
	if err := json.Unmarshal(b, &all); err != nil {
		return err
	}
	*c = RawClaim(p)
	for k, v := range all {
		if !knownKeys[k] {
			if c.Extra == nil {
				c.Extra = map[string]json.RawMessage{}
			}
			c.Extra[k] = v
		}
	}
	return nil
}

// MarshalJSON emits the registered keys followed by any preserved extras.
func (c RawClaim) MarshalJSON() ([]byte, error) {
	m := map[string]any{"resolver": c.Resolver, "parent": c.Parent, "subdomains": c.Subdomains, "algorithm": c.Algorithm, "salt": c.Salt}
	for k, v := range c.Extra {
		if !knownKeys[k] {
			m[k] = v
		}
	}
	return json.Marshal(m)
}

// Canonical is a validated claim in canonical form.
type Canonical struct {
	Resolver  string   // lowercase A-label FQDN with trailing dot
	Parent    string   // lowercase A-label FQDN with trailing dot
	Relative  []string // claimed names relative to Parent, canonical order; ["*"] for the whole zone
	Scopes    []string // absolute names the grant would cover (Parent for "*")
	Salt      []byte
	Algorithm string // "SHA384" or "SHA512"
	WholeZone bool
	// SpecialUse is set when the parent is (under) an RFC 6761 Special-Use Domain
	// Name. Tokens can still be computed (the RFC's own example uses parent.example),
	// but a verifier MUST NOT validate such a claim: see CheckSpecialUse.
	SpecialUse bool
	Warnings   []string
}

// Error is a claim validation failure with a stable reason code.
type Error struct {
	Code   string // INVALID_CLAIM or SPECIAL_USE_NAME
	Detail string
}

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

func invalid(format string, a ...any) error {
	return &Error{Code: "INVALID_CLAIM", Detail: fmt.Sprintf(format, a...)}
}

// SpecialUse lists the IANA Special-Use Domain Names (RFC 6761 registry) that
// RFC 9704 section 3 excludes from validation, plus the private-address reverse
// zones registered there.
var SpecialUse = func() []string {
	names := []string{
		"test.", "localhost.", "invalid.", "example.", "example.com.", "example.net.", "example.org.",
		"local.", "onion.", "alt.", "home.arpa.", "resolver.arpa.", "ipv4only.arpa.",
		"10.in-addr.arpa.", "168.192.in-addr.arpa.", "254.169.in-addr.arpa.",
		"8.e.f.ip6.arpa.", "9.e.f.ip6.arpa.", "a.e.f.ip6.arpa.", "b.e.f.ip6.arpa.", "d.f.ip6.arpa.",
	}
	for i := 16; i <= 31; i++ {
		names = append(names, fmt.Sprintf("%d.172.in-addr.arpa.", i))
	}
	return names
}()

// Labels converts a textual name into lowercase A-labels (IDNA) without the root.
func Labels(name string) ([]string, error) {
	name = strings.TrimSuffix(strings.TrimSpace(name), ".")
	if name == "" {
		return nil, nil
	}
	var out []string
	for _, l := range strings.Split(name, ".") {
		if l == "" {
			return nil, fmt.Errorf("empty label in %q", name)
		}
		if l == "*" {
			out = append(out, l)
			continue
		}
		a, err := idna.Lookup.ToASCII(l)
		if err != nil {
			return nil, fmt.Errorf("label %q: %v", l, err)
		}
		a = strings.ToLower(a)
		if len(a) > 63 {
			return nil, fmt.Errorf("label %q longer than 63 octets", l)
		}
		out = append(out, a)
	}
	return out, nil
}

// FQDN joins labels into a canonical absolute name.
func FQDN(labels []string) string {
	if len(labels) == 0 {
		return "."
	}
	return strings.Join(labels, ".") + "."
}

// CanonicalLess reports whether name a sorts before name b in the canonical
// DNS name order of RFC 4034 section 6.1 (labels compared right to left as
// unsigned octet strings; a missing label sorts first).
func CanonicalLess(a, b []string) bool {
	for i := 1; i <= len(a) && i <= len(b); i++ {
		if c := bytes.Compare([]byte(a[len(a)-i]), []byte(b[len(b)-i])); c != 0 {
			return c < 0
		}
	}
	return len(a) < len(b)
}

func hasSuffix(labels, suffix []string) bool {
	if len(labels) < len(suffix) {
		return false
	}
	for i := 1; i <= len(suffix); i++ {
		if labels[len(labels)-i] != suffix[len(suffix)-i] {
			return false
		}
	}
	return true
}

func isSpecialUse(labels []string) bool {
	for _, s := range SpecialUse {
		sl, _ := Labels(s)
		if hasSuffix(labels, sl) {
			return true
		}
	}
	return false
}

// CheckSpecialUse is the verifier's enforcement of RFC 9704 section 3: a claim whose
// parent is a Special-Use Domain Name is rejected with SPECIAL_USE_NAME.
func CheckSpecialUse(c Canonical) error {
	if c.SpecialUse {
		return &Error{Code: "SPECIAL_USE_NAME", Detail: "parent " + c.Parent + " is a Special-Use Domain Name (RFC 6761); RFC 9704 section 3 forbids validating it"}
	}
	return nil
}

// Canonicalize validates a raw claim and converts it to canonical form.
func Canonicalize(raw RawClaim) (Canonical, error) {
	var c Canonical
	resolver, err := Labels(raw.Resolver)
	if err != nil || len(resolver) == 0 {
		return c, invalid("resolver: %v", errOrEmpty(err))
	}
	parent, err := Labels(raw.Parent)
	if err != nil || len(parent) == 0 {
		return c, invalid("parent: %v", errOrEmpty(err))
	}
	if isSpecialUse(parent) {
		c.SpecialUse = true
		c.Warnings = append(c.Warnings, "parent "+FQDN(parent)+" is a Special-Use Domain Name (RFC 6761); RFC 9704 section 3 says such claims MUST NOT be validated")
	}
	switch raw.Algorithm {
	case "SHA384", "SHA512":
	default:
		return c, invalid("algorithm %q is not a ZONEMD hash algorithm mnemonic (SHA384, SHA512)", raw.Algorithm)
	}
	salt, err := decodeB64URL(raw.Salt)
	if err != nil {
		return c, invalid("salt is not base64url: %v", err)
	}
	if len(salt) > 255 {
		return c, invalid("salt is %d octets; RFC 9704 allows up to 255", len(salt))
	}
	if len(salt) < 16 {
		c.Warnings = append(c.Warnings, fmt.Sprintf("salt is only %d octets; RFC 9704 asks for a high-entropy salt (16 or more recommended)", len(salt)))
	}
	if len(raw.Subdomains) == 0 {
		return c, invalid("subdomains is empty")
	}
	if len(raw.Subdomains) > 16 {
		return c, invalid("%d subdomains; this implementation supports at most 16", len(raw.Subdomains))
	}

	var rel [][]string
	seen := map[string]bool{}
	for _, s := range raw.Subdomains {
		if s == "*" {
			if len(raw.Subdomains) != 1 {
				return c, invalid(`"*" (whole zone) must be the only claimed subdomain`)
			}
			c.WholeZone = true
			rel = append(rel, []string{"*"})
			break
		}
		labels, err := Labels(s)
		if err != nil || len(labels) == 0 {
			return c, invalid("subdomain %q: %v", s, errOrEmpty(err))
		}
		if hasSuffix(labels, parent) {
			labels = labels[:len(labels)-len(parent)] // absolute form given; make it relative
			if len(labels) == 0 {
				return c, invalid(`subdomain %q equals the parent; use "*" to claim the whole zone`, s)
			}
		} else if len(labels) > len(parent) && looksAbsolute(labels, parent) {
			// PvD subdomains are relative by definition (RFC 9704 section 5.2.2), so this is
			// accepted as the relative name <s>.<parent>; it is flagged because it reads like a
			// mistyped absolute name outside the parent.
			c.Warnings = append(c.Warnings, fmt.Sprintf("subdomain %q looks like an absolute name outside %s; it is treated as the relative name %s", s, FQDN(parent), FQDN(append(append([]string(nil), labels...), parent...))))
		}
		key := strings.Join(labels, ".")
		if seen[key] {
			return c, invalid("duplicate subdomain %q", key)
		}
		seen[key] = true
		rel = append(rel, labels)
	}

	sorted := make([][]string, len(rel))
	copy(sorted, rel)
	sortCanonical(sorted)
	for i := range rel {
		if strings.Join(rel[i], ".") != strings.Join(sorted[i], ".") {
			c.Warnings = append(c.Warnings, "subdomains were not supplied in canonical order (RFC 4034 section 6.1); re-sorted before hashing")
			break
		}
	}

	c.Resolver = FQDN(resolver)
	c.Parent = FQDN(parent)
	c.Salt = salt
	c.Algorithm = raw.Algorithm
	for _, labels := range sorted {
		c.Relative = append(c.Relative, strings.Join(labels, "."))
		if c.WholeZone {
			c.Scopes = append(c.Scopes, c.Parent)
		} else {
			c.Scopes = append(c.Scopes, FQDN(append(append([]string(nil), labels...), parent...)))
		}
	}
	return c, nil
}

// looksAbsolute reports whether a name that is not under the parent reads like an
// absolute name: it is longer than the parent and ends in the parent's top label
// ("x.other.lab" under "corp.lab"). "vpn.intranet" is a normal relative name.
func looksAbsolute(labels, parent []string) bool {
	return labels[len(labels)-1] == parent[len(parent)-1]
}

func sortCanonical(names [][]string) {
	for i := 1; i < len(names); i++ {
		for j := i; j > 0 && CanonicalLess(names[j], names[j-1]); j-- {
			names[j], names[j-1] = names[j-1], names[j]
		}
	}
}

func decodeB64URL(s string) ([]byte, error) {
	s = strings.TrimRight(strings.TrimSpace(s), "=")
	if s == "" {
		return []byte{}, nil
	}
	return base64.RawURLEncoding.DecodeString(s)
}

func errOrEmpty(err error) any {
	if err != nil {
		return err
	}
	return "empty name"
}
