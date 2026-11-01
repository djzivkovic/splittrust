package api

import (
	"context"
	"errors"
	"net/http"
	"time"

	"github.com/djzivkovic/splittrust/internal/democmd"
)

type DemoRunner interface {
	Presets() []democmd.Preset
	Run(context.Context, string) (democmd.Report, error)
}

func (h *handler) demoPresets(w http.ResponseWriter, r *http.Request) {
	if h.demo == nil {
		writeError(w, http.StatusServiceUnavailable, "Docker command presets are not enabled on this server")
		return
	}
	writeJSON(w, http.StatusOK, h.demo.Presets())
}

func (h *handler) demoRun(w http.ResponseWriter, r *http.Request) {
	if h.demo == nil {
		writeError(w, http.StatusServiceUnavailable, "Docker command presets are not enabled on this server")
		return
	}
	var request struct {
		PresetID string `json:"preset_id"`
	}
	if !decode(w, r, &request) {
		return
	}
	if request.PresetID == "" {
		writeError(w, http.StatusUnprocessableEntity, "preset_id is required")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 40*time.Second)
	defer cancel()
	report, err := h.demo.Run(ctx, request.PresetID)
	switch {
	case errors.Is(err, democmd.ErrUnknownPreset):
		writeError(w, http.StatusNotFound, err.Error())
	case errors.Is(err, democmd.ErrBusy):
		writeError(w, http.StatusConflict, err.Error())
	case err != nil:
		writeError(w, http.StatusInternalServerError, err.Error())
	default:
		writeJSON(w, http.StatusOK, report)
	}
}
