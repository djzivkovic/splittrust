// Package labgen generates the per-run laboratory artefacts that need the
// engine: salts and claims, Verification Record TXT lines, PvD documents, the
// locally signed split-view zones (RFC 9704 section 7), the hotel's forged view
// and the client manifest. The DNSSEC hierarchy of the public lab DNS is signed
// by BIND tools in lab/bootstrap/bootstrap.sh, which consumes this output.
package labgen

import (
	"crypto"
	"crypto/ecdsa"
	"crypto/rand"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/miekg/dns"

	"github.com/djzivkovic/splittrust/internal/claim"
	"github.com/djzivkovic/splittrust/internal/lab"
	"github.com/djzivkovic/splittrust/internal/txtrec"
)

// Final locations inside the containers (named volume mounted at /gen).
const (
	ClientDir  = "/gen/client"
	CAFile     = ClientDir + "/ca.pem"
	CARealFile = ClientDir + "/ca-real.pem" // lab CA + the system bundle, for profiles that also talk to the real Internet
	AnchorFile = ClientDir + "/trust-anchor.key"
	IANAAnchor = "/usr/share/dns/root.key" // Debian dns-root-data: the real root trust anchor
	RootHints  = ClientDir + "/root.hints"
	TTL        = 60
)

type generated struct {
	raw   claim.RawClaim
	canon claim.Canonical
	token string
}

