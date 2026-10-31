//go:build integration

package integration

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"testing"
	"time"

	"github.com/djzivkovic/splittrust/internal/engine"
	"github.com/djzivkovic/splittrust/internal/verify"
)

func loadEngine(t *testing.T) *engine.Engine {
	t.Helper()
	path := os.Getenv("SPLITTRUST_MANIFEST")
	if path == "" {
		t.Skip("SPLITTRUST_MANIFEST not set; run inside the lab")
	}
	e, err := engine.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	return e
}

// Every scenario, for every device the demo lists, in catalogue order and in
// reverse: verdicts must equal the expected table and never depend on order.
func TestAllScenariosForwardAndReverse(t *testing.T) {
	e := loadEngine(t)
	order := e.Manifest.Order
	reverse := make([]string, len(order))
	for i, id := range order {
		reverse[len(order)-1-i] = id
	}
	for pass, ids := range [][]string{order, reverse} {
		for _, id := range ids {
			p := e.Manifest.Profiles[id]
			for _, exp := range p.Expected {
				name := fmt.Sprintf("pass%d/%s/%s", pass, id, exp.Device)
				t.Run(name, func(t *testing.T) {
					run, err := e.Verify(context.Background(), id, nil, verify.Options{Device: verify.Device(exp.Device)})
					if err != nil {
						t.Fatal(err)
					}
					if run.Decision != exp.Decision {
						t.Fatalf("decision %s, want %s (%s)", run.Decision, exp.Decision, reasons(run))
					}
					for _, c := range run.Claims {
						if c.Reason != exp.Reason {
							t.Errorf("claim %d reason %s, want %s", c.Index, c.Reason, exp.Reason)
						}
					}
					if id == "hotel-forged" {
						st := stageOf(run.Claims[0], "public_dnssec")
						if ev, _ := json.Marshal(st.Evidence); !bytes.Contains(ev, []byte("DS banka.lab")) {
							t.Errorf("forged-record evidence should name the missing DS chain: %s", ev)
						}
					}
				})
			}
		}
	}
}

// The deployed app (its own binary, over HTTP) and the in-process engine must agree.
func TestAPIParity(t *testing.T) {
	e := loadEngine(t)
	base := os.Getenv("SPLITTRUST_API")
	if base == "" {
		base = "http://172.30.97.50:8000"
	}
	client := &http.Client{Timeout: 30 * time.Second}
	if _, err := client.Get(base + "/api/health"); err != nil {
		t.Skipf("app not reachable at %s: %v", base, err)
	}
	for _, id := range e.Manifest.Order {
		p := e.Manifest.Profiles[id]
		want, err := e.Verify(context.Background(), id, nil, verify.Options{Device: verify.Device(p.DefaultDevice)})
		if err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(map[string]string{"scenario_id": id, "device": p.DefaultDevice})
		resp, err := client.Post(base+"/api/verify", "application/json", bytes.NewReader(body))
		if err != nil {
			t.Fatal(err)
		}
		var got verify.Run
		if err := json.NewDecoder(resp.Body).Decode(&got); err != nil {
			t.Fatal(err)
		}
		resp.Body.Close()
		if resp.StatusCode != 200 || got.Decision != want.Decision || got.TrustContext != "lab" || len(got.Claims) != len(want.Claims) {
			t.Errorf("%s: api %d %s vs engine %s", id, resp.StatusCode, got.Decision, want.Decision)
			continue
		}
		for i := range got.Claims {
			if got.Claims[i].Reason != want.Claims[i].Reason {
				t.Errorf("%s claim %d: api %s vs engine %s", id, i, got.Claims[i].Reason, want.Claims[i].Reason)
			}
			for j := range got.Claims[i].Stages {
				if j < len(want.Claims[i].Stages) && got.Claims[i].Stages[j].Status != want.Claims[i].Stages[j].Status {
					t.Errorf("%s claim %d stage %s: api %s vs engine %s", id, i, got.Claims[i].Stages[j].ID, got.Claims[i].Stages[j].Status, want.Claims[i].Stages[j].Status)
				}
			}
		}
	}
}

// The payoff and the hijack: the legitimate claim yields a validated local
// answer; the hotel's hijacked answer never reaches a validating device.
func TestResolvePaths(t *testing.T) {
	e := loadEngine(t)
	ctx := context.Background()
	rep, err := e.Resolve(ctx, "legit", "host.internal.corp.lab", verify.Options{})
	if err != nil || rep.Route != "local" || len(rep.Answers) != 1 || rep.Answers[0] != "10.0.5.20" {
		t.Fatalf("legit local route: %v %+v", err, rep)
	}
	rep, _ = e.Resolve(ctx, "legit", "host.mail.corp.lab", verify.Options{})
	if rep.ErrorCode != "LOCAL_DNSSEC_NOT_ESTABLISHED" {
		t.Errorf("token-only claim must not yield a validated local answer: %+v", rep)
	}
	rep, _ = e.Resolve(ctx, "hotel", "www.banka.lab", verify.Options{Device: verify.DeviceValidatingStub})
	if rep.Route != "default" || rep.ErrorCode != "DEFAULT_LOOKUP_FAILED" || len(rep.Answers) != 0 {
		t.Errorf("hijacked answer accepted by a validating device: %+v", rep)
	}
	rep, _ = e.Resolve(ctx, "hotel", "www.banka.lab", verify.Options{Device: verify.DevicePrivateDNS})
	if rep.Route != "default" || len(rep.Answers) != 1 || rep.Answers[0] != "172.30.97.80" {
		t.Errorf("private-dns device should get the bank's real address via quad9: %+v", rep)
	}
	rep, _ = e.Resolve(ctx, "legit", "example.com", verify.Options{})
	if rep.Route != "none" || rep.ErrorCode != "OUT_OF_LAB_SCOPE" {
		t.Errorf("out-of-lab name must be blocked: %+v", rep)
	}
}

func reasons(run verify.Run) string {
	var out []string
	for _, c := range run.Claims {
		out = append(out, c.Reason)
	}
	return fmt.Sprint(out)
}

func stageOf(c verify.ClaimReport, id string) verify.Stage {
	for _, s := range c.Stages {
		if s.ID == id {
			return s
		}
	}
	return verify.Stage{}
}
