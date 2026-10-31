// Package pvd fetches and validates Provisioning Domain Additional Information
// (RFC 8801 section 4) and extracts the RFC 9704 "splitDnsClaims" array.
package pvd

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"github.com/djzivkovic/splittrust/internal/claim"
)

// MediaType is the registered media type for PvD Additional Information.
const MediaType = "application/pvd+json"

// Document is a parsed PvD Additional Information object.
type Document struct {
	Identifier string                     `json:"identifier"`
	Expires    time.Time                  `json:"expires"`
	Prefixes   []string                   `json:"prefixes"`
	Claims     []claim.RawClaim           `json:"splitDnsClaims"`
	Extra      map[string]json.RawMessage `json:"-"`
}

// Error is a PvD validation failure with a stable reason code.
type Error struct {
	Code   string // PVD_INVALID or PVD_EXPIRED
	Detail string
}

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

func invalid(format string, a ...any) error {
	return &Error{Code: "PVD_INVALID", Detail: fmt.Sprintf(format, a...)}
}

// Parse decodes a document and checks the RFC 8801 mandatory keys.
func Parse(b []byte) (Document, error) {
	var all map[string]json.RawMessage
	if err := json.Unmarshal(b, &all); err != nil {
		return Document{}, invalid("not a JSON object: %v", err)
	}
	var d Document
	var id string
	if raw, ok := all["identifier"]; !ok || json.Unmarshal(raw, &id) != nil || id == "" {
		return d, invalid(`missing or invalid "identifier"`)
	}
	d.Identifier = strings.ToLower(strings.TrimSuffix(id, "."))
	var exp string
	if raw, ok := all["expires"]; !ok || json.Unmarshal(raw, &exp) != nil {
		return d, invalid(`missing or invalid "expires"`)
	}
	t, err := time.Parse(time.RFC3339, exp)
	if err != nil {
		return d, invalid(`"expires" is not RFC 3339: %v`, err)
	}
	d.Expires = t.UTC()
	if raw, ok := all["prefixes"]; !ok || json.Unmarshal(raw, &d.Prefixes) != nil {
		return d, invalid(`missing or invalid "prefixes"`)
	}
	if raw, ok := all["splitDnsClaims"]; ok {
		if err := json.Unmarshal(raw, &d.Claims); err != nil {
			return d, invalid(`"splitDnsClaims" is not an array of claim objects: %v`, err)
		}
	}
	for k, v := range all {
		switch k {
		case "identifier", "expires", "prefixes", "splitDnsClaims":
		default:
			if d.Extra == nil {
				d.Extra = map[string]json.RawMessage{}
			}
			d.Extra[k] = v
		}
	}
	return d, nil
}

// Fetcher retrieves documents over HTTPS with the lab CA pool.
type Fetcher struct {
	Roots    *x509.CertPool
	Timeout  time.Duration
	MaxBytes int64
}

// Fetch GETs url, requires a certificate valid for expectedID (the PvD ID, per
// RFC 8801 section 4.1), refuses redirects, caps the body, and validates the
// document including its expiry at time now.
func (f *Fetcher) Fetch(ctx context.Context, url, expectedID string, now time.Time) (Document, error) {
	timeout := f.Timeout
	if timeout == 0 {
		timeout = 3 * time.Second
	}
	maxBytes := f.MaxBytes
	if maxBytes == 0 {
		maxBytes = 64 << 10
	}
	client := &http.Client{
		Timeout: timeout,
		Transport: &http.Transport{
			TLSClientConfig:   &tls.Config{RootCAs: f.Roots, ServerName: expectedID, MinVersion: tls.VersionTLS12},
			DisableKeepAlives: true,
		},
		CheckRedirect: func(*http.Request, []*http.Request) error {
			return errors.New("redirects are not followed for PvD documents")
		},
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Document{}, invalid("bad URL: %v", err)
	}
	req.Header.Set("Accept", MediaType)
	resp, err := client.Do(req)
	if err != nil {
		return Document{}, invalid("fetch %s: %v", url, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Document{}, invalid("fetch %s: HTTP %d", url, resp.StatusCode)
	}
	if mt, _, _ := mime.ParseMediaType(resp.Header.Get("Content-Type")); mt != MediaType {
		return Document{}, invalid("Content-Type %q is not %s (RFC 8801 section 4.1)", resp.Header.Get("Content-Type"), MediaType)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxBytes+1))
	if err != nil {
		return Document{}, invalid("read body: %v", err)
	}
	if int64(len(body)) > maxBytes {
		return Document{}, invalid("document larger than %d bytes", maxBytes)
	}
	return Validate(body, expectedID, now)
}

// Validate parses a document and applies the identity and expiry checks.
func Validate(body []byte, expectedID string, now time.Time) (Document, error) {
	d, err := Parse(body)
	if err != nil {
		return d, err
	}
	if d.Identifier != strings.ToLower(strings.TrimSuffix(expectedID, ".")) {
		return d, invalid(`"identifier" %q does not match the PvD ID %q`, d.Identifier, expectedID)
	}
	if !d.Expires.After(now) {
		return d, &Error{Code: "PVD_EXPIRED", Detail: fmt.Sprintf("document expired at %s", d.Expires.Format(time.RFC3339))}
	}
	return d, nil
}