// Generate writes the work tree under outDir.
func Generate(outDir string, now time.Time) error {
	cat, err := lab.LoadCatalogue()
	if err != nil {
		return err
	}
	for _, d := range []string{"claims", "pvd", "txt", "local-dot", "hotel-dot", "client/claims"} {
		if err := os.MkdirAll(filepath.Join(outDir, d), 0o755); err != nil {
			return err
		}
	}

	// One local key pair models the resolver software of the lab's networks.
	ksk, kpriv, err := newKey("resolver.arpa.", 257)
	if err != nil {
		return err
	}
	zsk, zpriv, err := newKey("resolver.arpa.", 256)
	if err != nil {
		return err
	}
	wrongKSK, _, err := newKey("resolver.arpa.", 257)
	if err != nil {
		return err
	}
	localDS := dsB64(ksk)
	wrongDS := dsB64(wrongKSK)

	gens := map[string][]generated{}  // scenario id -> claims
	txtLines := map[string][]string{} // parent zone -> TXT RR lines (relative owner)
	localZones := map[string]bool{}
	summary := &strings.Builder{}
	fmt.Fprintf(summary, "SplitTrust lab generated %s\nlocal KSK tag %d  DS(resolver.arpa.) %s\nwrong DS %s\n\n", now.Format(time.RFC3339), ksk.KeyTag(), localDS, wrongDS)

	manifest := lab.Manifest{SchemaVersion: 1, GeneratedAt: now.UTC().Format(time.RFC3339), TrustContext: "lab", Profiles: map[string]lab.Profile{}}

	for _, sc := range cat.Scenarios {
		var claims []generated
		for _, spec := range sc.Claims {
			var g generated
			if spec.CopyOf != "" {
				src := gens[spec.CopyOf]
				if len(src) == 0 {
					return fmt.Errorf("scenario %s copies %s which has not been generated yet", sc.ID, spec.CopyOf)
				}
				g = src[0]
			} else {
				saltB64 := spec.Salt
				if saltB64 == "" {
					salt := make([]byte, 16)
					rand.Read(salt)
					saltB64 = base64.RawURLEncoding.EncodeToString(salt)
				}
				g.raw = claim.RawClaim{Resolver: spec.Resolver, Parent: sc.Parent, Subdomains: spec.Subdomains, Algorithm: "SHA384", Salt: saltB64}
				g.canon, err = claim.Canonicalize(g.raw)
				if err != nil {
					return fmt.Errorf("scenario %s: %v", sc.ID, err)
				}
				g.raw.Subdomains = g.canon.Relative // PvD form: relative, canonical order
				g.token, _, _ = claim.Token(g.canon)

				if !g.canon.SpecialUse && sc.TrustContext != "global" {
					recordToken := g.token
					if spec.RecordSalt == "other" {
						other := g.canon
						other.Salt = make([]byte, 16)
						rand.Read(other.Salt)
						recordToken, _, _ = claim.Token(other)
					}
					var ds []string
					switch spec.DS {
					case "local":
						ds = []string{localDS}
					case "wrong":
						ds = []string{wrongDS}
					}
					if sc.ID != "hotel" && sc.ID != "hotel-forged" && sc.ID != "hotel-blocks-external" {
						owner := strings.TrimSuffix(claim.RecordOwner(g.canon.Resolver, g.canon.Parent), "."+g.canon.Parent)
						txtLines[g.canon.Parent] = append(txtLines[g.canon.Parent], fmt.Sprintf("%s %d IN TXT \"%s\"", owner, TTL, txtrec.Format(recordToken, ds)))
					}
					// Split-view child zones served by the local resolver.
					if !g.canon.WholeZone {
						for _, scope := range g.canon.Scopes {
							if !localZones[scope] {
								localZones[scope] = true
								rrs, err := childZone(scope, g.canon.Resolver, cat.Addresses["internal_host"], ksk, zsk, kpriv, zpriv, now)
								if err != nil {
									return err
								}
								if err := writeZone(filepath.Join(outDir, "local-dot", strings.TrimSuffix(scope, ".")+".zone"), rrs); err != nil {
									return err
								}
							}
						}
					}
				}
			}
			claims = append(claims, g)
			fmt.Fprintf(summary, "%-22s %-18s token %s\n", sc.ID, g.raw.Resolver, g.token)
		}
		gens[sc.ID] = claims

		// Claim files (always) and PvD document (pvd scenarios).
		var raws []claim.RawClaim
		for _, g := range claims {
			raws = append(raws, g.raw)
		}
		if err := writeJSON(filepath.Join(outDir, "client/claims", sc.ID+".json"), raws); err != nil {
			return err
		}
		if err := writeJSON(filepath.Join(outDir, "claims", sc.ID+".json"), raws); err != nil {
			return err
		}
		source := sc.ClaimSource
		if source == "" {
			source = "pvd"
		}
		p := lab.Profile{
			ScenarioID: sc.ID, Title: sc.Title, Explanation: sc.Explanation, Discovery: sc.Discovery,
			NetworkResolvers: sc.NetworkResolvers, PvDID: sc.PvDID, ClaimSource: source,
			External:      lab.Announced{ADN: "quad9.lab", Addr: cat.Addresses["external"] + ":853"},
			DefaultDevice: sc.DefaultDevice, CAFile: CAFile, AnchorFile: AnchorFile, RootHints: RootHints,
			PermittedNamespaces: []string{"lab.", "arpa."}, ExampleQName: sc.ExampleQName, Expected: sc.Expected,
			TrustContext: "lab", DefaultResolution: sc.DefaultResolution,
		}
		if sc.ExternalAddr != "" {
			p.External.Addr = sc.ExternalAddr
		}
		if sc.External != nil {
			p.External = *sc.External
		}
		if sc.TrustContext == "global" {
			// Validated under the real root: IANA anchor, built-in root hints, the lab CA
			// plus the system bundle (the announced resolver is still the lab's), and the
			// real parent zone is a permitted namespace. Needs Internet egress.
			p.TrustContext, p.RequiresInternet = "global", true
			p.AnchorFile, p.RootHints, p.CAFile = IANAAnchor, "", CARealFile
			p.PermittedNamespaces = append(p.PermittedNamespaces, strings.TrimSuffix(sc.Parent, ".")+".")
		}
		if source == "pvd" {
			p.PvDURL = "https://" + sc.PvDID + "/.well-known/pvd"
			doc := map[string]any{
				"identifier":     sc.PvDID,
				"expires":        now.Add(36 * time.Hour).UTC().Format(time.RFC3339),
				"prefixes":       []string{"2001:db8:97::/48"},
				"splitDnsClaims": raws,
			}
			if err := writeJSON(filepath.Join(outDir, "pvd", sc.PvDID+".json"), doc); err != nil {
				return err
			}
		} else {
			p.ClaimFile = filepath.Join(ClientDir, "claims", sc.ID+".json")
		}
		manifest.Profiles[sc.ID] = p
		manifest.Order = append(manifest.Order, sc.ID)
	}

	// TXT lines per parent zone, for bootstrap.sh to splice into the zone templates.
	for zone, lines := range txtLines {
		sort.Strings(lines)
		if err := os.WriteFile(filepath.Join(outDir, "txt", strings.TrimSuffix(zone, ".")+".txt"), []byte(strings.Join(lines, "\n")+"\n"), 0o644); err != nil {
			return err
		}
	}

	// resolver.arpa.: the local resolver's DNSKEY anchor (RFC 9704 section 7).
	arpa := []dns.RR{
		soa("resolver.arpa.", "resolver.arpa."),
		&dns.NS{Hdr: hdr("resolver.arpa.", dns.TypeNS), Ns: "resolver.arpa."},
		ksk,
	}
	if err := writeZone(filepath.Join(outDir, "local-dot", "resolver.arpa.zone"), arpa); err != nil {
		return err
	}

	// Hotel views: honest (hosts override) and forging (fake banka.lab with the correct token).
	hotelToken := gens["hotel"][0].token
	hijack := cat.Addresses["hijack_target"]
	if err := os.WriteFile(filepath.Join(outDir, "hotel-dot", "hosts"), []byte(hijack+" www.banka.lab\n"), 0o644); err != nil {
		return err
	}
	fake := []dns.RR{
		soa("banka.lab.", "dns.hotel.lab."),
		&dns.NS{Hdr: hdr("banka.lab.", dns.TypeNS), Ns: "dns.hotel.lab."},
		&dns.A{Hdr: hdr("www.banka.lab.", dns.TypeA), A: parseIP(hijack)},
		&dns.TXT{Hdr: hdr("dns.hotel.lab._splitdns-challenge.banka.lab.", dns.TypeTXT), Txt: []string{txtrec.Format(hotelToken, nil)}},
	}
	if err := writeZone(filepath.Join(outDir, "hotel-dot", "banka.lab.fake"), fake); err != nil {
		return err
	}

	if err := writeJSON(filepath.Join(outDir, "client", "manifest.json"), manifest); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(outDir, "summary.txt"), []byte(summary.String()), 0o644)
}

