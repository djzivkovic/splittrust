# SplitTrust Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the RFC 9704 verifier, owner tooling, eight-scenario Docker lab, console, vectors and erratum described in the design, as one Go binary, in 22 hours.

**Architecture:** One Go module; `internal/claim`, `txtrec`, `dhcp`, `pvd` are pure; `validate` wraps libunbound (cgo, build tag) with a daemon fallback; `dot`, `verify`, `route` implement RFC 9704 §5–7 against injectable dependencies; `api` serves the embedded console; the lab is Compose services fed by a one-shot bootstrap that signs public zones with BIND tools and local zones with miekg/dns.

**Tech Stack:** Go ≥ 1.25 (stdlib `flag`, `net/http`, `embed`, `testing`), `github.com/miekg/dns`, `github.com/miekg/unbound` (cgo, tag `libunbound`), `golang.org/x/net/idna`; Docker Compose; CoreDNS 1.12, unbound, nginx 1.27, BIND 9.20 tools (bootstrap only).

**Spec:** `docs/superpowers/specs/2026-10-31-splittrust-design.md` (read it first; this plan argues from it). Comparison and research: `docs/superpowers/specs/2026-10-31-spec-comparison.md`, `docs/research/`.

## Global Constraints

- Module path `github.com/djzivkovic/splittrust`; `go.mod` says `go 1.25`; no frameworks (no cobra, testify, gin).
- JSON: snake_case, `schema_version: 1`, RFC 3339 UTC times; reason codes and stage ids exactly as design §6.
- Exit codes: 0 accepted/success, 1 conclusive rejection, 2 invalid input or indeterminate.
- Every report carries `trust_context: "lab"`.
- Runtime input is a `scenario_id` or a claim file; never caller-supplied IPs, URLs, anchors, CA paths.
- Compose network `172.30.97.0/24`, `internal: true`; only `127.0.0.1:8000` published; generated material only in the named volume `labgen`; nothing generated is committed.
- Never `InsecureSkipVerify`; token and `ds` from the same TXT RR only; `--external` never default.
- Token procedure literal to RFC 9704 §5; `*` encoded as label `\x01*`; names lowercased and IDNA A-labels.
- Tests: important behaviours only (the user asked not to go overboard). One table-driven test per pure package, targeted tests for security-relevant branches, one integration suite for the lab. No UI unit tests.
- Commits: `git -c user.name="Ilija Radosavljevic" -c user.email="45182003+ilija02@users.noreply.github.com" commit …` on branch `iradosavljevic/spec` (or a branch cut from it); never change git config.
- `.gitattributes` forces LF for `*.sh`, `Corefile*`, `*.conf`, `*.tmpl`, `*.json`, `*.yaml` (Windows checkouts must not break container configs).
- Docker Desktop must be running for Tasks 2, 4, 8; unit tests run with the local Go toolchain.

## Review Focus

1. A PvD document whose claim `resolver` differs from the DNR-announced ADN must be rejected with `CLAIM_RESOLVER_MISMATCH` before any DNS query — Task 3.
2. A TXT RRset where the matching RR has a non-matching `ds` and another matching RR is token-only must be `DS_MISMATCH`, never a token-only grant — Task 3.
3. A DNSKEY set containing an approved key but signed only by an unrelated key must fail local validation — Task 3.
4. `resolve` for `internal.corp.lab.evil.lab` must take the default route (label-wise suffix), and a name outside the lab must make zero DNS calls — Task 4.
5. A DoT endpoint whose certificate does not match the ADN must yield `TLS_IDENTITY_FAILED` even when the token matches (scenario `replay`) — Tasks 3 and 8.

---

## File structure

