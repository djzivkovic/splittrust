// Package engine wires the verifier and router to the real lab dependencies
// (libunbound validator, DoT client, PvD fetcher) from a loaded manifest. The
// CLI and the HTTP API are both thin adapters over it.
package engine

import (
	"context"
	"crypto/x509"
	"errors"
	"fmt"
	"os"
	"sync"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dot"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/pvd"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/validate"
	"github.com/djzivkovic/splittrust/internal/verify"
)

// Engine is the configured application.
type Engine struct {
	Manifest lab.Manifest

	mu    sync.Mutex
	pools map[string]*x509.CertPool
}

// ErrUnknownScenario is returned for ids that are not in the manifest.
var ErrUnknownScenario = errors.New("unknown scenario")

// Load reads the manifest and prepares the engine.
func Load(manifestPath string) (*Engine, error) {
	m, err := lab.Load(manifestPath)
	if err != nil {
		return nil, err
	}
	return &Engine{Manifest: m, pools: map[string]*x509.CertPool{}}, nil
}

func (e *Engine) pool(caFile string) (*x509.CertPool, error) {
	e.mu.Lock()
	defer e.mu.Unlock()
	if e.pools == nil {
		e.pools = map[string]*x509.CertPool{}
	}
	if p, ok := e.pools[caFile]; ok {
		return p, nil
	}
	pem, err := os.ReadFile(caFile)
	if err != nil {
		return nil, err
	}
	p := x509.NewCertPool()
	if !p.AppendCertsFromPEM(pem) {
		return nil, fmt.Errorf("%s: no certificates", caFile)
	}
	e.pools[caFile] = p
	return p, nil
}

// Profile returns the profile for a scenario id.
func (e *Engine) Profile(id string) (lab.Profile, error) {
	p, ok := e.Manifest.Profiles[id]
	if !ok {
		return lab.Profile{}, fmt.Errorf("%w: %q", ErrUnknownScenario, id)
	}
	return p, nil
}

// Verifier builds a Verifier with real dependencies for a profile.
func (e *Engine) Verifier(p lab.Profile) (*verify.Verifier, error) {
	pool, err := e.pool(p.CAFile)
	if err != nil {
		return nil, err
	}
	factory := func(fwd *validate.Forwarder) (validate.PublicResolver, error) {
		return validate.New(validate.Config{AnchorFile: p.AnchorFile, RootHintsFile: p.RootHints, CAFile: p.CAFile, Forward: fwd, Timeout: 6 * time.Second})
	}
	return &verify.Verifier{Deps: verify.Deps{
		Public: factory,
		DoT:    verify.DoTAdapter{Client: &dot.Client{Roots: pool, Timeout: 2 * time.Second}},
		PvD:    &pvd.Fetcher{Roots: pool, Timeout: 3 * time.Second, MaxBytes: 64 << 10},
		Now:    time.Now,
	}}, nil
}

// Verify runs a scenario (inline == nil) or an explicit claim under the profile.
func (e *Engine) Verify(ctx context.Context, scenarioID string, inline *claim.RawClaim, opt verify.Options) (verify.Run, error) {
	p, err := e.Profile(scenarioID)
	if err != nil {
		return verify.Run{}, err
	}
	v, err := e.Verifier(p)
	if err != nil {
		return verify.Run{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	return v.Verify(ctx, p, inline, opt), nil
}

// Resolve performs the scoped demo resolution for a scenario.
func (e *Engine) Resolve(ctx context.Context, scenarioID, qname string, opt verify.Options) (route.Report, error) {
	p, err := e.Profile(scenarioID)
	if err != nil {
		return route.Report{}, err
	}
	v, err := e.Verifier(p)
	if err != nil {
		return route.Report{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	return (&route.Resolver{V: v}).Resolve(ctx, p, qname, opt), nil
}

// LiveRecord is what the public DNS says right now about a scenario's claim:
// the Verification Record and the parent's DS, resolved iteratively from the
// profile's trust anchor (the IANA root for real zones). It is the "check it
// yourself" view: the same data `dig` would show.
type LiveRecord struct {
	Parent      string            `json:"parent"`
	RecordOwner string            `json:"record_owner"`
	Token       string            `json:"expected_token"`
	TXT         validate.Evidence `json:"txt"`
	DS          validate.Evidence `json:"ds"`
	CheckedAt   time.Time         `json:"checked_at"`
	Trust       string            `json:"trust_context"`
}

// Live resolves the scenario's first claim against the public DNS.
func (e *Engine) Live(ctx context.Context, scenarioID string) (LiveRecord, error) {
	p, err := e.Profile(scenarioID)
	if err != nil {
		return LiveRecord{}, err
	}
	v, err := e.Verifier(p)
	if err != nil {
		return LiveRecord{}, err
	}
	raws, err := v.LoadClaims(ctx, p, nil)
	if err != nil || len(raws) == 0 {
		return LiveRecord{}, fmt.Errorf("no claim to look up: %v", err)
	}
	ins, err := claim.Inspect(raws[0])
	if err != nil {
		return LiveRecord{}, err
	}
	pub, err := v.Deps.Public(nil)
	if err != nil {
		return LiveRecord{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	lr := LiveRecord{Parent: ins.CanonicalParent, RecordOwner: ins.RecordOwner, Token: ins.Token, CheckedAt: time.Now().UTC(), Trust: "lab"}
	if p.TrustContext != "" {
		lr.Trust = p.TrustContext
	}
	lr.TXT, _ = pub.Resolve(ctx, ins.RecordOwner, dns.TypeTXT)
	lr.DS, _ = pub.Resolve(ctx, ins.CanonicalParent, dns.TypeDS)
	return lr, nil
}

// Namespaces is the union of the profiles' permitted namespaces.
func (e *Engine) Namespaces() []string {
	seen := map[string]bool{}
	var out []string
	for _, id := range e.Manifest.Order {
		for _, ns := range e.Manifest.Profiles[id].PermittedNamespaces {
			if !seen[ns] {
				seen[ns] = true
				out = append(out, ns)
			}
		}
	}
	return out
}

// Summaries lists the scenarios.
func (e *Engine) Summaries() []lab.Summary { return e.Manifest.Summaries() }

// Capabilities describes this build for /api/capabilities.
func (e *Engine) Capabilities() map[string]any {
	return map[string]any{
		"trust_context":      "lab",
		"validator":          validate.Backend(),
		"devices":            verify.Devices,
		"resolutions":        []verify.Resolution{verify.ViaNetwork, verify.Iterative},
		"verification_paths": []string{"rfc9704-6.2-dnssec", "rfc9704-6.1-external-resolver"},
		"ds_support":         true,
		"multi_claim":        true,
		"dhcp":               "codec-only",
		"discovery":          "pre-configured per scenario (no DHCP/RA listener)",
		"scenarios":          len(e.Manifest.Order),
		"generated_at":       e.Manifest.GeneratedAt,
	}
}

// InlineProfileID is the manifest profile used for `verify --claim FILE`.
const InlineProfileID = "legit"

// Backend reports which validator implementation this binary carries.
func Backend() string { return validate.Backend() }
