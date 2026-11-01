package democmd

import (
	"bytes"
	"context"
	"errors"
	"os/exec"
	"time"
)

const maxOutputBytes = 64 << 10

// CommandResult contains the unmodified output of one process, up to the cap.
type CommandResult struct {
	Command    []string `json:"command"`
	Stdout     string   `json:"stdout"`
	Stderr     string   `json:"stderr"`
	ExitCode   int      `json:"exit_code"`
	DurationMS int64    `json:"duration_ms"`
	Truncated  bool     `json:"truncated"`
	Error      string   `json:"error,omitempty"`
}

type Executor interface {
	Execute(context.Context, string, ...string) CommandResult
}

type SystemExecutor struct{}

type cappedOutput struct {
	buffer    bytes.Buffer
	truncated bool
}

func (w *cappedOutput) Write(p []byte) (int, error) {
	n := len(p)
	remaining := maxOutputBytes - w.buffer.Len()
	if len(p) > remaining {
		w.truncated = true
		p = p[:remaining]
	}
	_, err := w.buffer.Write(p)
	return n, err
}

func (SystemExecutor) Execute(ctx context.Context, name string, args ...string) CommandResult {
	start := time.Now()
	result := CommandResult{Command: append([]string{name}, args...), ExitCode: -1}
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.WaitDelay = time.Second
	var stdout, stderr cappedOutput
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	err := cmd.Run()
	result.Stdout, result.Stderr = stdout.buffer.String(), stderr.buffer.String()
	result.Truncated = stdout.truncated || stderr.truncated
	result.DurationMS = time.Since(start).Milliseconds()
	switch {
	case ctx.Err() != nil:
		result.Error = ctx.Err().Error()
	case err == nil:
		result.ExitCode = 0
	default:
		var exit *exec.ExitError
		if errors.As(err, &exit) {
			result.ExitCode = exit.ExitCode()
		} else {
			result.Error = err.Error()
		}
	}
	return result
}
