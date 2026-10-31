//go:build !libunbound

package validate

import (
	"context"
	"fmt"
	"time"

	"github.com/miekg/dns"
)

// daemonResolver is the decided fallback: a localhost unbound daemon configured
// with the lab trust anchor answers with the AD bit for Secure data and with
// SERVFAIL plus an Extended DNS Error (RFC 8914) for Bogus data. Only iterative
// resolution is supported by this fallback (one daemon, one configuration).
type daemonResolver struct {
	cfg Config
}

// New returns the daemon-backed validator (build without the libunbound tag).
func New(cfg Config) (PublicResolver, error) {
	if cfg.DaemonAddr == "" {
		return nil, fmt.Errorf("validate: this build uses the unbound daemon fallback and needs DaemonAddr")
	}
	if cfg.Forward != nil {
		return nil, fmt.Errorf("validate: the daemon fallback supports iterative resolution only; rebuild with -tags libunbound for via-network")
	}
	if cfg.Timeout == 0 {
		cfg.Timeout = 5 * time.Second
	}
	return &daemonResolver{cfg: cfg}, nil
}

// Backend names the implementation for /api/capabilities and README.
func Backend() string { return "unbound daemon fallback (AD bit + Extended DNS Errors)" }

func (r *daemonResolver) Describe() (string, string) { return "iterative", "" }

func (r *daemonResolver) Resolve(ctx context.Context, qname string, qtype uint16) (Evidence, error) {
	ev := Evidence{QName: dns.Fqdn(qname), QType: typeName(qtype), Resolution: "iterative", ObservedAt: time.Now().UTC(), Security: ErrorState}
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(qname), qtype)
	m.SetEdns0(1232, true)
	m.AuthenticatedData = true
	c := &dns.Client{Net: "tcp", Timeout: r.cfg.Timeout}
	in, _, err := c.ExchangeContext(ctx, m, r.cfg.DaemonAddr)
	if err != nil {
		ev.Why = err.Error()
		return ev, err
	}
	fillFromMsg(&ev, in)
	switch {
	case in.AuthenticatedData:
		ev.Security = Secure
	case in.Rcode == dns.RcodeServerFailure:
		if why, ok := edeText(in); ok {
			ev.Security = Bogus
			ev.Why = why
		} else {
			ev.Why = "SERVFAIL without an Extended DNS Error"
		}
	default:
		ev.Security = Insecure
	}
	return ev, nil
}

// edeText extracts a DNSSEC-related Extended DNS Error (codes 6–12 are the
// DNSSEC failure classes of RFC 8914).
func edeText(m *dns.Msg) (string, bool) {
	opt := m.IsEdns0()
	if opt == nil {
		return "", false
	}
	for _, o := range opt.Option {
		if e, ok := o.(*dns.EDNS0_EDE); ok && e.InfoCode >= 6 && e.InfoCode <= 12 {
			return fmt.Sprintf("%s: %s", dns.ExtendedErrorCodeToString[e.InfoCode], e.ExtraText), true
		}
	}
	return "", false
}
