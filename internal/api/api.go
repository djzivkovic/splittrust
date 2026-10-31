// Package api exposes the engine over HTTP and serves the embedded console.
// Rejections are ordinary 200 reports; only malformed requests are errors.
package api

import (
	"bytes"
	"context"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path"
	"strings"
	"time"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/engine"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/owner"
	"github.com/djzivkovic/splittrust/internal/route"
	"github.com/djzivkovic/splittrust/internal/verify"
)

//go:embed web/dist
var webFS embed.FS

// MaxBody is the request body limit.
const MaxBody = 16 << 10

// Service is what the handlers need; *engine.Engine satisfies it.
type Service interface {
	Summaries() []lab.Summary
	Capabilities() map[string]any
	Verify(ctx context.Context, scenarioID string, inline *claim.RawClaim, opt verify.Options) (verify.Run, error)
	Resolve(ctx context.Context, scenarioID, qname string, opt verify.Options) (route.Report, error)
	Live(ctx context.Context, scenarioID string) (engine.LiveRecord, error)
}

type handler struct {
	svc      Service
	proxyURL string   // control endpoint of the lab's DNS proxy, "" when absent
	browser  *Browser // in-lab page fetcher for the "now browse" panel, nil when absent
}

// NewHandler builds the HTTP handler: /api/* plus the console at /.
func NewHandler(svc Service) http.Handler { return NewHandlerWithProxy(svc, "", nil) }

// NewHandlerWithProxy also exposes the lab DNS proxy's control API under
// /api/client/* (so the console can move the simulated client between
// networks) and, with a Browser, POST /api/browse.
func NewHandlerWithProxy(svc Service, proxyURL string, browser *Browser) http.Handler {
	h := &handler{svc: svc, proxyURL: strings.TrimSuffix(proxyURL, "/"), browser: browser}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/client/status", h.clientStatus)
	mux.HandleFunc("GET /api/client/log", h.clientLog)
	mux.HandleFunc("GET /api/lab/status", h.labStatus)
	mux.HandleFunc("POST /api/client/join", h.clientJoin)
	mux.HandleFunc("POST /api/browse", h.browse)
	mux.HandleFunc("POST /api/live", h.live)
	mux.HandleFunc("GET /api/health", h.health)
	mux.HandleFunc("GET /api/capabilities", h.capabilities)
	mux.HandleFunc("GET /api/scenarios", h.scenarios)
	mux.HandleFunc("POST /api/inspect", h.inspect)
	mux.HandleFunc("POST /api/verify", h.verify)
	mux.HandleFunc("POST /api/resolve", h.resolve)
	mux.HandleFunc("POST /api/records/build", h.build)
	mux.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) { writeError(w, http.StatusNotFound, "no such API route") })
	sub, _ := fs.Sub(webFS, "web/dist")
	mux.Handle("/", spaHandler(sub))
	return mux
}

// spaHandler serves the built console; unknown paths without a file extension
// fall back to index.html so the client-side router owns them.
func spaHandler(files fs.FS) http.Handler {
	static := http.FileServer(http.FS(files))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := strings.TrimPrefix(r.URL.Path, "/")
		if p == "" {
			p = "index.html"
		}
		if f, err := files.Open(p); err == nil {
			f.Close()
			static.ServeHTTP(w, r)
			return
		}
		if strings.Contains(path.Base(p), ".") {
			http.NotFound(w, r)
			return
		}
		r2 := r.Clone(r.Context())
		r2.URL.Path = "/"
		static.ServeHTTP(w, r2)
	})
}

type apiError struct {
	Error string `json:"error"`
	Code  int    `json:"code"`
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	enc := json.NewEncoder(w)
	enc.SetIndent("", "  ")
	_ = enc.Encode(v)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	writeJSON(w, status, apiError{Error: msg, Code: status})
}

// decode reads a strict JSON envelope (unknown fields rejected, body capped).
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBody)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(v); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body larger than 16 KiB")
			return false
		}
		writeError(w, http.StatusUnprocessableEntity, "invalid request: "+err.Error())
		return false
	}
	if dec.More() {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: trailing data")
		return false
	}
	return true
}

func parseOptions(device, resolution string) (verify.Options, error) {
	opt := verify.Options{Device: verify.Device(device), Resolution: verify.Resolution(resolution)}
	switch opt.Device {
	case "", verify.DeviceValidatingStub, verify.DevicePrivateDNS, verify.DeviceHybrid:
	default:
		return opt, fmt.Errorf("unknown device %q", device)
	}
	switch opt.Resolution {
	case "", verify.ViaNetwork, verify.Iterative:
	default:
		return opt, fmt.Errorf("unknown resolution %q", resolution)
	}
	return opt, nil
}

func (h *handler) health(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"status": "ok", "trust_context": "lab", "time": time.Now().UTC()})
}

func (h *handler) capabilities(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.svc.Capabilities())
}

func (h *handler) scenarios(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, h.svc.Summaries())
}

