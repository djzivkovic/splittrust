// Package validate obtains DNSSEC-validated answers for the client. The device
// performs "full DNSSEC validation locally" (RFC 9704 section 6.2) with unbound's
// validator: in-process through libunbound (build tag "libunbound") or, as a
// decided fallback, through a localhost unbound daemon speaking Extended DNS Errors.
package validate

import (
	"context"
	"encoding/base64"
	"fmt"
	"time"

	"github.com/miekg/dns"
)

// Security is the RFC 4035 section 4.3 validation state of a response, plus the
// two operational outcomes.
type Security string

const (
	Secure        Security = "secure"
	Insecure      Security = "insecure"
	Bogus         Security = "bogus"
	Indeterminate Security = "indeterminate"
	ErrorState    Security = "error"
)

// Evidence is what the verifier records about one validated lookup.
type Evidence struct {
	QName          string     `json:"qname"`
	QType          string     `json:"qtype"`
	Rcode          string     `json:"rcode"`
	Security       Security   `json:"security"`
	Why            string     `json:"why,omitempty"`
	TTL            uint32     `json:"ttl"`
	RRSIGExpiresAt *time.Time `json:"rrsig_expires_at,omitempty"`
	Answer         []string   `json:"answer,omitempty"`
	Resolution     string     `json:"resolution"`           // "via-network" or "iterative"
	Forwarder      string     `json:"forwarder,omitempty"` // "ip:port#adn" when via-network
	WireB64        string     `json:"wire_b64,omitempty"`
	ObservedAt     time.Time  `json:"observed_at"`

	// Records is the parsed answer section (not serialised).
	Records []dns.RR `json:"-"`
	// Raw is the answer message, when available (not serialised).
	Raw *dns.Msg `json:"-"`
}

// PublicResolver resolves and validates one name.
type PublicResolver interface {
	Resolve(ctx context.Context, qname string, qtype uint16) (Evidence, error)
	// Describe returns the resolution path for evidence ("via-network"/"iterative").
	Describe() (resolution, forwarder string)
}

// Forwarder is the network's announced encrypted resolver used as the
// validator's upstream (RFC 9704 Figure 4).
type Forwarder struct {
	Addr       string // ip:port
	ServerName string // ADN, authenticated with the CA bundle
}

// Config builds a validator. Forward == nil means iterative resolution from RootHintsFile.
type Config struct {
	AnchorFile    string
	RootHintsFile string
	CAFile        string
	Forward       *Forwarder
	DaemonAddr    string // fallback build only
	Timeout       time.Duration
}

func (c Config) describe() (string, string) {
	if c.Forward == nil {
		return "iterative", ""
	}
	return "via-network", c.Forward.Addr + "#" + c.Forward.ServerName
}

// EarliestRRSIGExpiry returns the earliest expiration among RRSIG records.
func EarliestRRSIGExpiry(rrs []dns.RR) *time.Time {
	var earliest *time.Time
	for _, rr := range rrs {
		sig, ok := rr.(*dns.RRSIG)
		if !ok {
			continue
		}
		t := time.Unix(int64(sig.Expiration), 0).UTC()
		if earliest == nil || t.Before(*earliest) {
			earliest = &t
		}
	}
	return earliest
}

func fillFromMsg(ev *Evidence, msg *dns.Msg) {
	if msg == nil {
		return
	}
	ev.Raw = msg
	ev.Rcode = dns.RcodeToString[msg.Rcode]
	all := append(append([]dns.RR{}, msg.Answer...), msg.Ns...)
	ev.RRSIGExpiresAt = EarliestRRSIGExpiry(all)
	for _, rr := range msg.Answer {
		if rr.Header().Rrtype != dns.TypeRRSIG {
			ev.Records = append(ev.Records, rr)
			ev.Answer = append(ev.Answer, rr.String())
			if ev.TTL == 0 || rr.Header().Ttl < ev.TTL {
				ev.TTL = rr.Header().Ttl
			}
		}
	}
	if packed, err := msg.Pack(); err == nil {
		ev.WireB64 = base64.StdEncoding.EncodeToString(packed)
	}
}

func typeName(t uint16) string {
	if s, ok := dns.TypeToString[t]; ok {
		return s
	}
	return fmt.Sprintf("TYPE%d", t)
}