```
go.mod, go.sum, .gitattributes, .gitignore, .dockerignore, LICENSE (MIT), README.md
cmd/splittrust/main.go               subcommand dispatch, exit codes, --json
internal/claim/claim.go              RawClaim, Canonical, Canonicalize, special-use list, errors
internal/claim/token.go              PseudoWire, Token, RecordOwner, Inspect
internal/claim/claim_test.go         table test over vectors + special-use + edge cases
internal/txtrec/txtrec.go            ParseRR, Format
internal/txtrec/txtrec_test.go
internal/dhcp/dhcp.go                EncodeV4, EncodeV6, Decode, SplitV4
internal/dhcp/dhcp_test.go
internal/pvd/pvd.go                  Document, Parse, Fetcher.Fetch
internal/pvd/pvd_test.go
internal/validate/validate.go        Security, Evidence, PublicResolver, helpers (RRSIG expiry)
internal/validate/libunbound.go      //go:build libunbound
internal/validate/daemon.go          //go:build !libunbound  (AD / SERVFAIL+EDE mapping)
internal/dot/dot.go                  Client, Conn, IdentityError
internal/lab/manifest.go             Profile, Manifest, Load, Summaries
internal/verify/verify.go            Verifier, Report, Stage, Grant, pipeline
internal/verify/ds.go                MatchDS, ValidateLocalA
internal/verify/verify_test.go       fake deps; security branches
internal/route/route.go              Resolver.Resolve, ResolveReport
internal/route/route_test.go
internal/api/api.go                  handlers, limits, embedded web
internal/api/web/index.html, app.js, style.css
internal/api/api_test.go
internal/vectors/vectors.go          Generate() → encoding/dhcp/pvd/verification-cases JSON + forensics table
internal/vectors/vectors_test.go     committed vectors == regenerated
internal/labgen/labgen.go            lab-init: salts, claims, PvD docs, TXT lines, local zones (miekg/dns signing), manifest
lab/compose.yaml
lab/app/Dockerfile                   multi-stage; ARG LIBUNBOUND=1 toggles -tags libunbound
lab/bootstrap/Dockerfile, bootstrap.sh, zones/*.tmpl, hints.tmpl
lab/public-dns/Corefile, lab/local-dot/Corefile, lab/hotel-dot/Corefile
lab/pvd/nginx.conf
lab/external/unbound.conf.tmpl
lab/scenarios.json                   titles, explanations, expected outcomes (presentation metadata)
tests/integration/lab_test.go        //go:build integration — scenarios, parity, controls
vectors/encoding.json, dhcp.json, pvd.json, verification-cases.json, README.md
docs/rfc9704-example-erratum.md, docs/demo.md
```

---

### Task 1: Module, contracts and pure engine (`claim`, `txtrec`, `dhcp`) + `inspect`/`build-record`

**Files:** Create `go.mod`, `.gitattributes`, `.gitignore`, `.dockerignore`, `LICENSE`, `README.md` (stub), `cmd/splittrust/main.go`, `internal/claim/{claim,token,claim_test}.go`, `internal/txtrec/{txtrec,txtrec_test}.go`, `internal/dhcp/{dhcp,dhcp_test}.go`.

**Interfaces (produces):**
```go
// internal/claim
type RawClaim struct { Resolver, Parent string; Subdomains []string; Algorithm, Salt string; Extra map[string]json.RawMessage }
func (c *RawClaim) UnmarshalJSON(b []byte) error   // keeps unknown keys in Extra
type Canonical struct { Resolver, Parent string; Relative []string; Scopes []string; Salt []byte; Algorithm string; WholeZone bool; Warnings []string }
type Error struct { Code, Detail string }           // Code: INVALID_CLAIM | SPECIAL_USE_NAME
func Canonicalize(raw RawClaim) (Canonical, error)
func CanonicalLess(a, b []string) bool              // RFC 4034 §6.1 on label slices
func PseudoWire(c Canonical) []byte                 // $X
func Token(c Canonical) (string, []byte, error)     // base64url-no-pad, digest
func RecordOwner(resolver, parent string) string    // "<adn>._splitdns-challenge.<parent>."
type Inspection struct { CanonicalResolver, CanonicalParent string; Relative, Scopes []string; SaltLength int; PseudoWireHex, TokenInputHex, Token, RecordOwner string; Warnings []string }
func Inspect(raw RawClaim) (Inspection, error)
var SpecialUse = []string{"test.", "localhost.", "invalid.", "example.", "example.com.", "example.net.", "example.org.", "local.", "onion.", "alt.", "home.arpa.", "resolver.arpa.", "ipv4only.arpa.", "10.in-addr.arpa.", "168.192.in-addr.arpa." /* + the 16 172.16-31 reverse zones */}
// internal/txtrec
type Record struct { Token string; DS []string; Unknown map[string]string }
func ParseRR(charStrings []string) (Record, error)  // one RR; error on duplicate token / malformed pair / token not 48 or 64 octets
func Format(token string, ds []string) string
// internal/dhcp
func EncodeV4(c claim.Canonical, replay uint64) ([]byte, error)  // protocol 4, algorithm (1|2), RDM 0, replay, ADN wire, parent wire, len(salt), salt, X
func EncodeV6(c claim.Canonical, replay uint64) ([]byte, error)  // identical body (option 11 carries no code/len)
type Decoded struct { Algorithm uint8; Replay uint64; ADN, Parent string; Salt []byte; Relative []string }
func Decode(payload []byte) (Decoded, error)
func SplitV4(payload []byte) [][]byte              // RFC 3396 chunks ≤ 255
```

