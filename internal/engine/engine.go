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
	"time"

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
	pools    map[string]*x509.CertPool
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

// verifier builds a Verifier with real dependencies for a profile.
func (e *Engine) verifier(p lab.Profile) (*verify.Verifier, error) {
	pool, err := e.pool(p.CAFile)
	if err != nil {
		return nil, err
	}
	factory := func(fwd *validate.Forwarder) (validate.PublicResolver, error) {
		return validate.New(validate.Config{AnchorFile: p.AnchorFile, RootHintsFile: p.RootHints, CAFile: p.CAFile, Forward: fwd, Timeout: 6 * time.Second,
			DaemonAddr: os.Getenv("SPLITTRUST_DAEMON")})
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
	v, err := e.verifier(p)
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
	v, err := e.verifier(p)
	if err != nil {
		return route.Report{}, err
	}
	ctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	return (&route.Resolver{V: v}).Resolve(ctx, p, qname, opt), nil
}

// InlineProfileID is the manifest profile used for `verify --claim FILE`.
const InlineProfileID = "legit"

// Backend reports which validator implementation this binary carries.
func Backend() string { return validate.Backend() }
