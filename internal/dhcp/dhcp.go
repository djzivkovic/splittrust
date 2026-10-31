// Package dhcp encodes and decodes the RFC 9704 section 5.2.1 authorization claim
// carried in a DHCP Authentication option (DHCPv4 option 90, RFC 3118; DHCPv6
// option 11, RFC 8415 section 21.11) with Protocol 4 "Split-horizon DNS".
//
// Only the option payload is handled; no sockets. Note that RFC 8415 section 20.2
// forbids more than one Authentication option per message and RFC 3396 makes a
// DHCPv4 client concatenate repeated option-90 instances, so a DHCP message can
// convey exactly one claim.
package dhcp

import (
	"encoding/binary"
	"errors"
	"fmt"
	"strings"

	"github.com/djzivkovic/splittrust/internal/claim"
)

// Protocol is the IANA "Protocol Name Space" value registered by RFC 9704.
const Protocol = 4

// MaxV4Option is the maximum DHCPv4 option data length before RFC 3396 splitting.
const MaxV4Option = 255

const headerLen = 1 + 1 + 1 + 8 // protocol, algorithm, RDM, replay detection

// Decoded is a claim recovered from an option payload.
type Decoded struct {
	Algorithm uint8
	Replay    uint64
	ADN       string // canonical FQDN
	Parent    string // canonical FQDN
	Salt      []byte
	Relative  []string // claimed names relative to Parent, as carried in $X
}

// EncodeV4 builds the data of a DHCPv4 Authentication option (code 90): the
// RFC 3118 header (Protocol 4, Algorithm = ZONEMD value, RDM 0, 64-bit replay
// detection) followed by ADN, parent, salt length, salt and $X.
//
// RFC 9704 fixes RDM to 0 but says nothing about the replay detection value;
// RFC 3118/8415 require a strictly increasing counter for RDM 0, so callers
// should pass a timestamp-like counter.
func EncodeV4(c claim.Canonical, replay uint64) ([]byte, error) {
	alg, err := claim.AlgorithmValue(c.Algorithm)
	if err != nil {
		return nil, err
	}
	out := []byte{Protocol, alg, 0}
	out = binary.BigEndian.AppendUint64(out, replay)
	out = append(out, wireFQDN(c.Resolver)...)
	out = append(out, wireFQDN(c.Parent)...)
	out = append(out, byte(len(c.Salt)))
	out = append(out, c.Salt...)
	out = append(out, claim.PseudoWire(c)...)
	return out, nil
}

// EncodeV6 builds the option-data of a DHCPv6 Authentication option (code 11).
// The body is identical to DHCPv4; only the option code/length framing differs,
// and DHCPv6 options are not limited to 255 octets.
func EncodeV6(c claim.Canonical, replay uint64) ([]byte, error) {
	return EncodeV4(c, replay)
}

// SplitV4 splits option data into RFC 3396 chunks of at most 255 octets.
func SplitV4(payload []byte) [][]byte {
	var chunks [][]byte
	for len(payload) > MaxV4Option {
		chunks = append(chunks, payload[:MaxV4Option])
		payload = payload[MaxV4Option:]
	}
	return append(chunks, payload)
}

// Decode parses an option payload (after RFC 3396 reassembly for DHCPv4).
func Decode(payload []byte) (Decoded, error) {
	var d Decoded
	if len(payload) < headerLen {
		return d, errors.New("payload shorter than the authentication header")
	}
	if payload[0] != Protocol {
		return d, fmt.Errorf("protocol %d is not Split-horizon DNS (4)", payload[0])
	}
	if _, err := claim.AlgorithmMnemonic(payload[1]); err != nil {
		return d, err
	}
	if payload[2] != 0 {
		return d, fmt.Errorf("RDM %d; RFC 9704 requires 0", payload[2])
	}
	d.Algorithm = payload[1]
	d.Replay = binary.BigEndian.Uint64(payload[3:11])
	rest := payload[headerLen:]

	var err error
	d.ADN, rest, err = readName(rest)
	if err != nil {
		return d, fmt.Errorf("ADN: %v", err)
	}
	d.Parent, rest, err = readName(rest)
	if err != nil {
		return d, fmt.Errorf("parent: %v", err)
	}
	if len(rest) < 1 {
		return d, errors.New("missing salt length")
	}
	n := int(rest[0])
	rest = rest[1:]
	if len(rest) < n {
		return d, errors.New("salt truncated")
	}
	d.Salt = append([]byte(nil), rest[:n]...)
	rest = rest[n:]
	if len(rest) == 0 {
		return d, errors.New("empty $X")
	}
	for len(rest) > 0 {
		var name string
		name, rest, err = readName(rest)
		if err != nil {
			return d, fmt.Errorf("$X: %v", err)
		}
		d.Relative = append(d.Relative, strings.TrimSuffix(name, "."))
	}
	return d, nil
}

func wireFQDN(fqdn string) []byte {
	labels, _ := claim.Labels(fqdn)
	return append(claim.WireLabels(labels), 0)
}

// readName reads one zero-terminated, uncompressed wire-format name.
func readName(b []byte) (string, []byte, error) {
	var labels []string
	for {
		if len(b) == 0 {
			return "", nil, errors.New("name truncated")
		}
		n := int(b[0])
		b = b[1:]
		if n == 0 {
			break
		}
		if n > 63 {
			return "", nil, fmt.Errorf("label length %d (compression pointers are not allowed)", n)
		}
		if len(b) < n {
			return "", nil, errors.New("label truncated")
		}
		labels = append(labels, string(b[:n]))
		b = b[n:]
	}
	if len(labels) == 0 {
		return ".", b, nil
	}
	return strings.Join(labels, ".") + ".", b, nil
}
