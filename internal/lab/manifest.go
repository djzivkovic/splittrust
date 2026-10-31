// Package lab describes the isolated laboratory: the static scenario catalogue
// (embedded scenarios.json) and the generated runtime manifest the verifier
// loads. The verifier only ever acts on a profile from the manifest; callers
// select profiles by scenario id.
package lab

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

//go:embed scenarios.json
var scenariosJSON []byte

// Announced is an encrypted resolver the network announced (DNR: ADN + address;
// DDR: address only, ADN empty).
type Announced struct {
	ADN  string `json:"adn"`
	Addr string `json:"addr"` // host:port of the DoT endpoint
}

// Expected is presentation metadata: what the demo expects for a device. It is
// never an input to the verifier.
type Expected struct {
	Device   string `json:"device"`
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

// ClaimSpec is a claim as defined in the catalogue (before salts exist).
type ClaimSpec struct {
	Resolver   string   `json:"resolver"`
	Subdomains []string `json:"subdomains"`
	DS         string   `json:"ds"`                    // "none" | "local" | "wrong"
	RecordSalt string   `json:"record_salt,omitempty"` // "other": the published record uses a different salt
	CopyOf     string   `json:"copy_of,omitempty"`     // reuse another scenario's generated claim
	Salt       string   `json:"salt,omitempty"`        // fixed base64url salt (real-world records must not change per run)
}

// Scenario is one catalogue entry.
type Scenario struct {
	ID                string      `json:"id"`
	Title             string      `json:"title"`
	Explanation       string      `json:"explanation"`
	Discovery         string      `json:"discovery"` // "dnr" | "ddr"
	Parent            string      `json:"parent"`
	NetworkResolvers  []Announced `json:"network_resolvers"`
	Claims            []ClaimSpec `json:"claims"`
	PvDID             string      `json:"pvd_id,omitempty"`
	ClaimSource       string      `json:"claim_source,omitempty"` // "" or "pvd" | "inline"
	ExternalAddr      string      `json:"external_addr,omitempty"`
	External          *Announced  `json:"external,omitempty"`           // full override (e.g. the real dns.quad9.net)
	TrustContext      string      `json:"trust_context,omitempty"`      // "" = lab; "global" = validated under the IANA root
	Anchor            string      `json:"anchor,omitempty"`             // "" = lab root KSK; "iana" = the real root trust anchor
	DefaultResolution string      `json:"default_resolution,omitempty"` // "" = via-network; "iterative" when the announced resolver cannot reach the zone
	DefaultDevice     string      `json:"default_device"`
	ExampleQName      string      `json:"example_qname"`
	Expected          []Expected  `json:"expected"`
}

// Catalogue is the static part of the lab.
type Catalogue struct {
	Network   string            `json:"network"`
	Addresses map[string]string `json:"addresses"`
	Scenarios []Scenario        `json:"scenarios"`
}

// LoadCatalogue parses the embedded scenarios.json.
func LoadCatalogue() (Catalogue, error) {
	var c Catalogue
	if err := json.Unmarshal(scenariosJSON, &c); err != nil {
		return c, fmt.Errorf("embedded scenarios.json: %v", err)
	}
	for _, s := range c.Scenarios {
		if s.ClaimSource == "" {
			if s.PvDID == "" {
				return c, fmt.Errorf("scenario %s: no pvd_id and no claim_source", s.ID)
			}
		}
		if s.Discovery != "dnr" && s.Discovery != "ddr" {
			return c, fmt.Errorf("scenario %s: discovery must be dnr or ddr", s.ID)
		}
	}
	return c, nil
}

// Profile is a runtime profile: a scenario plus the generated artefacts and
// trust material the client was provisioned with.
type Profile struct {
	ScenarioID          string      `json:"scenario_id"`
	Title               string      `json:"title"`
	Explanation         string      `json:"explanation"`
	Discovery           string      `json:"discovery"`
	NetworkResolvers    []Announced `json:"network_resolvers"`
	PvDID               string      `json:"pvd_id,omitempty"`
	ClaimSource         string      `json:"claim_source"` // "pvd" | "inline"
	PvDURL              string      `json:"pvd_url,omitempty"`
	ClaimFile           string      `json:"claim_file,omitempty"`
	External            Announced   `json:"external"`
	DefaultDevice       string      `json:"default_device"`
	CAFile              string      `json:"ca_file"`
	AnchorFile          string      `json:"anchor_file"`
	RootHints           string      `json:"root_hints"`
	PermittedNamespaces []string    `json:"permitted_namespaces"`
	ExampleQName        string      `json:"example_qname"`
	Expected            []Expected  `json:"expected"`
	TrustContext        string      `json:"trust_context"`     // lab | global
	RequiresInternet    bool        `json:"requires_internet"` // global profiles need the egress-enabled "real" service
	DefaultResolution   string      `json:"default_resolution,omitempty"`
}

// Manifest is what bootstrap writes and the app loads.
type Manifest struct {
	SchemaVersion int                `json:"schema_version"`
	GeneratedAt   string             `json:"generated_at"`
	TrustContext  string             `json:"trust_context"`
	Order         []string           `json:"order"`
	Profiles      map[string]Profile `json:"profiles"`
}

// Load reads a manifest file.
func Load(path string) (Manifest, error) {
	var m Manifest
	b, err := os.ReadFile(path)
	if err != nil {
		return m, err
	}
	if err := json.Unmarshal(b, &m); err != nil {
		return m, fmt.Errorf("%s: %v", path, err)
	}
	if m.TrustContext != "lab" {
		return m, fmt.Errorf("%s: trust_context %q is not \"lab\"", path, m.TrustContext)
	}
	for id, p := range m.Profiles {
		if p.ScenarioID != id {
			return m, fmt.Errorf("%s: profile %q has scenario_id %q", path, id, p.ScenarioID)
		}
	}
	return m, nil
}

// Permitted reports whether qname (any form) is inside one of the permitted namespaces.
func Permitted(qname string, namespaces []string) bool {
	q := strings.TrimSuffix(strings.ToLower(qname), ".") + "."
	for _, ns := range namespaces {
		n := strings.TrimSuffix(strings.ToLower(ns), ".") + "."
		if q == n || strings.HasSuffix(q, "."+n) {
			return true
		}
	}
	return false
}

// AnnouncedFor returns the announced resolver with the given ADN (DNR) or the
// single announced address (DDR).
func (p Profile) AnnouncedFor(adn string) (Announced, bool) {
	want := strings.TrimSuffix(strings.ToLower(adn), ".")
	for _, a := range p.NetworkResolvers {
		if p.Discovery == "ddr" || strings.TrimSuffix(strings.ToLower(a.ADN), ".") == want {
			return a, true
		}
	}
	return Announced{}, false
}

// Summary is the console/CLI listing entry.
type Summary struct {
	ID               string     `json:"id"`
	Title            string     `json:"title"`
	Explanation      string     `json:"explanation"`
	DefaultDevice    string     `json:"default_device"`
	ExampleQName     string     `json:"example_qname"`
	Expected         []Expected `json:"expected"`
	TrustContext     string     `json:"trust_context"`
	RequiresInternet bool       `json:"requires_internet"`
}

// Summaries lists profiles in catalogue order.
func (m Manifest) Summaries() []Summary {
	var out []Summary
	for _, id := range m.Order {
		p := m.Profiles[id]
		out = append(out, Summary{ID: id, Title: p.Title, Explanation: p.Explanation, DefaultDevice: p.DefaultDevice, ExampleQName: p.ExampleQName, Expected: p.Expected, TrustContext: p.TrustContext, RequiresInternet: p.RequiresInternet})
	}
	return out
}
