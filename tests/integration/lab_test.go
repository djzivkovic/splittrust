//go:build integration

// Package integration exercises the running laboratory. It is executed by the
// compose "test" service (go test -tags "integration libunbound" ./tests/...)
// and needs SPLITTRUST_MANIFEST to point at the generated manifest.
package integration

import (
	"context"
	"crypto/x509"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/dot"
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

// The replay defence: the hotel's resolver cannot present a certificate for
// dns.corp.lab, while the company's resolver can.
func TestDoTIdentity(t *testing.T) {
	m := manifest(t)
	p := m.Profiles["legit"]
	pem, err := os.ReadFile(p.CAFile)
	if err != nil {
		t.Fatal(err)
	}
	pool := x509.NewCertPool()
	if !pool.AppendCertsFromPEM(pem) {
		t.Fatal("bad CA bundle")
	}
	c := &dot.Client{Roots: pool, Timeout: 3 * time.Second}
	ctx := context.Background()

	hotel := m.Profiles["hotel"].NetworkResolvers[0].Addr
	_, err = c.Dial(ctx, hotel, "dns.corp.lab")
	var ie *dot.IdentityError
	if !errors.As(err, &ie) {
		t.Fatalf("hotel-dot accepted as dns.corp.lab: %v", err)
	}
	conn, err := c.Dial(ctx, p.NetworkResolvers[0].Addr, "dns.corp.lab")
	if err != nil {
		t.Fatalf("local-dot rejected as dns.corp.lab: %v", err)
	}
	defer conn.Close()
	msg, err := conn.Query(ctx, "resolver.arpa.", dns.TypeDNSKEY)
	if err != nil || len(msg.Answer) == 0 {
		t.Fatalf("resolver.arpa DNSKEY over DoT: %v %v", err, msg)
	}
	t.Logf("resolver.arpa. DNSKEY: %s", msg.Answer[0])
}

// A validator whose forwarder never answers must time out cleanly and leave the
// process healthy for the next lookup (the libunbound context is owned by the
// resolving goroutine and destroyed only after ub_resolve returns).
func TestValidatorTimeoutIsClean(t *testing.T) {
	m := manifest(t)
	p := m.Profiles["legit"]
	cfg := validate.Config{AnchorFile: p.AnchorFile, RootHintsFile: p.RootHints, CAFile: p.CAFile, Timeout: 1500 * time.Millisecond,
		Forward: &validate.Forwarder{Addr: "172.30.97.99:853", ServerName: "dns.nowhere.lab"}}
	v, err := validate.New(cfg)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		ev, err := v.Resolve(context.Background(), recordOwner(t, p), dns.TypeTXT)
		if err == nil || ev.Security != validate.ErrorState {
			t.Fatalf("blackholed forwarder: err=%v security=%s", err, ev.Security)
		}
	}
	ev, err := validatorFor(t, p, true).Resolve(context.Background(), recordOwner(t, p), dns.TypeTXT)
	if err != nil || ev.Security != validate.Secure {
		t.Fatalf("validator unhealthy after timeouts: %v %s", err, ev.Security)
	}
}