- [ ] **Step 1: `go mod init github.com/djzivkovic/splittrust`; add `.gitattributes` (`* text=auto`, LF rules), `.gitignore` (`lab/generated/`, `*.pem`, `*.key`, `bin/`), MIT `LICENSE`, `go get github.com/miekg/dns golang.org/x/net/idna`.**

- [ ] **Step 2: Write the failing table test `TestTokenVectors` in `internal/claim/claim_test.go`** with these rows (expected values from `docs/research/rfc9704_token_check.py`):

| name | parent | subdomains | salt | alg | token / expectation |
|---|---|---|---|---|---|
| rfc-printed-salt | parent.example | payroll.parent.example, secret.project.parent.example | ascii `example salt octets (should be random)` | SHA384 | `wA1lI3Tdnm2z3rbjAa6A998luwSDTU9LU45SoruhsTBtmcdL5BhalHS2v5UCSzal`, X hex `07706179726f6c6c00067365637265740770726f6a65637400` |
| rfc-draft07-salt | same | same | ascii `example salt bytes (should be random)` | SHA384 | `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8AEtcHrFQkfiiQ79nhcHyXFkD` |
| firma | firma.rs | mail, intranet | hex `567de4436afd6d7cf4a4b9b862df301c` | SHA384 | `PJv5v0eMID1V22B3Cp2bw1ge0yxBGVMtNaMatP_7HBuNyQn4Xu8WlsnYOI9v7z2E`, Relative = [intranet mail] |
| canonical-order | firma.rs | intranet, mail, vpn.intranet | same | SHA384 | prefix `oBAmDEGau4IBs4j1-bdpE_rN`, Relative = [intranet vpn.intranet mail], Warnings contains "not in canonical order" |
| uppercase | Firma.RS | INTRANET, Mail | same | SHA384 | equals firma token |
| star | banka.lab | * | bytes 0..15 | SHA384 | X hex `012a00`, WholeZone, Scopes = [banka.lab.] |
| idn | фирма.срб | интранет | bytes 0..15 | SHA384 | Relative = [xn--80akhubqne] |
| sha512 | firma.rs | intranet, mail | hex as firma | SHA512 | 86-char token, prefix `_YSpJx7AMUTsDLZJ` |

  plus `TestCanonicalizeRejects`: parent `home.arpa` → `SPECIAL_USE_NAME`; `["*","x"]`, duplicates, empty list, 256-octet salt, algorithm `MD5` → `INVALID_CLAIM`; and `TestRecordOwner` (`resolver17.parent.example._splitdns-challenge.parent.example.`).

- [ ] **Step 3: `go test ./internal/claim/` — expect compile failure (undefined symbols).**

- [ ] **Step 4: Implement `claim.go` and `token.go`.** Lowercase + `idna.Lookup.ToASCII` per label; absolute subdomains ending in the parent are made relative; sort with `CanonicalLess` on reversed label slices; `PseudoWire` writes `len||label` per label then `0x00` per name; token input `len(salt)||salt||X`; hash by algorithm (`crypto/sha512.New384`, `sha512.New`).

- [ ] **Step 5: `go test ./internal/claim/` — PASS.**

- [ ] **Step 6: Write failing `internal/txtrec/txtrec_test.go`:** `TestParseRRFragmentsWithinRecord` (`["token=T,ds=A", ",future=x,ds=B"]` → Token T, DS [A B], Unknown has future); `TestParseRRDuplicateToken` → error; `TestParseRRBadLength` (token of 63 chars → error). Then implement; PASS.

- [ ] **Step 7: Write failing `internal/dhcp/dhcp_test.go`:** `TestRoundTrip` (firma claim → EncodeV4 → Decode equals Canonical fields; header bytes `04 01 00` + 8 replay bytes; body = `\x03dns\x05firma\x02rs\x00` `\x05firma\x02rs\x00` `0x10` salt X) and `TestSplitV4` (300-byte payload → chunks of 255 and 45). Implement; PASS.

- [ ] **Step 8: `cmd/splittrust/main.go`: subcommands `inspect --claim FILE [--json]` and `build-record --input FILE [--json]`** (input = RawClaim JSON plus optional `ds` array; output `RecordBuild{claim, record_owner, txt, token, signing_state:"not_checked", warnings}`; if `salt` empty, generate 32 random bytes and emit the claim JSON with it). `--json` prints one object on stdout; diagnostics to stderr; exit 2 on invalid input.

