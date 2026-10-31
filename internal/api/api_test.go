package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/engine"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/verify"
)

type fakeService struct {
	calls int
}

func (f *fakeService) Summaries() []lab.Summary {
	return []lab.Summary{{ID: "wrong-ds", Title: "Wrong ds", DefaultDevice: "validating-stub"}}
}

func (f *fakeService) Capabilities() map[string]any { return map[string]any{"trust_context": "lab"} }

func (f *fakeService) Verify(_ context.Context, id string, _ *claim.RawClaim, opt verify.Options) (verify.Run, error) {
	f.calls++
	if id != "wrong-ds" {
		return verify.Run{}, engine.ErrUnknownScenario
	}
	return verify.Run{SchemaVersion: 1, ScenarioID: id, Device: opt.Device, TrustContext: "lab", Decision: "rejected",
		Claims: []verify.ClaimReport{{Resolver: "dns.wrongds.lab", Decision: "rejected", Reason: "DS_MISMATCH",
			Stages: []verify.Stage{{ID: "ds", Status: "fail", Code: "DS_MISMATCH"}}}}}, nil
}

func (f *fakeService) Live(_ context.Context, id string) (engine.LiveRecord, error) {
	if id != "wrong-ds" {
		return engine.LiveRecord{}, engine.ErrUnknownScenario
	}
	return engine.LiveRecord{Parent: "wrongds.lab.", Trust: "lab"}, nil
}

func (f *fakeService) Resolve(_ context.Context, id, qname string, opt verify.Options) (route.Report, error) {
	f.calls++
	if id != "wrong-ds" {
		return route.Report{}, engine.ErrUnknownScenario
	}
	return route.Report{QName: qname, Route: "default", RouteReason: "DEFAULT_CLAIM_REJECTED", TrustContext: "lab"}, nil
}

func post(t *testing.T, h http.Handler, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func TestRejectedIs200Report(t *testing.T) {
	svc := &fakeService{}
	rec := post(t, NewHandler(svc), "/api/verify", `{"scenario_id":"wrong-ds"}`)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	var run verify.Run
	if err := json.Unmarshal(rec.Body.Bytes(), &run); err != nil {
		t.Fatal(err)
	}
	if run.Decision != "rejected" || run.Claims[0].Reason != "DS_MISMATCH" || run.Claims[0].Grant != nil || run.TrustContext != "lab" {
		t.Errorf("run = %+v", run)
	}
}

func TestUnknownFieldIs422(t *testing.T) {
	svc := &fakeService{}
	rec := post(t, NewHandler(svc), "/api/verify", `{"scenario_id":"wrong-ds","url":"http://127.0.0.1:9"}`)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
	if svc.calls != 0 {
		t.Errorf("service called with an invalid envelope")
	}
	if rec := post(t, NewHandler(svc), "/api/verify", `{"scenario_id":"wrong-ds","device":"toaster"}`); rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("unknown device accepted: %d", rec.Code)
	}
}

func TestUnknownScenarioIs404(t *testing.T) {
	rec := post(t, NewHandler(&fakeService{}), "/api/verify", `{"scenario_id":"nope"}`)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("status %d: %s", rec.Code, rec.Body)
	}
}

func TestBodyLimit413(t *testing.T) {
	big := `{"scenario_id":"wrong-ds","device":"` + strings.Repeat("x", 17<<10) + `"}`
	rec := post(t, NewHandler(&fakeService{}), "/api/verify", big)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", rec.Code)
	}
}

func TestInspectAndBuild(t *testing.T) {
	h := NewHandler(&fakeService{})
	body := `{"claim":{"resolver":"dns.firma.rs","parent":"firma.rs","subdomains":["mail","intranet"],"algorithm":"SHA384","salt":"Vn3kQ2r9bXz0pLm4Yt8wHA","future":1}}`
	rec := post(t, h, "/api/inspect", body)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte("PJv5v0eMID1V22B3Cp2bw1ge0yxBGVMtNaMatP_7HBuNyQn4Xu8WlsnYOI9v7z2E")) {
		t.Fatalf("inspect: %d %s", rec.Code, rec.Body)
	}
	rec = post(t, h, "/api/records/build", `{"resolver":"dns.firma.rs","parent":"firma.rs","subdomains":["intranet"]}`)
	if rec.Code != http.StatusOK || !bytes.Contains(rec.Body.Bytes(), []byte(`"signing_state": "not_checked"`)) {
		t.Fatalf("build: %d %s", rec.Code, rec.Body)
	}
	for _, p := range []string{"/", "/live", "/about/anything"} { // SPA routes fall back to index.html
		req := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusOK || !bytes.Contains(w.Body.Bytes(), []byte("SplitTrust")) {
			t.Fatalf("console page %s: %d", p, w.Code)
		}
	}
	for _, p := range []string{"/api/nothing", "/missing.js"} {
		req := httptest.NewRequest(http.MethodGet, p, nil)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, req)
		if w.Code != http.StatusNotFound || bytes.Contains(w.Body.Bytes(), []byte("<html")) {
			t.Fatalf("%s must be a plain 404, got %d", p, w.Code)
		}
	}
}