func newKey(owner string, flags uint16) (*dns.DNSKEY, crypto.Signer, error) {
	k := &dns.DNSKEY{Hdr: hdr(owner, dns.TypeDNSKEY), Flags: flags, Protocol: 3, Algorithm: dns.ECDSAP256SHA256}
	k.Hdr.Ttl = 3600
	priv, err := k.Generate(256)
	if err != nil {
		return nil, nil, err
	}
	signer, ok := priv.(*ecdsa.PrivateKey)
	if !ok {
		return nil, nil, fmt.Errorf("unexpected key type %T", priv)
	}
	return k, signer, nil
}

// dsB64 is the base64url RDATA of the DS record for a DNSKEY, computed over the
// key's own owner name (resolver.arpa. for the RFC 9704 section 7 anchor).
func dsB64(k *dns.DNSKEY) string {
	ds := k.ToDS(dns.SHA256)
	rdata := binary.BigEndian.AppendUint16(nil, ds.KeyTag)
	rdata = append(rdata, ds.Algorithm, ds.DigestType)
	digest, _ := hex.DecodeString(ds.Digest)
	rdata = append(rdata, digest...)
	return base64.RawURLEncoding.EncodeToString(rdata)
}

func hdr(name string, t uint16) dns.RR_Header {
	return dns.RR_Header{Name: name, Rrtype: t, Class: dns.ClassINET, Ttl: TTL}
}

