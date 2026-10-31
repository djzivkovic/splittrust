package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/proxy"
	"github.com/djzivkovic/splittrust/internal/verify"
)

func init() {
	register("proxy", "proxy --scenario ID [--device D] [--listen :53] [--control :8001]   DNS front door: ordinary stubs resolve through the RFC 9704 verdicts", runProxy)
}

func runProxy(args []string, out, errOut io.Writer) int {
	fs := flag.NewFlagSet("proxy", flag.ContinueOnError)
	fs.SetOutput(errOut)
	scenario := fs.String("scenario", "", "network the device joins first (scenario id); change later via POST /join on the control port")
	device, resolution := deviceFlags(fs)
	listen := fs.String("listen", "0.0.0.0:53", "DNS listen address (UDP and TCP)")
	control := fs.String("control", "0.0.0.0:8001", "HTTP control address (GET /status, POST /join); empty disables")
	if err := fs.Parse(args); err != nil || *scenario == "" {
		fs.Usage()
		return exitInvalid
	}
	opt, err := options(*device, *resolution)
	if err != nil {
		return fail(errOut, err)
	}
	e, code := loadEngine(errOut)
	if e == nil {
		return code
	}
	logger := log.New(out, "proxy ", log.LstdFlags|log.LUTC)
	srv, err := proxy.New(proxy.Config{
		Profile:  e.Profile,
		Verifier: func(p lab.Profile) (*verify.Verifier, error) { return e.Verifier(p) },
		Log:      logger.Printf,
	})
	if err != nil {
		return fail(errOut, err)
	}
	if err := srv.Join(*scenario, opt.Device, opt.Resolution); err != nil {
		return fail(errOut, err)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if *control != "" {
		cs := &http.Server{Addr: *control, Handler: srv.ControlHandler(), ReadHeaderTimeout: 5 * time.Second}
		go func() {
			if err := cs.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				fmt.Fprintln(errOut, "control:", err)
			}
		}()
		defer cs.Shutdown(context.Background())
	}
	fmt.Fprintf(out, "SplitTrust DNS proxy on %s (control %s), network %q, device %s, trust_context=%s\n", *listen, *control, *scenario, srv.Status().Device, srv.Status().TrustContext)
	if err := srv.ListenAndServe(ctx, *listen); err != nil && ctx.Err() == nil {
		return fail(errOut, err)
	}
	return exitOK
}
