package labgen

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
)

func TestGitLabStoryGeneratesSignedOfficeAnswerAndHotelClaimForTheSameName(t *testing.T) {
	dir := t.TempDir()
	if err := Generate(dir, time.Now()); err != nil {
		t.Fatal(err)
	}
	manifest, err := lab.Load(filepath.Join(dir, "client", "manifest.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"gitlab-office", "gitlab-hotel"} {
		p, ok := manifest.Profiles[id]
		if !ok || p.ExampleQName != "git.dev.corp.lab" || p.ClaimSource != "inline" {
			t.Fatalf("missing GitLab profile: %s %+v", id, p)
		}
		data, err := os.ReadFile(filepath.Join(dir, "client", "claims", id+".json"))
		if err != nil {
			t.Fatal(err)
		}
		var claims []claim.RawClaim
		if err := json.Unmarshal(data, &claims); err != nil {
			t.Fatal(err)
		}
		if len(claims) != 1 || claims[0].Parent != "corp.lab" || strings.Join(claims[0].Subdomains, ",") != "dev" {
			t.Fatalf("wrong GitLab scope: %+v", claims)
		}
	}
	data, err := os.ReadFile(filepath.Join(dir, "local-dot", "dev.corp.lab.zone"))
	if err != nil {
		t.Fatal(err)
	}
	var key *dns.DNSKEY
	var signature *dns.RRSIG
	var answer *dns.A
	for _, line := range strings.Split(strings.TrimSpace(string(data)), "\n") {
		rr, err := dns.NewRR(line)
		if err != nil {
			t.Fatal(err)
		}
		switch rr := rr.(type) {
		case *dns.DNSKEY:
			if rr.Flags == 256 {
				key = rr
			}
		case *dns.RRSIG:
			if rr.Hdr.Name == "git.dev.corp.lab." && rr.TypeCovered == dns.TypeA {
				signature = rr
			}
		case *dns.A:
			if rr.Hdr.Name == "git.dev.corp.lab." {
				answer = rr
			}
		}
	}
	if key == nil || signature == nil || answer == nil || answer.A.String() != "10.20.0.10" {
		t.Fatal("GitLab must have an actual signed private address")
	}
	if err := signature.Verify(key, []dns.RR{answer}); err != nil {
		t.Fatalf("GitLab signature: %v", err)
	}
	hosts, err := os.ReadFile(filepath.Join(dir, "hotel-dot", "hosts"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(hosts), "172.30.97.66 git.dev.corp.lab\n") {
		t.Fatal("hotel must override the same GitLab hostname")
	}
	if strings.Contains(string(hosts), " www.corp.lab\n") {
		t.Fatal("GitLab story must not redirect unrelated public company names")
	}
}
