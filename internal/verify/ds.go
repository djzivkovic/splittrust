package verify

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"strings"
	"time"

	"github.com/miekg/dns"
)

// Error is a local-validation failure with a stable reason code.
type Error struct {
	Code   string // LOCAL_SIGNATURE_INVALID | LOCAL_RESPONSE_UNSUPPORTED
	Detail string
}

func (e *Error) Error() string { return e.Code + ": " + e.Detail }

// MatchDS implements RFC 9704 section 7: each base64url "ds" value is the RDATA
// of a DS record for a DNSKEY whose owner name is "resolver.arpa.". A key is
// approved when the full DS RDATA (key tag, algorithm, digest type, digest)
// recomputed over owner "resolver.arpa." equals a published value; a key-tag
// match alone is not enough.
func MatchDS(dsB64 []string, keys []*dns.DNSKEY) []*dns.DNSKEY {
	var approved []*dns.DNSKEY
	for _, k := range keys {
		kk := *k
		kk.Hdr.Name = "resolver.arpa."
		for _, v := range dsB64 {
			rdata, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(v, "="))
			if err != nil || len(rdata) < 5 {
				continue
			}
			ds := kk.ToDS(rdata[3])
			if ds == nil {
				continue
			}
			want := binary.BigEndian.AppendUint16(nil, ds.KeyTag)
			want = append(want, ds.Algorithm, ds.DigestType)
			digest, _ := hex.DecodeString(ds.Digest)
			want = append(want, digest...)
			if string(want) == string(rdata) {
				approved = append(approved, k)
				break
			}
		}
	}
	return approved
}

// ValidateLocalA is ValidateLocal for A records, returning the addresses.
func ValidateLocalA(approved []*dns.DNSKEY, dnskeyMsg, aMsg *dns.Msg, now time.Time) ([]string, error) {
	qname := ""
	for _, rr := range aMsg.Answer {
		if rr.Header().Rrtype == dns.TypeA {
			qname = rr.Header().Name
		}
	}
	rrs, err := ValidateLocal(approved, dnskeyMsg, aMsg, qname, dns.TypeA, now)
	if err != nil {
		return nil, err
	}
	var out []string
	for _, rr := range rrs {
		out = append(out, rr.(*dns.A).A.String())
	}
	return out, nil
}

// ValidateLocal validates a split-view answer with only the approved keys: the
// child's DNSKEY RRset must carry an RRSIG made by an approved key, then the
// RRset of the queried type at qname must verify under that DNSKEY set. A key
// set that merely contains an approved key but is signed by an unrelated key
// fails. Only direct records at the queried name are supported; anything else
// (CNAME chains, denial proofs) is LOCAL_RESPONSE_UNSUPPORTED.
func ValidateLocal(approved []*dns.DNSKEY, dnskeyMsg, answer *dns.Msg, qname string, qtype uint16, now time.Time) ([]dns.RR, error) {
	if dnskeyMsg == nil || answer == nil {
		return nil, &Error{Code: "LOCAL_RESPONSE_UNSUPPORTED", Detail: "missing DNSKEY or data response"}
	}
	keys, keySigs := split[*dns.DNSKEY](dnskeyMsg.Answer, dns.TypeDNSKEY)
	if len(keys) == 0 {
		return nil, &Error{Code: "LOCAL_RESPONSE_UNSUPPORTED", Detail: "no DNSKEY RRset in the local resolver's answer"}
	}
	keyset := make([]dns.RR, len(keys))
	for i, k := range keys {
		keyset[i] = k
	}
	trusted := false
	for _, sig := range keySigs {
		for _, ak := range approved {
			if sig.KeyTag != ak.KeyTag() || sig.Algorithm != ak.Algorithm {
				continue
			}
			k := *ak
			k.Hdr.Name = keys[0].Hdr.Name
			if sig.ValidityPeriod(now) && sig.Verify(&k, keyset) == nil {
				trusted = true
			}
		}
	}
	if !trusted {
		return nil, &Error{Code: "LOCAL_SIGNATURE_INVALID", Detail: "the DNSKEY RRset is not signed by any key approved through the Verification Record's ds values"}
	}

	q := dns.CanonicalName(qname)
	var set []dns.RR
	var sigs []*dns.RRSIG
	for _, rr := range answer.Answer {
		if dns.CanonicalName(rr.Header().Name) != q {
			continue
		}
		if sig, ok := rr.(*dns.RRSIG); ok {
			if sig.TypeCovered == qtype {
				sigs = append(sigs, sig)
			}
			continue
		}
		if rr.Header().Rrtype == qtype {
			set = append(set, rr)
		}
	}
	if len(set) == 0 {
		return nil, &Error{Code: "LOCAL_RESPONSE_UNSUPPORTED", Detail: fmt.Sprintf("no direct %s records for %s in the answer (CNAME chains and denial proofs are not supported in this profile)", dns.TypeToString[qtype], q)}
	}
	for _, sig := range sigs {
		for _, k := range keys {
			if sig.KeyTag == k.KeyTag() && sig.Algorithm == k.Algorithm && sig.ValidityPeriod(now) && sig.Verify(k, set) == nil {
				return set, nil
			}
		}
	}
	return nil, &Error{Code: "LOCAL_SIGNATURE_INVALID", Detail: fmt.Sprintf("no valid RRSIG over the %s RRset for %s under the approved key set", dns.TypeToString[qtype], q)}
}

func split[T dns.RR](rrs []dns.RR, typ uint16) ([]T, []*dns.RRSIG) {
	var data []T
	var sigs []*dns.RRSIG
	for _, rr := range rrs {
		switch v := rr.(type) {
		case *dns.RRSIG:
			if v.TypeCovered == typ {
				sigs = append(sigs, v)
			}
		default:
			if rr.Header().Rrtype == typ {
				if t, ok := rr.(T); ok {
					data = append(data, t)
				}
			}
		}
	}
	return data, sigs
}