- [ ] **Step 9: Verify: `go vet ./... && go test ./...` pass; `go run ./cmd/splittrust inspect --claim testdata/firma.json --json | head` shows the firma token. Commit: `feat: claim canonicalisation, token, TXT and DHCP codecs`.**

---

### Task 2: Lab bootstrap, Compose, validator adapter

**Files:** Create `internal/labgen/labgen.go`, `internal/validate/{validate,libunbound,daemon}.go`, `internal/lab/manifest.go`, `lab/compose.yaml`, `lab/app/Dockerfile`, `lab/bootstrap/{Dockerfile,bootstrap.sh}`, `lab/bootstrap/zones/*.tmpl`, `lab/{public-dns,local-dot,hotel-dot}/Corefile`, `lab/pvd/nginx.conf`, `lab/external/unbound.conf.tmpl`, `lab/scenarios.json`, `tests/integration/lab_test.go`; extend CLI with `lab-init`.

**Interfaces (produces):**
```go
// internal/validate
type Security string  // "secure" "insecure" "bogus" "indeterminate" "error"
type Evidence struct { QName string; QType uint16; Rcode int; Security Security; Why string; TTL uint32; RRSIGExpiresAt *time.Time; Answer []dns.RR; WireB64 string; ObservedAt time.Time }
type PublicResolver interface { Resolve(ctx context.Context, qname string, qtype uint16) (Evidence, error) }
type Config struct { AnchorFile, RootHintsFile string; DaemonAddr string }
func New(cfg Config) (PublicResolver, error)       // libunbound build: fresh ub ctx per call; default build: daemon
func EarliestRRSIGExpiry(rrs []dns.RR) *time.Time
// internal/lab
type Profile struct { ScenarioID, Title, Explanation, Resolver, ClaimSource, PvDURL, ClaimFile, DoTAddr, ExternalAddr, ExternalName, CAFile, AnchorFile, RootHints, ExampleQName string; PermittedNamespaces []string; Expected struct{ Decision, Reason string } }
type Manifest struct { Profiles map[string]Profile; Order []string }
func Load(path string) (Manifest, error)
// internal/labgen
func Generate(outDir string, now time.Time) error   // writes claims, PvD docs, TXT lines, local zones (signed), resolver.arpa DNSKEY, DS values, manifest.json
```

- [ ] **Step 1: Write `tests/integration/lab_test.go` (`//go:build integration`) — failing until the lab exists:** `TestPublicStatesAreReal`: resolve each profile's record owner TXT via `validate.New` → `legit` secure, `expired-signature` bogus, `unsigned` insecure, `hotel` secure with Rcode NXDOMAIN; `TestDoTIdentity`: `dot.Client.Dial(hotel-dot, "dns.corp.lab")` returns `*dot.IdentityError`, `Dial(local-dot, "dns.corp.lab")` succeeds. (The `dot` package arrives in Task 3; keep this test compiling by writing only the resolver cases now and adding the TLS case in Task 3.)

- [ ] **Step 2: Implement `labgen.Generate`.** For each scenario in design §9: random 16-byte salt (stale-salt: TXT uses a *second* salt), RawClaim JSON, PvD document (`identifier`, `expires` now+36 h, `prefixes` ["2001:db8:97::/48"], `splitDnsClaims`), TXT line `token=…[,ds=…]`. Generate local KSK/ZSK (ECDSAP256SHA256 via `dns.DNSKEY.Generate(256)`), write `resolver.arpa.` DNSKEY RRset file, child zones `internal.{corp,stale,expired,unsigned,wrongds}.lab` with SOA/NS/A `host` 10.0.5.20 (+ the duplicated KSK at apex) signed with `RRSIG.Sign` for now−5 min → now+48 h; `ds=` for legit = `ToDS(SHA256)` of the KSK with owner `resolver.arpa.`; for wrong-ds = DS of a throw-away key. Hotel view zone `banka.lab` with `www A 172.30.97.66`. Write `manifest.json` (profiles from `lab/scenarios.json` + generated paths).

