// Package owner is the domain-owner tool: from a claim a network proposes, it
// produces the canonical claim to announce and the Verification Record TXT
// line to publish (RFC 9704 section 5). It never publishes anything.
package owner

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/txtrec"
)

// Request is the owner-tool input: a claim plus optional DS values.
type Request struct {
	claim.RawClaim
	DS []string `json:"ds"`
}

// UnmarshalJSON accepts the claim keys plus "ds".
func (r *Request) UnmarshalJSON(b []byte) error {
	if err := json.Unmarshal(b, &r.RawClaim); err != nil {
		return err
	}
	var ds struct {
		DS []string `json:"ds"`
	}
	if err := json.Unmarshal(b, &ds); err != nil {
		return err
	}
	r.DS = ds.DS
	delete(r.Extra, "ds")
	return nil
}

// Build is the owner-tool output (design section 6 RecordBuild).
type Build struct {
	Claim        claim.RawClaim `json:"claim"`
	RecordOwner  string         `json:"record_owner"`
	TXT          string         `json:"txt"`
	ZoneLine     string         `json:"zone_line"`
	Token        string         `json:"token"`
	SigningState string         `json:"signing_state"`
	TrustContext string         `json:"trust_context"`
	Warnings     []string       `json:"warnings"`
}

// Make builds the record. An empty salt is replaced by 32 random octets; an
// empty algorithm defaults to SHA384.
func Make(req Request) (Build, error) {
	if req.Algorithm == "" {
		req.Algorithm = "SHA384"
	}
	if strings.TrimSpace(req.Salt) == "" {
		salt := make([]byte, 32)
		if _, err := rand.Read(salt); err != nil {
			return Build{}, err
		}
		req.Salt = base64.RawURLEncoding.EncodeToString(salt)
	}
	c, err := claim.Canonicalize(req.RawClaim)
	if err != nil {
		return Build{}, err
	}
	ins, err := claim.InspectCanonical(c)
	if err != nil {
		return Build{}, err
	}
	published := req.RawClaim
	published.Parent = strings.TrimSuffix(c.Parent, ".")
	published.Resolver = strings.TrimSuffix(c.Resolver, ".")
	published.Subdomains = c.Relative
	published.Algorithm = c.Algorithm
	published.Salt = base64.RawURLEncoding.EncodeToString(c.Salt)
	warnings := append([]string{}, ins.Warnings...)
	warnings = append(warnings, "signing_state=not_checked: this tool did not look up whether "+c.Parent+" is DNSSEC-signed; an unsigned zone can only be verified through a device's external encrypted resolver (RFC 9704 section 6.1); sign the zone")
	txt := txtrec.Format(ins.Token, req.DS)
	return Build{
		Claim:        published,
		RecordOwner:  ins.RecordOwner,
		TXT:          txt,
		ZoneLine:     ins.RecordOwner + " 3600 IN TXT \"" + txt + "\"",
		Token:        ins.Token,
		SigningState: "not_checked",
		TrustContext: "lab",
		Warnings:     warnings,
	}, nil
}
