//go:build integration

// Package integration exercises the running laboratory. It is executed by the
// compose "test" service (go test -tags "integration libunbound" ./tests/...)
// and needs SPLITTRUST_MANIFEST to point at the generated manifest.
package integration

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/validate"
)

func manifest(t *testing.T) lab.Manifest {
	t.Helper()
	path := os.Getenv("SPLITTRUST_MANIFEST")
	if path == "" {
		t.Skip("SPLITTRUST_MANIFEST not set; run inside the lab")
	}
	m, err := lab.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return m
}

func firstClaim(t *testing.T, p lab.Profile) claim.RawClaim {
	t.Helper()
	path := p.ClaimFile
	if path == "" {
		path = "/gen/client/claims/" + p.ScenarioID + ".json"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var raws []claim.RawClaim
	if err := jsonUnmarshal(b, &raws); err != nil {
		t.Fatal(err)
	}
	return raws[0]
}

// validatorFor builds the device's validator for a profile: via the network's
// announced resolver (RFC 9704 Figure 4) or iteratively from the lab root.
func validatorFor(t *testing.T, p lab.Profile, viaNetwork bool) validate.PublicResolver {
	t.Helper()
	cfg := validate.Config{AnchorFile: p.AnchorFile, RootHintsFile: p.RootHints, CAFile: p.CAFile, Timeout: 8 * time.Second}
	if viaNetwork {
		a := p.NetworkResolvers[0]
		cfg.Forward = &validate.Forwarder{Addr: a.Addr, ServerName: a.ADN}
	}
	v, err := validate.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	return v
}

func recordOwner(t *testing.T, p lab.Profile) string {
	raw := firstClaim(t, p)
	c, err := claim.Canonicalize(raw)
	if err != nil {
		t.Fatal(err)
	}
	return claim.RecordOwner(c.Resolver, c.Parent)
}

// Gate A: the DNSSEC states the verifier relies on are real, and they survive
// the trip through the network's own resolver.
func TestPublicStatesAreReal(t *testing.T) {
	m := manifest(t)
	cases := []struct {
		scenario string
		security validate.Security
		rcode    string
		whyHas   string
	}{
		{"legit", validate.Secure, "NOERROR", ""},
		{"expired-signature", validate.Bogus, "", ""},
		{"unsigned", validate.Insecure, "NOERROR", ""},
		{"hotel", validate.Secure, "NXDOMAIN", ""},
		{"hotel-forged", validate.Bogus, "", ""},
	}
	ctx := context.Background()
	for _, tc := range cases {
		t.Run(tc.scenario+"/via-network", func(t *testing.T) {
			p := m.Profiles[tc.scenario]
			ev, err := validatorFor(t, p, true).Resolve(ctx, recordOwner(t, p), dns.TypeTXT)
			if err != nil && tc.security != validate.Bogus {
				t.Fatalf("resolve: %v (%+v)", err, ev)
			}
			if ev.Security != tc.security {
				t.Fatalf("security = %s (why=%q rcode=%s), want %s", ev.Security, ev.Why, ev.Rcode, tc.security)
			}
			if tc.rcode != "" && ev.Rcode != tc.rcode {
				t.Errorf("rcode = %s, want %s", ev.Rcode, tc.rcode)
			}
			if tc.scenario == "hotel-forged" {
				// The forging resolver cannot produce the parent's signed DS proof or any
				// RRSIG for its view: unbound reports the missing chain of trust.
				why := strings.ToLower(ev.Why)
				if !strings.Contains(why, "dnssec") && !strings.Contains(why, "sig") {
					t.Errorf("forged record should fail on the signature chain, why=%q", ev.Why)
				}
			}
			t.Logf("%s: %s %s why=%q ttl=%d", tc.scenario, ev.Security, ev.Rcode, ev.Why, ev.TTL)
		})
	}
	t.Run("legit/iterative", func(t *testing.T) {
		p := m.Profiles["legit"]
		ev, err := validatorFor(t, p, false).Resolve(ctx, recordOwner(t, p), dns.TypeTXT)
		if err != nil || ev.Security != validate.Secure {
			t.Fatalf("iterative: %v %+v", err, ev)
		}
		if ev.RRSIGExpiresAt == nil {
			t.Error("no RRSIG expiration recorded for a secure answer")
		}
	})
}