- [ ] **Step 3: Write `lab/bootstrap/bootstrap.sh`** (BIND 9.20 image + openssl): run `splittrust lab-init --out /gen/work`; `dnssec-keygen` KSK+ZSK for `.`, `lab`, each parent; render zone templates (TXT lines from lab-init; `corp.lab` etc. get `internal NS ns.internal` + glue, **no DS**; `lab` gets DS for every signed parent except `unsigned.lab`; root gets DS for `lab`); `dnssec-signzone -S -3 - -H 0`? → use NSEC (`-S` without `-3`) for readability; validity `-s now-300 -e now+172800`, expired zone `-s now-7200 -e now-3600`; write root `DS` as trust anchor (`trust-anchor-file` syntax and `unbound` `trust-anchor:` line) and `root.hints` (`. NS ns.root.` / `ns.root. A 172.30.97.10`); openssl CA + leaf certs with SANs per design §9; copy per-service directories under `/gen/{client,public-dns,local-dot,hotel-dot,pvd,external}`; chmod readable; exit non-zero on any failure (`set -euo pipefail`).

- [ ] **Step 4: Write Corefiles, nginx.conf, unbound.conf.tmpl, `lab/compose.yaml`.** CoreDNS `public-dns`: one `file` block per zone, `dnssec`? — no: serve pre-signed files only, `errors`, no `forward`. `local-dot`: `tls://.:853 { tls /gen/local-dot/cert.pem /gen/local-dot/key.pem; file … }` per child zone + `resolver.arpa`. `hotel-dot`: same with the hotel cert and the hijacked `banka.lab`. nginx: one `server` on 443 with the PvD cert, `root /gen/pvd/$host/` serving `/.well-known/pvd` with `types { application/pvd+json pvd; }`. External unbound: `root-hints`, `trust-anchor-file`, `tls-service-key/pem`, `interface: 0.0.0.0@853`, `harden-dnssec-stripped: yes`, no forwarders. Compose: services `bootstrap` (one-shot, volume `labgen:/gen`), `public-dns`, `local-dot`, `hotel-dot`, `pvd`, `external`, `app` (`depends_on` bootstrap completed; `ports: 127.0.0.1:8000:8000`), `test` (profile `tools`, runs `go test -tags integration ./tests/...`); network `splitlab` `internal: true`, subnet `172.30.97.0/24`, static IPs as design §5; `extra_hosts`/`aliases` for `pvd.*.lab`, `dns.*.lab`, `quad9.lab` so the app resolves them without DNS.

- [ ] **Step 5: `lab/app/Dockerfile`:** stage 1 `golang:1.26-bookworm` (fallback `1.25`), `apt-get install -y libunbound-dev`, `ARG LIBUNBOUND=1`, `go build -tags "$( [ "$LIBUNBOUND" = 1 ] && echo libunbound )" -o /out/splittrust ./cmd/splittrust`; stage 2 `debian:bookworm-slim` + `libunbound8` (+ `unbound` when LIBUNBOUND=0, started by `entrypoint.sh` on 127.0.0.1:5353 with the lab anchor/hints). **Time box:** if the cgo build or `miekg/unbound` API does not work within 45 minutes, set `LIBUNBOUND=0` in compose and continue with the daemon adapter; record the decision in README.

- [ ] **Step 6: Implement `validate`:** `libunbound.go` — per call `unbound.New()`, `SetOption("root-hints:", hints)`, `AddTaFile(anchor)`, `SetOption("do-udp:", "yes")`, `Resolve(qname, qtype, ClassINET)`, map `Secure→secure`, `Bogus→bogus (Why=WhyBogus)`, else `insecure`; Rcode and `Rr` into Evidence, `Destroy()`. `daemon.go` — `dns.Exchange` with DO+AD to `DaemonAddr`; `AD→secure`; `SERVFAIL` + EDE option (`dns.EDNS0_EDE`) codes 6–12 → `bogus` with Why = EDE text; `NOERROR/NXDOMAIN` without AD → `insecure`; network error → `error`.

- [ ] **Step 7: Bring the lab up and run the gate:** `docker compose -f lab/compose.yaml up --build -d` then `docker compose -f lab/compose.yaml --profile tools run --rm test`. Expected: `TestPublicStatesAreReal` PASS (secure / bogus / insecure / secure-NXDOMAIN). Also `dig @172.30.97.10 dns.corp.lab._splitdns-challenge.corp.lab TXT +dnssec` from the `test` container shows the RRSIG.

- [ ] **Step 8: Commit: `feat: isolated DNSSEC/DoT/PvD lab and validator adapter` (no `lab/generated`).**

---

### Task 3: DoT, PvD, verifier pipeline, DS binding, local validation

