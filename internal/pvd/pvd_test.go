package pvd

import (
	"errors"
	"testing"
	"time"
)

const doc = `{"identifier":"pvd.corp.lab","expires":"2026-11-02T00:00:00Z","prefixes":["2001:db8:97::/48"],
 "splitDnsClaims":[{"resolver":"dns.corp.lab","parent":"corp.lab","subdomains":["internal"],"algorithm":"SHA384","salt":"AAAA","future":1}],
 "dnsZones":["corp.lab"]}`

func TestValidateDocument(t *testing.T) {
	now := time.Date(2026, 10, 31, 12, 0, 0, 0, time.UTC)
	d, err := Validate([]byte(doc), "pvd.corp.lab", now)
	if err != nil {
		t.Fatal(err)
	}
	if len(d.Claims) != 1 || d.Claims[0].Resolver != "dns.corp.lab" || d.Claims[0].Extra["future"] == nil {
		t.Errorf("claims = %+v", d.Claims)
	}
	if _, ok := d.Extra["dnsZones"]; !ok {
		t.Error("unknown top-level key not preserved")
	}
	var pe *Error
	if _, err := Validate([]byte(doc), "pvd.hotel.lab", now); !errors.As(err, &pe) || pe.Code != "PVD_INVALID" {
		t.Errorf("identifier mismatch: %v", err)
	}
	if _, err := Validate([]byte(doc), "pvd.corp.lab", now.Add(72*time.Hour)); !errors.As(err, &pe) || pe.Code != "PVD_EXPIRED" {
		t.Errorf("expired: %v", err)
	}
	if _, err := Parse([]byte(`{"identifier":"x","expires":"2026-11-02T00:00:00Z"}`)); !errors.As(err, &pe) || pe.Code != "PVD_INVALID" {
		t.Errorf("missing prefixes: %v", err)
	}
}