func (h *handler) inspect(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Claim json.RawMessage `json:"claim"`
	}
	if !decode(w, r, &req) {
		return
	}
	var raw claim.RawClaim
	if err := json.Unmarshal(req.Claim, &raw); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "claim: "+err.Error())
		return
	}
	ins, err := claim.Inspect(raw)
	if err != nil {
		var ce *claim.Error
		if errors.As(err, &ce) {
			writeJSON(w, http.StatusOK, map[string]any{"error": ce.Code, "detail": ce.Detail, "trust_context": "lab"})
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, ins)
}

func (h *handler) verify(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScenarioID string `json:"scenario_id"`
		Device     string `json:"device"`
		Resolution string `json:"resolution"`
	}
	if !decode(w, r, &req) {
		return
	}
	opt, err := parseOptions(req.Device, req.Resolution)
	if err != nil || req.ScenarioID == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: "+errString(err, "scenario_id is required"))
		return
	}
	run, err := h.svc.Verify(r.Context(), req.ScenarioID, nil, opt)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, run)
}

func (h *handler) resolve(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScenarioID string `json:"scenario_id"`
		QName      string `json:"qname"`
		Device     string `json:"device"`
		Resolution string `json:"resolution"`
	}
	if !decode(w, r, &req) {
		return
	}
	opt, err := parseOptions(req.Device, req.Resolution)
	if err != nil || req.ScenarioID == "" || strings.TrimSpace(req.QName) == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: "+errString(err, "scenario_id and qname are required"))
		return
	}
	rep, err := h.svc.Resolve(r.Context(), req.ScenarioID, req.QName, opt)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, rep)
}

func (h *handler) live(w http.ResponseWriter, r *http.Request) {
	var req struct {
		ScenarioID string `json:"scenario_id"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.ScenarioID == "" {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: scenario_id is required")
		return
	}
	lr, err := h.svc.Live(r.Context(), req.ScenarioID)
	if err != nil {
		h.serviceError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, lr)
}

func (h *handler) build(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, MaxBody)
	var buf bytes.Buffer
	if _, err := buf.ReadFrom(r.Body); err != nil {
		var mbe *http.MaxBytesError
		if errors.As(err, &mbe) {
			writeError(w, http.StatusRequestEntityTooLarge, "request body larger than 16 KiB")
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	var req owner.Request
	if err := json.Unmarshal(buf.Bytes(), &req); err != nil {
		writeError(w, http.StatusUnprocessableEntity, "invalid request: "+err.Error())
		return
	}
	b, err := owner.Make(req)
	if err != nil {
		var ce *claim.Error
		if errors.As(err, &ce) {
			writeJSON(w, http.StatusOK, map[string]any{"error": ce.Code, "detail": ce.Detail, "trust_context": "lab"})
			return
		}
		writeError(w, http.StatusUnprocessableEntity, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, b)
}

func (h *handler) clientStatus(w http.ResponseWriter, r *http.Request) {
	if h.proxyURL == "" {
		writeError(w, http.StatusNotFound, "no DNS proxy configured (SPLITTRUST_PROXY)")
		return
	}
	h.relay(w, r, http.MethodGet, "/status", nil)
}

func (h *handler) clientLog(w http.ResponseWriter, r *http.Request) {
	if h.proxyURL == "" {
		writeError(w, http.StatusNotFound, "no DNS proxy configured (SPLITTRUST_PROXY)")
		return
	}
	h.relay(w, r, http.MethodGet, "/log", nil)
}

func (h *handler) clientJoin(w http.ResponseWriter, r *http.Request) {
	if h.proxyURL == "" {
		writeError(w, http.StatusNotFound, "no DNS proxy configured (SPLITTRUST_PROXY)")
		return
	}
	var req struct {
		ScenarioID string `json:"scenario_id"`
		Device     string `json:"device"`
		Resolution string `json:"resolution"`
	}
	if !decode(w, r, &req) {
		return
	}
	body, _ := json.Marshal(req)
	h.relay(w, r, http.MethodPost, "/join", bytes.NewReader(body))
}

func (h *handler) relay(w http.ResponseWriter, r *http.Request, method, path string, body *bytes.Reader) {
	var rd io.Reader
	if body != nil {
		rd = body
	}
	req, err := http.NewRequestWithContext(r.Context(), method, h.proxyURL+path, rd)
	if err != nil {
		writeError(w, http.StatusBadGateway, err.Error())
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		writeError(w, http.StatusBadGateway, "DNS proxy unreachable: "+err.Error())
		return
	}
	defer resp.Body.Close()
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(resp.StatusCode)
	_, _ = io.Copy(w, io.LimitReader(resp.Body, MaxBody))
}

func (h *handler) serviceError(w http.ResponseWriter, err error) {
	if errors.Is(err, engine.ErrUnknownScenario) {
		writeError(w, http.StatusNotFound, err.Error())
		return
	}
	writeError(w, http.StatusInternalServerError, err.Error())
}

func errString(err error, fallback string) string {
	if err != nil {
		return err.Error()
	}
	return fallback
}