func soa(origin, ns string) *dns.SOA {
	return &dns.SOA{Hdr: hdr(origin, dns.TypeSOA), Ns: ns, Mbox: "hostmaster." + origin, Serial: uint32(time.Now().Unix()), Refresh: 3600, Retry: 600, Expire: 86400, Minttl: TTL}
}

// childZone builds and signs a split-view zone: the local KSK duplicated at the
// apex signs the DNSKEY RRset, the ZSK signs everything else (RFC 9704 Figure 1).
func childZone(origin, resolver, hostIP string, ksk, zsk *dns.DNSKEY, kpriv, zpriv crypto.Signer, now time.Time) ([]dns.RR, error) {
	apexKSK := *ksk
	apexKSK.Hdr.Name = origin
	apexZSK := *zsk
	apexZSK.Hdr.Name = origin
	rrs := []dns.RR{
		soa(origin, resolver),
		&dns.NS{Hdr: hdr(origin, dns.TypeNS), Ns: resolver},
		&apexKSK, &apexZSK,
		&dns.A{Hdr: hdr("host."+origin, dns.TypeA), A: parseIP(hostIP)},
	}
	incep, exp := now.Add(-5*time.Minute), now.Add(48*time.Hour)
	var out []dns.RR
	for _, set := range rrsets(rrs) {
		out = append(out, set...)
		signer, key := zpriv, &apexZSK
		if set[0].Header().Rrtype == dns.TypeDNSKEY {
			signer, key = kpriv, &apexKSK
		}
		sig, err := sign(set, key, signer, origin, incep, exp)
		if err != nil {
			return nil, err
		}
		out = append(out, sig)
	}
	return out, nil
}

func sign(set []dns.RR, key *dns.DNSKEY, signer crypto.Signer, origin string, incep, exp time.Time) (*dns.RRSIG, error) {
	h := set[0].Header()
	sig := &dns.RRSIG{
		Hdr:         dns.RR_Header{Name: h.Name, Rrtype: dns.TypeRRSIG, Class: dns.ClassINET, Ttl: h.Ttl},
		TypeCovered: h.Rrtype, Algorithm: key.Algorithm, Labels: uint8(dns.CountLabel(h.Name)), OrigTtl: h.Ttl,
		Expiration: uint32(exp.Unix()), Inception: uint32(incep.Unix()), KeyTag: key.KeyTag(), SignerName: origin,
	}
	if err := sig.Sign(signer, set); err != nil {
		return nil, fmt.Errorf("sign %s %s: %v", h.Name, dns.TypeToString[h.Rrtype], err)
	}
	return sig, nil
}

func rrsets(rrs []dns.RR) [][]dns.RR {
	var order []string
	groups := map[string][]dns.RR{}
	for _, rr := range rrs {
		k := rr.Header().Name + "/" + dns.TypeToString[rr.Header().Rrtype]
		if _, ok := groups[k]; !ok {
			order = append(order, k)
		}
		groups[k] = append(groups[k], rr)
	}
	var out [][]dns.RR
	for _, k := range order {
		out = append(out, groups[k])
	}
	return out
}

func writeZone(path string, rrs []dns.RR) error {
	var b strings.Builder
	for _, rr := range rrs {
		b.WriteString(rr.String())
		b.WriteString("\n")
	}
	return os.WriteFile(path, []byte(b.String()), 0o644)
}

func writeJSON(path string, v any) error {
	b, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(path, append(b, '\n'), 0o644)
}

func parseIP(s string) []byte {
	var a, b, c, d byte
	fmt.Sscanf(s, "%d.%d.%d.%d", &a, &b, &c, &d)
	return []byte{a, b, c, d}
}
