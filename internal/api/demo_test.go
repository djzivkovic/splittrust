package api

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/djzivkovic/splittrust/internal/democmd"
)

type fakeDemo struct {
	calls int
	err   error
}

func (f *fakeDemo) Presets() []democmd.Preset { return []democmd.Preset{{ID: "hotel-unverified"}} }
func (f *fakeDemo) Run(context.Context, string) (democmd.Report, error) {
	f.calls++
	return democmd.Report{PresetID: "hotel-unverified", Outcome: "redirected"}, f.err
}

func TestDemoAPIRefusesCallerCommands(t *testing.T) {
	runner := &fakeDemo{}
	h := NewHandlerWithDemo(&fakeService{}, "", nil, runner)
	r := post(t, h, "/api/demo/run", `{"preset_id":"hotel-unverified","command":"echo injected"}`)
	if r.Code != 422 || runner.calls != 0 {
		t.Fatalf("%d calls=%d", r.Code, runner.calls)
	}
}

func TestDemoAPIReturnsActualReportAndBusyStatus(t *testing.T) {
	runner := &fakeDemo{}
	h := NewHandlerWithDemo(&fakeService{}, "", nil, runner)
	r := post(t, h, "/api/demo/run", `{"preset_id":"hotel-unverified"}`)
	if r.Code != 200 || runner.calls != 1 {
		t.Fatalf("%d %s", r.Code, r.Body)
	}
	runner.err = democmd.ErrBusy
	if r = post(t, h, "/api/demo/run", `{"preset_id":"hotel-unverified"}`); r.Code != http.StatusConflict {
		t.Fatalf("busy status = %d", r.Code)
	}
}

func TestDemoCommandsAreDisabledWithoutExplicitRunner(t *testing.T) {
	h := NewHandler(&fakeService{})
	r := httptest.NewRecorder()
	h.ServeHTTP(r, httptest.NewRequest(http.MethodGet, "/api/demo/presets", nil))
	if r.Code != http.StatusServiceUnavailable {
		t.Fatalf("disabled runner = %d", r.Code)
	}
}
