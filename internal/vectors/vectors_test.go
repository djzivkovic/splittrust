package vectors

import (
	"bytes"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"
)

// The committed vectors must be exactly what the engine generates.
func TestCommittedVectorsAreCurrent(t *testing.T) {
	files, err := Generate()
	if err != nil {
		t.Fatal(err)
	}
	for _, name := range FileNames(files) {
		got, err := os.ReadFile(filepath.Join("..", "..", "vectors", name))
		if err != nil {
			t.Fatalf("%s: %v (run `splittrust vectors --out vectors`)", name, err)
		}
		if !bytes.Equal(got, files[name]) {
			t.Errorf("vectors/%s is stale; regenerate with `splittrust vectors --out vectors`", name)
		}
	}
}

// The forensic explanation of the RFC 9704 section 5.1 example must hold exactly.
func TestForensics(t *testing.T) {
	f, err := ComputeForensics()
	if err != nil {
		t.Fatal(err)
	}
	if f.PrintedTokenChars != 63 || f.PrintedTokenOctets != 47 {
		t.Errorf("printed token: %d chars, %d octets", f.PrintedTokenChars, f.PrintedTokenOctets)
	}
	if f.CorrectTokenRFCSalt != "wA1lI3Tdnm2z3rbjAa6A998luwSDTU9LU45SoruhsTBtmcdL5BhalHS2v5UCSzal" {
		t.Errorf("printed-salt token = %s", f.CorrectTokenRFCSalt)
	}
	if f.CorrectTokenDraft07Salt[:40] != PrintedRFCToken[:40] {
		t.Errorf("draft-07 token does not share the 40-character prefix: %s", f.CorrectTokenDraft07Salt)
	}
	if !f.Reproduced || f.NulOffsetInDigest != 30 {
		t.Errorf("NUL-removal reproduction failed: offset %d reproduced %v (%s)", f.NulOffsetInDigest, f.Reproduced, f.NulStrippedToken)
	}
	if _, err := base64.RawURLEncoding.DecodeString(f.CorrectTokenDraft07Salt); err != nil {
		t.Error(err)
	}
}
