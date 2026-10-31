package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/djzivkovic/splittrust/internal/api"
)

func init() {
	register("serve", "serve [--addr 127.0.0.1:8000]              HTTP API and the web console", runServe)
}

func runServe(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("serve", flag.ContinueOnError)
	fs.SetOutput(errOut)
	addr := fs.String("addr", "127.0.0.1:8000", "listen address")
	if err := fs.Parse(args); err != nil {
		return exitInvalid
	}
	e, code := loadEngine(errOut)
	if e == nil {
		return code
	}
	srv := &http.Server{Addr: *addr, Handler: api.NewHandlerWithProxy(e, os.Getenv("SPLITTRUST_PROXY"), api.BrowserFromEnv()), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 60 * time.Second}
	fmt.Fprintf(out, "SplitTrust console on http://%s  (validator: %s, %d scenarios, trust_context=lab)\n", *addr, e.Capabilities()["validator"], len(e.Manifest.Order))
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(errOut, err)
		return exitInvalid
	}
	return exitOK
}