**Files:** Create `internal/dot/dot.go`, `internal/pvd/{pvd,pvd_test}.go`, `internal/verify/{verify,ds,verify_test}.go`; extend `tests/integration/lab_test.go` with `TestDoTIdentity`.

**Interfaces (produces):**
```go
// internal/dot
type Client struct { Roots *x509.CertPool; Timeout time.Duration }
type IdentityError struct { ServerName string; Err error }
func (c *Client) Dial(ctx context.Context, addr, serverName string) (*Conn, error)   // tls.Config{ServerName, RootCAs}; hostname mismatch → *IdentityError
func (cn *Conn) Query(ctx context.Context, qname string, qtype uint16) (*dns.Msg, error) // DO set
// internal/pvd
type Document struct { Identifier string; Expires time.Time; Prefixes []string; Claims []claim.RawClaim; Extra map[string]json.RawMessage }
type Fetcher struct { Roots *x509.CertPool; Timeout time.Duration; MaxBytes int64 }
func Parse(b []byte) (Document, error)
func (f *Fetcher) Fetch(ctx context.Context, url, expectedID string, now time.Time) (Document, error) // *Error{Code: PVD_INVALID|PVD_EXPIRED}
// internal/verify
type Deps struct { Public validate.PublicResolver; DoT *dot.Client; PvD *pvd.Fetcher; Now func() time.Time }
type Options struct { External bool }
type Stage struct { ID, Status, Code, Message string; Evidence any }
type Grant struct { Resolver string; Scopes []string; ExpiresAt time.Time; AuthorizedKeys []string; LocalDNSSECMode, Path string }
type Report struct { SchemaVersion int; ScenarioID, TrustContext, Decision, Reason string; Stages []Stage; Inspection *claim.Inspection; Grant *Grant }
func (v *Verifier) Verify(ctx context.Context, p lab.Profile, inline *claim.RawClaim, opt Options) Report
func MatchDS(dsB64 []string, keys []*dns.DNSKEY) []*dns.DNSKEY             // owner "resolver.arpa."
func ValidateLocalA(approved []*dns.DNSKEY, dnskeyMsg, aMsg *dns.Msg, now time.Time) ([]string, error)
```

- [ ] **Step 1: Write failing `verify_test.go` with fake `PublicResolver`/DoT/PvD (in-memory, call counters):**
  - `TestResolverMismatchRejectsBeforeDNS` — PvD claim resolver `dns.evil.lab`, profile resolver `dns.corp.lab` → `rejected/CLAIM_RESOLVER_MISMATCH`, public resolver calls == 0.
  - `TestWrongDSRejectsDespiteTokenOnlyRR` — RRset {matching token+bad ds, matching token-only} → `rejected/DS_MISMATCH`, Grant nil.
  - `TestTokenOnlyGrantNotEstablished` — single matching token-only RR → `accepted/AUTHORIZED`, `LocalDNSSECMode == "not_established"`, ds stage `skipped/DS_NOT_PRESENT`.
  - `TestInsecureWithoutExternalRejects` and `TestInsecureWithExternalAccepts` — security insecure → `DNSSEC_INSECURE_NO_FALLBACK`; with `Options{External:true}` and the fake external returning the token → `accepted/EXTERNAL_TOKEN_MATCH`, `Grant.Path == "external"`.
  - `TestKeySubstitutionFailsLocalValidation` — DNSKEY set = approved key + attacker key, RRSIG by attacker only → `ValidateLocalA` error `LOCAL_SIGNATURE_INVALID`; positive control with approved signer returns the A string.
  - `TestGrantExpiryUsesRRSIG` — TTL 3600 but RRSIG expires in 60 s → `ExpiresAt` ≈ now+60 s.
  Fixtures: generate keys and sign in-test with `dns.DNSKEY.Generate` and `RRSIG.Sign` (no files).

- [ ] **Step 2: `go test ./internal/verify/` — compile failure.**

- [ ] **Step 3: Implement `dot.go`, `pvd.go`, `verify.go`, `ds.go` per design §7 steps 1–9** (stage order, skipped stages, selection policy from §7.6/§7.8, expiry from §7.9, external stage only after `insecure`). `MatchDS`: decode base64url → key tag(2) alg(1) digest type(1) digest; for each key `key.ToDS(digestType)` with `Hdr.Name = "resolver.arpa."`; compare full RDATA.

- [ ] **Step 4: `go test ./internal/verify/ ./internal/pvd/` — PASS.** Add `TestDoTIdentity` to the integration file and run it in the lab (`--profile tools run --rm test`): hotel-dot with name `dns.corp.lab` → `*dot.IdentityError`.

