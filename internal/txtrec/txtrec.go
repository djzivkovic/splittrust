// Package txtrec encodes and decodes RFC 9704 Verification Records: TXT RRs whose
// RDATA is a comma-separated list of key=value pairs such as
// "token=<base64url>,ds=<base64url>". Character-strings are concatenated within
// one RR only; different RRs of the RRset are parsed independently.
package txtrec

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

// Record is one parsed Verification Record RR.
type Record struct {
	Token   string            // base64url, unpadded, 48 (SHA-384) or 64 (SHA-512) decoded octets
	DS      []string          // zero or more base64url DS RDATA values, in RR order
	Unknown map[string]string // keys this implementation does not know; ignored per RFC 9704 section 6
}

// ParseRR parses the character-strings of a single TXT RR.
func ParseRR(charStrings []string) (Record, error) {
	rec := Record{Unknown: map[string]string{}}
	joined := strings.Join(charStrings, "")
	seenToken := false
	for _, pair := range strings.Split(joined, ",") {
		pair = strings.TrimSpace(pair)
		if pair == "" {
			continue
		}
		k, v, ok := strings.Cut(pair, "=")
		if !ok {
			return Record{}, fmt.Errorf("malformed pair %q: no '='", pair)
		}
		k = strings.ToLower(strings.TrimSpace(k))
		v = strings.TrimSpace(v)
		switch k {
		case "token":
			if seenToken {
				return Record{}, errors.New("duplicate token key in one RR")
			}
			seenToken = true
			n, err := decodedLen(v)
			if err != nil {
				return Record{}, fmt.Errorf("token is not base64url: %v", err)
			}
			if n != 48 && n != 64 {
				return Record{}, fmt.Errorf("token decodes to %d octets; SHA-384 gives 48 and SHA-512 gives 64", n)
			}
			rec.Token = v
		case "ds":
			if _, err := decodedLen(v); err != nil {
				return Record{}, fmt.Errorf("ds is not base64url: %v", err)
			}
			rec.DS = append(rec.DS, v)
		default:
			rec.Unknown[k] = v
		}
	}
	if !seenToken {
		return Record{}, errors.New("no token key in RR")
	}
	return rec, nil
}

// Format renders a Verification Record RDATA string.
func Format(token string, ds []string) string {
	var b strings.Builder
	b.WriteString("token=")
	b.WriteString(token)
	for _, d := range ds {
		b.WriteString(",ds=")
		b.WriteString(d)
	}
	return b.String()
}

func decodedLen(s string) (int, error) {
	b, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(s, "="))
	if err != nil {
		return 0, err
	}
	return len(b), nil
}
