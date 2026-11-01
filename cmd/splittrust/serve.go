package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"

	"github.com/djzivkovic/splittrust/internal/api"
	"github.com/djzivkovic/splittrust/internal/democmd"
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
	var demo api.DemoRunner
	if os.Getenv("SPLITTRUST_DEMO_COMMANDS") == "1" {
		cfg := democmd.Config{HotelDNS: "172.30.97.21:53", PublicDNS: "172.30.97.10:53", ProxyDNS: "172.30.97.63:53",
			ProxyURL: "http://172.30.97.63:8001", FakeIP: "172.30.97.66", IntranetIP: "172.30.97.70"}
		runner, err := democmd.New(cfg, nil)
		if err != nil {
			return fail(errOut, err)
		}
		demo = runner
	}
	srv := &http.Server{Addr: *addr, Handler: api.NewHandlerWithDemo(e, os.Getenv("SPLITTRUST_PROXY"), api.BrowserFromEnv(e.Namespaces()), demo), ReadHeaderTimeout: 5 * time.Second, WriteTimeout: 60 * time.Second}
	fmt.Fprintf(out, "SplitTrust console on http://%s  (validator: %s, %d scenarios, trust_context=lab)\n", *addr, e.Capabilities()["validator"], len(e.Manifest.Order))
	if err := srv.ListenAndServe(); err != nil {
		fmt.Fprintln(errOut, err)
		return exitInvalid
	}
	return exitOK
}
