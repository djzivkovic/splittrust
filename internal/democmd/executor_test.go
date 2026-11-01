package democmd

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"
)

func TestExecutorCapturesActualExitOutputAndTruncation(t *testing.T) {
	t.Setenv("SPLITTRUST_EXEC_HELPER", "output")
	binary, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	result := (SystemExecutor{}).Execute(context.Background(), binary, "-test.run=^TestCommandHelper$")
	if result.ExitCode != 7 || result.Stderr != "actual stderr\n" || !result.Truncated || len(result.Stdout) != maxOutputBytes {
		t.Fatalf("exit=%d stderr=%q truncated=%v bytes=%d error=%s", result.ExitCode, result.Stderr, result.Truncated, len(result.Stdout), result.Error)
	}
}

func TestExecutorTerminatesAtDeadline(t *testing.T) {
	t.Setenv("SPLITTRUST_EXEC_HELPER", "wait")
	binary, _ := os.Executable()
	ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
	defer cancel()
	result := (SystemExecutor{}).Execute(ctx, binary, "-test.run=^TestCommandHelper$")
	if !strings.Contains(result.Error, "deadline exceeded") || result.ExitCode == 0 {
		t.Fatalf("timeout became success: %+v", result)
	}
}

func TestCommandHelper(t *testing.T) {
	switch os.Getenv("SPLITTRUST_EXEC_HELPER") {
	case "output":
		os.Stdout.Write(bytes.Repeat([]byte("x"), maxOutputBytes+100))
		fmt.Fprintln(os.Stderr, "actual stderr")
		os.Exit(7)
	case "wait":
		time.Sleep(10 * time.Second)
		os.Exit(0)
	}
}