- [ ] **Step 5: Commit: `feat: RFC 9704 verification pipeline with DS binding and local validation`.**

---

### Task 4: Scoped resolution, scenarios, full CLI

**Files:** Create `internal/route/{route,route_test}.go`; modify `cmd/splittrust/main.go` (`verify`, `resolve`, `scenarios`, `dhcp`), `lab/scenarios.json` (eight entries incl. `replay`, `special-use`), `internal/labgen` (replay/special-use profiles).

**Interfaces (produces):**
```go
// internal/route
type Resolver struct { V *verify.Verifier; Public validate.PublicResolver; DoT *dot.Client }
type ResolveReport struct { QName, QType, Route, RouteReason string; Answers []string; Verification *verify.Report; ErrorCode string }
func (r *Resolver) Resolve(ctx context.Context, p lab.Profile, qname string, opt verify.Options) ResolveReport
func InScope(qname string, scopes []string) bool   // label-wise
```

- [ ] **Step 1: Write failing `route_test.go`:** `TestLabelSuffixNotStringSuffix` (`internal.corp.lab.evil.lab.` with scope `internal.corp.lab.` → default route, no verification); `TestOutOfLabMakesNoCalls` (`example.com.` → route none, `OUT_OF_LAB_SCOPE`, resolver calls 0); `TestRejectedClaimKeepsDefault` (fake verifier returns rejected → route default, `RouteReason == "DEFAULT_CLAIM_REJECTED"`, DoT calls 0).

- [ ] **Step 2: Implement `route.go` per design §8** (`DEFAULT_LOOKUP_FAILED` never retried through the local resolver; `LOCAL_DNSSEC_NOT_ESTABLISHED` when the grant has no keys; `GRANT_EXPIRED`).

- [ ] **Step 3: `go test ./internal/route/` — PASS.**

- [ ] **Step 4: CLI:** `verify --scenario ID | --claim FILE [--external] [--json]`, `resolve --scenario ID --name FQDN [--json]`, `scenarios [--json]`, `dhcp encode --claim FILE | decode HEX`. Manifest path from `SPLITTRUST_MANIFEST` (default `/gen/client/manifest.json`). Text output: one line per stage `[pass] token  …`, final `DECISION reason (trust_context=lab)`.

- [ ] **Step 5: Verify in the lab:** `docker compose -f lab/compose.yaml up --build -d`; for each of the eight ids `docker compose -f lab/compose.yaml exec app splittrust verify --scenario ID --json` prints the table outcome from design §9; `verify --scenario unsigned --external` → `EXTERNAL_TOKEN_MATCH`; `resolve --scenario legit --name host.internal.corp.lab` → route local, answer `10.0.5.20`; `resolve --scenario hotel --name www.banka.lab` → route default.

- [ ] **Step 6: Commit: `feat: eight scenarios, scoped resolution and complete CLI`.**

---

### Task 5: API and embedded console

**Files:** Create `internal/api/{api,api_test}.go`, `internal/api/web/{index.html,app.js,style.css}`; modify `cmd/splittrust/main.go` (`serve --addr 127.0.0.1:8000`), `lab/compose.yaml` (`app` command `serve`).

**Interfaces (produces):** `func NewHandler(m lab.Manifest, v *verify.Verifier, r *route.Resolver) http.Handler` with routes from design §10; `//go:embed web` served at `/`.

- [ ] **Step 1: Write failing `api_test.go` with a fake verifier:** `TestRejectedIs200Report` (`POST /api/verify {"scenario_id":"wrong-ds"}` → 200, body `reason == "DS_MISMATCH"`, `grant == null`); `TestUnknownFieldIs422` (`{"scenario_id":"legit","url":"http://x"}` → 422, verifier calls 0); `TestUnknownScenarioIs404`; `TestBodyLimit413` (17 KiB body).

- [ ] **Step 2: Implement handlers** (`http.MaxBytesReader` 16 KiB, `DisallowUnknownFields`, 10 s context per verification, JSON errors), `GET /api/capabilities` (`trust_context`, `verification_methods: ["dnssec","external"]`, `ds_support: true`, `dhcp: "codec-only"`), `GET /api/scenarios` from the manifest with `expected`.

