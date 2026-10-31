package dhcp

import (
	"bytes"
	"encoding/base64"
	"encoding/hex"
	"strings"
	"testing"

	"github.com/djzivkovic/splittrust/internal/claim"
)

func firmaClaim(t *testing.T) claim.Canonical {
	t.Helper()
	salt, _ := hex.DecodeString("567de4436afd6d7cf4a4b9b862df301c")
	c, err := claim.Canonicalize(claim.RawClaim{
		Resolver: "dns.firma.rs", Parent: "firma.rs", Subdomains: []string{"intranet", "mail"},
		Algorithm: "SHA384", Salt: base64.RawURLEncoding.EncodeToString(salt),
	})
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestRoundTrip(t *testing.T) {
	c := firmaClaim(t)
	payload, err := EncodeV4(c, 0x0102030405060708)
	if err != nil {
		t.Fatal(err)
	}
	// RFC 3118 header: protocol 4 (Split-horizon DNS), algorithm 1 (SHA384), RDM 0, 64-bit replay.
	wantHead, _ := hex.DecodeString("04010" + "0" + "0102030405060708")
	if !bytes.HasPrefix(payload, wantHead) {
		t.Fatalf("header = %x", payload[:11])
	}
	// Body: ADN wire, parent wire, len(salt), salt, X.
	wantBody := "03646e73056669726d61027273" + "00" + "056669726d61027273" + "00" + "10" + "567de4436afd6d7cf4a4b9b862df301c" + "08696e7472616e657400046d61696c00"
	if got := hex.EncodeToString(payload[11:]); got != wantBody {
		t.Fatalf("body =\n%s\nwant\n%s", got, wantBody)
	}
	d, err := Decode(payload)
	if err != nil {
		t.Fatal(err)
	}
	if d.ADN != "dns.firma.rs." || d.Parent != "firma.rs." || d.Algorithm != 1 || d.Replay != 0x0102030405060708 {
		t.Errorf("decoded %+v", d)
	}
	if strings.Join(d.Relative, ",") != "intranet,mail" || !bytes.Equal(d.Salt, c.Salt) {
		t.Errorf("decoded names %v salt %x", d.Relative, d.Salt)
	}
	v6, _ := EncodeV6(c, 0x0102030405060708)
	if !bytes.Equal(v6, payload) {
		t.Errorf("DHCPv6 option 11 body must equal the DHCPv4 option 90 body")
	}
}

func TestSplitV4(t *testing.T) {
	payload := make([]byte, 300)
	chunks := SplitV4(payload)
	if len(chunks) != 2 || len(chunks[0]) != 255 || len(chunks[1]) != 45 {
		t.Fatalf("chunks %d: %v", len(chunks), lens(chunks))
	}
	if len(SplitV4(payload[:255])) != 1 {
		t.Error("255 octets must not be split")
	}
}

func TestDecodeRejectsTruncated(t *testing.T) {
	c := firmaClaim(t)
	payload, _ := EncodeV4(c, 1)
	for _, n := range []int{5, 11, 20, len(payload) - 1} {
		if _, err := Decode(payload[:n]); err == nil {
			t.Errorf("truncated payload of %d octets accepted", n)
		}
	}
	bad := append([]byte(nil), payload...)
	bad[0] = 1 // wrong protocol
	if _, err := Decode(bad); err == nil {
		t.Error("protocol 1 accepted as split-horizon claim")
	}
}

func lens(b [][]byte) []int {
	var out []int
	for _, x := range b {
		out = append(out, len(x))
	}
	return out
}
