package claim

import (
	"crypto/sha512"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"hash"
	"strings"
)

// ZONEMD hash algorithm registry values (RFC 8976 section 5.3) used by the DHCP encoding.
const (
	AlgSHA384 uint8 = 1
	AlgSHA512 uint8 = 2
)

// AlgorithmValue maps a ZONEMD mnemonic to its registry value.
func AlgorithmValue(mnemonic string) (uint8, error) {
	switch mnemonic {
	case "SHA384":
		return AlgSHA384, nil
	case "SHA512":
		return AlgSHA512, nil
	}
	return 0, fmt.Errorf("unknown hash algorithm %q", mnemonic)
}

// AlgorithmMnemonic maps a registry value back to its mnemonic.
func AlgorithmMnemonic(v uint8) (string, error) {
	switch v {
	case AlgSHA384:
		return "SHA384", nil
	case AlgSHA512:
		return "SHA512", nil
	}
	return "", fmt.Errorf("unknown hash algorithm value %d", v)
}

func newHash(mnemonic string) (hash.Hash, error) {
	switch mnemonic {
	case "SHA384":
		return sha512.New384(), nil
	case "SHA512":
		return sha512.New(), nil
	}
	return nil, fmt.Errorf("unknown hash algorithm %q", mnemonic)
}

// WireLabels encodes labels in uncompressed wire format without the root octet.
func WireLabels(labels []string) []byte {
	var b []byte
	for _, l := range labels {
		b = append(b, byte(len(l)))
		b = append(b, l...)
	}
	return b
}

// PseudoWire returns $X of RFC 9704 section 5: every canonical relative name in
// wire format with the parent-zone suffix replaced by a single zero octet, concatenated.
// The whole-zone marker "*" is encoded as the literal label \x01* (RFC 4034 section 6.2
// item 4 keeps "*" as a label; it is also the only form the DHCP encoding can carry).
func PseudoWire(c Canonical) []byte {
	var x []byte
	for _, rel := range c.Relative {
		x = append(x, WireLabels(strings.Split(rel, "."))...)
		x = append(x, 0)
	}
	return x
}

// TokenInput returns len(salt) || salt || $X.
func TokenInput(c Canonical) []byte {
	in := []byte{byte(len(c.Salt))}
	in = append(in, c.Salt...)
	return append(in, PseudoWire(c)...)
}

// Token computes the Verification Token: base64url without padding of
// hash(len(salt) || salt || $X), plus the raw digest.
func Token(c Canonical) (string, []byte, error) {
	h, err := newHash(c.Algorithm)
	if err != nil {
		return "", nil, err
	}
	h.Write(TokenInput(c))
	d := h.Sum(nil)
	return base64.RawURLEncoding.EncodeToString(d), d, nil
}

// RecordOwner returns the Verification Record owner name:
// <ADN>._splitdns-challenge.<parent>. in canonical form.
func RecordOwner(resolver, parent string) string {
	r, _ := Labels(resolver)
	p, _ := Labels(parent)
	return FQDN(append(append(r, "_splitdns-challenge"), p...))
}

// Inspection is the deterministic, network-free view of a claim. It makes no
// statement about authorization.
type Inspection struct {
	CanonicalResolver string   `json:"canonical_resolver"`
	CanonicalParent   string   `json:"canonical_parent"`
	Relative          []string `json:"relative"`
	Scopes            []string `json:"scopes"`
	WholeZone         bool     `json:"whole_zone"`
	Algorithm         string   `json:"algorithm"`
	SaltLength        int      `json:"salt_length"`
	PseudoWireHex     string   `json:"pseudo_wire_hex"`
	TokenInputHex     string   `json:"token_input_hex"`
	Token             string   `json:"token"`
	RecordOwner       string   `json:"record_owner"`
	Warnings          []string `json:"warnings"`
}

// Inspect canonicalises a raw claim and computes everything a verifier would
// compute before touching the network.
func Inspect(raw RawClaim) (Inspection, error) {
	c, err := Canonicalize(raw)
	if err != nil {
		return Inspection{}, err
	}
	return InspectCanonical(c)
}

// InspectCanonical builds an Inspection from an already canonical claim.
func InspectCanonical(c Canonical) (Inspection, error) {
	tok, _, err := Token(c)
	if err != nil {
		return Inspection{}, err
	}
	warnings := c.Warnings
	if warnings == nil {
		warnings = []string{}
	}
	return Inspection{
		CanonicalResolver: c.Resolver,
		CanonicalParent:   c.Parent,
		Relative:          c.Relative,
		Scopes:            c.Scopes,
		WholeZone:         c.WholeZone,
		Algorithm:         c.Algorithm,
		SaltLength:        len(c.Salt),
		PseudoWireHex:     hex.EncodeToString(PseudoWire(c)),
		TokenInputHex:     hex.EncodeToString(TokenInput(c)),
		Token:             tok,
		RecordOwner:       RecordOwner(c.Resolver, c.Parent),
		Warnings:          warnings,
	}, nil
}
