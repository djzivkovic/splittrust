//go:build libunbound

package validate

import (
	"context"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/miekg/dns"
	"github.com/miekg/unbound"
)

// libunboundResolver validates in-process with a fresh libunbound context per
// lookup, so no cache state survives between verifications or scenarios.
type libunboundResolver struct {
	cfg Config
}

// New returns the in-process libunbound validator.
func New(cfg Config) (PublicResolver, error) {
	if cfg.AnchorFile == "" {
		return nil, fmt.Errorf("validate: trust anchor file is required")
	}
	if cfg.Forward == nil && cfg.RootHintsFile == "" {
		return nil, fmt.Errorf("validate: iterative resolution needs a root hints file")
	}
	if cfg.Forward != nil && cfg.CAFile == "" {
		return nil, fmt.Errorf("validate: forwarding over TLS needs the CA bundle")
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 5 * time.Second
	}
	return &libunboundResolver{cfg: cfg}, nil
}

// Backend names the implementation for /api/capabilities and README.
func Backend() string { return "libunbound (cgo, in-process, fresh context per lookup)" }

func (r *libunboundResolver) Describe() (string, string) { return r.cfg.describe() }

// configText renders the per-lookup unbound configuration: the lab trust anchor,
// and either root hints (iterative) or a TLS-authenticated forward zone to the
// network's announced resolver (via-network).
func (r *libunboundResolver) configText() string {
	var b strings.Builder
	b.WriteString("server:\n")
	fmt.Fprintf(&b, "  trust-anchor-file: %q\n", r.cfg.AnchorFile)
	b.WriteString("  harden-dnssec-stripped: yes\n  harden-glue: yes\n  val-log-level: 2\n  do-not-query-localhost: no\n  qname-minimisation: no\n")
	if r.cfg.CAFile != "" {
		fmt.Fprintf(&b, "  tls-cert-bundle: %q\n", r.cfg.CAFile)
	}
	if r.cfg.Forward == nil {
		fmt.Fprintf(&b, "  root-hints: %q\n", r.cfg.RootHintsFile)
	} else {
		host, port, _ := strings.Cut(r.cfg.Forward.Addr, ":")
		if port == "" {
			port = "853"
		}
		// Strip IPv6 brackets if present.
		host = strings.Trim(host, "[]")
		fmt.Fprintf(&b, "forward-zone:\n  name: \".\"\n  forward-addr: %s@%s#%s\n  forward-tls-upstream: yes\n", host, port, r.cfg.Forward.ServerName)
	}
	return b.String()
}

func (r *libunboundResolver) Resolve(ctx context.Context, qname string, qtype uint16) (Evidence, error) {
	resolution, fwd := r.cfg.describe()
	ev := Evidence{QName: dns.Fqdn(qname), QType: typeName(qtype), Resolution: resolution, Forwarder: fwd, ObservedAt: time.Now().UTC(), Security: ErrorState}

	f, err := os.CreateTemp("", "splittrust-ub-*.conf")
	if err != nil {
		return ev, err
	}
	defer os.Remove(f.Name())
	if _, err := f.WriteString(r.configText()); err != nil {
		f.Close()
		return ev, err
	}
	f.Close()

	u := unbound.New()
	defer u.Destroy()
	if err := u.Config(f.Name()); err != nil {
		return ev, fmt.Errorf("libunbound config: %v", err)
	}

	type outcome struct {
		res *unbound.Result
		err error
	}
	done := make(chan outcome, 1)
	go func() {
		res, err := u.Resolve(dns.Fqdn(qname), qtype, dns.ClassINET)
		done <- outcome{res, err}
	}()
	timeout := r.cfg.Timeout
	select {
	case <-ctx.Done():
		ev.Why = "context cancelled: " + ctx.Err().Error()
		return ev, ctx.Err()
	case <-time.After(timeout):
		ev.Why = fmt.Sprintf("no answer from the validator within %s", timeout)
		return ev, fmt.Errorf("validate: timeout after %s", timeout)
	case o := <-done:
		if o.err != nil {
			ev.Why = o.err.Error()
			return ev, o.err
		}
		res := o.res
		fillFromMsg(&ev, res.AnswerPacket)
		if ev.Rcode == "" {
			ev.Rcode = dns.RcodeToString[res.Rcode]
		}
		switch {
		case res.Secure:
			ev.Security = Secure
		case res.Bogus:
			ev.Security = Bogus
			ev.Why = res.WhyBogus
		case res.Rcode == dns.RcodeServerFailure && res.AnswerPacket == nil:
			// Upstream failure without a validation verdict: operational, not a DNSSEC state.
			ev.Security = ErrorState
			ev.Why = "SERVFAIL from the resolution path"
		default:
			ev.Security = Insecure
		}
		return ev, nil
	}
}