- [ ] **Step 3: Console page:** section 1 scenario list (button per scenario, expected vs actual columns, `--external` toggle only on `unsigned`); section 2 stage trace (status chip, code, message, collapsible evidence `<pre>`); section 3 owner form → `/api/records/build` with copy buttons and unsigned warning; fixed banner "LAB TRUST CONTEXT — private .lab root, not the global DNS"; colours per design §10. Vanilla JS `fetch`, no build step.

- [ ] **Step 4: `go test ./internal/api/` PASS; in the lab open `http://127.0.0.1:8000`, run all eight, build one record. Commit: `feat: HTTP API and embedded console`.**

---

### Task 6: Vectors, erratum, docs

**Files:** Create `internal/vectors/{vectors,vectors_test}.go`, `vectors/{encoding,dhcp,pvd,verification-cases}.json`, `vectors/README.md`, `docs/rfc9704-example-erratum.md`, `docs/demo.md`; rewrite `README.md`.

- [ ] **Step 1: `TestCommittedVectorsAreCurrent`:** `vectors.Generate()` output equals the committed files byte-for-byte (fails until generated); `TestForensics`: `Nul-stripped(sha384(draft07 input))` base64url equals the RFC's printed 63-char token, and the printed token decodes to 47 bytes.

- [ ] **Step 2: Implement `vectors.Generate`** (rows of Task 1's table + TXT cases + DHCP payload hex for firma and a 300-byte claim with `SplitV4` chunks + PvD valid/invalid docs + verification-cases from `lab/scenarios.json`), `splittrust vectors --out vectors/`; run it, commit the JSON.

- [ ] **Step 3: Write `docs/rfc9704-example-erratum.md`** (design §11: full forensic chain with the draft-07 salt, NUL at offset 30, two consistent corrections, Figure 1 NSEC note, implementer decisions list, implementation-status wording) and `docs/demo.md` (order: legit → hotel → stale → expired → unsigned (both modes) → wrong-ds → replay → special-use; recovery: `docker compose down -v && up --build`), and `README.md` (prerequisites: Docker Desktop only; commands; trust caveat; supported subset; how to run tests).

- [ ] **Step 4: `go test ./...` PASS. Commit: `docs: vectors, erratum draft, demo script and README`.**

---

### Task 7: Acceptance and freeze

**Files:** Modify `tests/integration/lab_test.go` (`TestAllScenariosForwardAndReverse`, `TestCLIAPIParity`), `lab/compose.yaml` (healthchecks), `README.md`.

- [ ] **Step 1: Write the acceptance tests:** all eight scenarios via the Go API in forward and reverse order equal `expected` (decision, reason); `exec app splittrust verify --json` vs `POST /api/verify` agree on decision/reason/stage statuses for every scenario; hotel `resolve` never touches DoT (counter via a wrapping DoT client in tests).

- [ ] **Step 2: Run from a clean clone on macOS and Windows (Operator):** `docker compose -f lab/compose.yaml up --build -d && docker compose -f lab/compose.yaml --profile tools run --rm test`. Expected: all PASS; console works; `docker compose down -v` leaves nothing behind.

- [ ] **Step 3: Record the backup video of `docs/demo.md`; tag `v0.1.0`; commit `test: acceptance suite and demo freeze`. Feature freeze.**

---

## Definition of done

Eight scenarios correct from CLI and console on a clean clone (both OSes); positive DS binding and local validation work in `legit`; `replay` fails on TLS identity with a matching token; `unsigned` shows both §6.2 and §6.1 outcomes; vectors regenerate identically; erratum and README state the trust caveat; backup video exists.

Cut order if behind: console polish → `dhcp` subcommand → `--external` → `replay` → … never wrong `ds`, real validation, TLS identity, honest verdicts.

## Self-review record

- Spec coverage: §5 architecture → file structure; §6 contracts → Task 1/2/3 interfaces; §7 algorithm → Task 3; §8 → Task 4; §9 lab → Task 2 (+ profiles in Task 4); §10 → Tasks 4–5; §11 → Task 6; §12 rules → Global Constraints + Review Focus; §13 gates → Tasks 2/4/7; §15 calls → Task 3 tests 1–2 and §7.9 expiry test.
- Types consistent: `claim.Canonical`, `validate.Evidence`, `verify.Report/Grant/Stage`, `route.ResolveReport`, `lab.Profile` used with the same names in later tasks.
- Review Focus 1–5 each has a named test (Task 3: mismatch, DS policy, key substitution; Task 4: label suffix/zero calls; Task 3 integration + Task 7: TLS identity).
- Test volume deliberately limited per the approval note: ~25 unit tests, one integration file.
