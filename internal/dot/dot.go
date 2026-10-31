// Package dot is a minimal DNS-over-TLS client (RFC 7858) that authenticates the
// server by name: the ADN from the authorization claim (RFC 9704 section 5) or
// the external resolver's name (section 6.1), against the configured CA pool.
package dot

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"errors"
	"fmt"
	"net"
	"time"

	"github.com/miekg/dns"
)

// Client dials DoT endpoints.
type Client struct {
	Roots   *x509.CertPool
	Timeout time.Duration
}

// IdentityError means the endpoint answered TLS but its certificate is not valid
// for the expected name under the configured CA pool (RFC 9525 matching).
type IdentityError struct {
	ServerName string
	Err        error
	// Peer is the leaf certificate the endpoint presented, kept as evidence
	// (never trusted): "the certificate is for dns.hotel.lab, not dns.corp.lab".
	Peer *x509.Certificate
}

func (e *IdentityError) Error() string {
	return fmt.Sprintf("certificate not valid for %s: %v", e.ServerName, e.Err)
}

func (e *IdentityError) Unwrap() error { return e.Err }

// Conn is an authenticated DoT connection.
type Conn struct {
	conn    *tls.Conn
	timeout time.Duration
	// Peer is the leaf certificate the server presented.
	Peer *x509.Certificate
}

// Dial connects to addr (host:port) and authenticates it as serverName.
func (c *Client) Dial(ctx context.Context, addr, serverName string) (*Conn, error) {
	timeout := c.Timeout
	if timeout == 0 {
		timeout = 2 * time.Second
	}
	dctx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()
	d := &tls.Dialer{
		NetDialer: &net.Dialer{Timeout: timeout},
		Config: &tls.Config{
			ServerName: serverName,
			RootCAs:    c.Roots,
			MinVersion: tls.VersionTLS12,
			NextProtos: []string{"dot"},
		},
	}
	raw, err := d.DialContext(dctx, "tcp", addr)
	if err != nil {
		var cve *tls.CertificateVerificationError
		if errors.As(err, &cve) {
			ie := &IdentityError{ServerName: serverName, Err: cve.Err}
			if len(cve.UnverifiedCertificates) > 0 {
				ie.Peer = cve.UnverifiedCertificates[0]
			}
			return nil, ie
		}
		var hostErr x509.HostnameError
		var authErr x509.UnknownAuthorityError
		if errors.As(err, &hostErr) || errors.As(err, &authErr) {
			return nil, &IdentityError{ServerName: serverName, Err: err}
		}
		return nil, err
	}
	tc := raw.(*tls.Conn)
	cn := &Conn{conn: tc, timeout: timeout}
	if certs := tc.ConnectionState().PeerCertificates; len(certs) > 0 {
		cn.Peer = certs[0]
	}
	return cn, nil
}

// Query sends one query (DO bit set, EDNS0) and returns the response.
func (cn *Conn) Query(ctx context.Context, qname string, qtype uint16) (*dns.Msg, error) {
	m := new(dns.Msg)
	m.SetQuestion(dns.Fqdn(qname), qtype)
	m.SetEdns0(1232, true)
	m.AuthenticatedData = true
	deadline := time.Now().Add(cn.timeout)
	if d, ok := ctx.Deadline(); ok && d.Before(deadline) {
		deadline = d
	}
	_ = cn.conn.SetDeadline(deadline)
	dc := &dns.Conn{Conn: cn.conn}
	if err := dc.WriteMsg(m); err != nil {
		return nil, err
	}
	in, err := dc.ReadMsg()
	if err != nil {
		return nil, err
	}
	if in.Id != m.Id || !in.Response || in.Opcode != dns.OpcodeQuery {
		return nil, errors.New("not a response to our query")
	}
	if len(in.Question) != 1 || dns.CanonicalName(in.Question[0].Name) != dns.CanonicalName(qname) || in.Question[0].Qtype != qtype || in.Question[0].Qclass != dns.ClassINET {
		return nil, errors.New("response question does not match the query")
	}
	return in, nil
}

// Close closes the connection.
func (cn *Conn) Close() error { return cn.conn.Close() }

// CertSummary renders the identity-relevant parts of a certificate for reports.
func CertSummary(c *x509.Certificate) map[string]any {
	if c == nil {
		return nil
	}
	return map[string]any{
		"subject":   c.Subject.String(),
		"sans":      c.DNSNames,
		"issuer":    c.Issuer.String(),
		"not_after": c.NotAfter.UTC().Format(time.RFC3339),
	}
}
