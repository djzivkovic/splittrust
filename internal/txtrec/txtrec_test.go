package txtrec

import (
	"strings"
	"testing"
)

const tok48 = "PJv5v0eMID1V22B3Cp2bw1ge0yxBGVMtNaMatP_7HBuNyQn4Xu8WlsnYOI9v7z2E" // 64 chars = 48 octets

func TestParseRRFragmentsWithinRecord(t *testing.T) {
	// One TXT RR split into two character-strings: they are concatenated within the RR.
	rec, err := ParseRR([]string{"token=" + tok48 + ",ds=AAEN", ",future=ignored,ds=AAIN"})
	if err != nil {
		t.Fatal(err)
	}
	if rec.Token != tok48 {
		t.Errorf("token = %q", rec.Token)
	}
	if strings.Join(rec.DS, " ") != "AAEN AAIN" {
		t.Errorf("ds = %v", rec.DS)
	}
	if rec.Unknown["future"] != "ignored" {
		t.Errorf("unknown keys not preserved: %v", rec.Unknown)
	}
}

func TestParseRRDuplicateToken(t *testing.T) {
	if _, err := ParseRR([]string{"token=" + tok48 + ",token=" + tok48}); err == nil {
		t.Fatal("duplicate token accepted")
	}
}

func TestParseRRBadLength(t *testing.T) {
	// 63 characters decode to 47 octets: neither SHA-384 (48) nor SHA-512 (64).
	if _, err := ParseRR([]string{"token=" + tok48[:63]}); err == nil {
		t.Fatal("47-octet token accepted")
	}
	if _, err := ParseRR([]string{"ds=AAEN"}); err == nil {
		t.Fatal("record without token accepted")
	}
	if _, err := ParseRR([]string{"token"}); err == nil {
		t.Fatal("pair without '=' accepted")
	}
}

func TestFormat(t *testing.T) {
	if got := Format(tok48, []string{"AAEN", "AAIN"}); got != "token="+tok48+",ds=AAEN,ds=AAIN" {
		t.Errorf("Format = %q", got)
	}
	if got := Format(tok48, nil); got != "token="+tok48 {
		t.Errorf("Format token-only = %q", got)
	}
}
