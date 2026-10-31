# SplitTrust — unified design (Go, 22-hour hackathon build)

Status: design for approval, 2026-10-31. Supersedes `2026-10-27-splittrust-design.md` (branch
`djzivkovic-specs`) for engineering choices; keeps its product scope and safety rules. Nothing is
implemented until this document is approved. Section 14 lists every change relative to the 27 Oct design.

## 1. Intent

Build the first public, testable implementation of RFC 9704 ("Establishing Local DNS Authority in
Validated Split-Horizon Environments"): a verifier that decides whether a network's claim to answer for
part of a domain was really authorized by the domain owner, an isolated lab in which legitimate and
hostile claims are replayed end to end, tooling for domain owners, test vectors for other implementers,
and an erratum for the RFC's broken example. It is the deliverable of team NXDOMAIN's selected proposal
for the DNS SEC(urity) Hackathon 2026 (`SplitTrust_Proposal_NXDOMAIN.pdf`), to be demonstrated live at
the end of a 22-hour build.

Why it matters: a device that trusts a network's unauthenticated "local domain hints" can be made to
send a bank's queries to the hotel's resolver, and encrypting DNS does not help because the device is
talking to the wrong server. RFC 9704 closes that gap for hybrid clients, but it has no known
implementation, no vectors, and a worked example that cannot be reproduced. Without those, device makers
get it subtly wrong or do not ship it.

## 2. Goals, non-goals, anti-goals

Goals
- One verifier core shared by CLI and web console; real cryptographic and DNSSEC results only.
- All six scenarios of the selected proposal (legit, hotel, stale salt, expired signature, unsigned
  zone, wrong `ds`), plus a seventh (replayed claim / TLS identity mismatch) and a lab-free eighth
  (special-use name), runnable in any order from a clean `docker compose up`.
- Owner tooling: build the claim JSON and the Verification Record for a given claim, warn when the
  parent zone is not signed.
- Publishable test vectors (encoding, DHCP payload, PvD document, verification cases) and an erratum
  draft with the complete forensic explanation of the RFC §5.1 example.
- Buildable on macOS and Windows with Docker Desktop only; no host toolchain.
- Humans who can explain and defend every verdict path to the judges.

Non-goals (22-hour baseline)
- OS DNS interception, VPN client, browser integration, background daemons on the host.
- Real DHCP or Router Advertisement traffic; PvD discovery is pre-configured per scenario.
- Pure-Go DNSSEC chain validation; NSEC3; CNAME following in local answers.
- Persistence, accounts, databases, telemetry, CDN assets.
- Verification against arbitrary caller-supplied resolvers, URLs or trust anchors.
- Public-Internet verification (a Namecheap-hosted real record is a deferred, separate track).

Anti-goals (would make the result a failure even if it "works")
- A verdict that is derived from the scenario name or any UI-only simulation.
- A green result reached by trusting an AD bit from a network resolver, disabling TLS verification,
  or relaxing acceptance rules on the external path.
- Any traffic to third-party production systems from the lab, or any claim that `.lab` results are
  global authorization.
- A demo nobody on the team can explain.

## 3. Constraints

- 22 hours from kickoff to the presentation, presentation inside the window; freeze at H18.
- Implementation is done by the agent; the three humans are Reviewer, Operator and Storyteller
  (section 13). Everything must be reviewable in small, committed steps.
- Hackathon security rules: isolated environment, synthetic data, no probing or scanning of third-party
  systems, no changes to DNS the team does not control, private disclosure of findings to organisers
  first. The erratum is a document error, not a vulnerability, but it goes to the organisers before
  rfc-editor.org.
- Repository `github.com/djzivkovic/splittrust`, licence MIT, commits with GitHub no-reply identities.

## 4. Approaches considered

| Decision | Alternatives | Picked | Why |
|---|---|---|---|
| Engine language | Python 3.13 + dnspython + FastAPI + React (27 Oct design); Go + miekg/dns; Rust; C | **Go** | Newest DNS tooling that could adopt RFC 9704 is Go (CoreDNS, AdGuard Home, Tailscale, cloudflared); one static binary per OS; one toolchain instead of Python + Node; D's typed contracts port 1:1 to structs. |
| DNSSEC state (Secure/Insecure/Bogus) | pure-Go chain walk; libunbound in-process; validating unbound daemon beside the binary | **libunbound via `github.com/miekg/unbound` (cgo), with a decided fallback** to a localhost unbound daemon + Extended DNS Errors if the binding does not build within 45 minutes | Same validator semantics as the 27 Oct design (`secure`/`bogus`/`why_bogus`, fresh context per verification, no reliance on a network AD bit); pure-Go validation is 6–10 h of risk. |
| Console | React 19/Vite in Node 22; Streamlit; CLI only; one static page embedded in the Go binary | **Embedded static page** (vanilla JS, `embed.FS`) | Removes the Node toolchain; the console is a view over the same JSON the CLI prints. |
| Scenario 6 | wrong `ds` (submitted); replay/TLS mismatch | **Both**: wrong `ds` stays scenario 6, replay becomes scenario 7 | Wrong `ds` is printed in the selected proposal and exercises RFC §7, which no one has implemented; replay is the cheapest answer to "why isn't a matching token proof?". |
| §6.1 external-resolver path | exclude (27 Oct); explicit mode | **Explicit `--external` mode, default off**, yellow verdict | Judges will ask "what if the phone already uses Quad9?"; the RFC's answer is §6.1. Never default, never relaxes acceptance rules. |
| Lab namespace | `.lab` private root only; real domain; both | **`.lab` only** for the hackathon; real-record track deferred | Reproducible from a clean clone; `.test` is special-use (a correct verifier must refuse it); `.internal` is reserved for names that never reach public DNS. |
| Authoritative servers | BIND 9 for everything; CoreDNS `file` plugin | **CoreDNS serves; BIND tools sign** (bootstrap) | CoreDNS serves pre-signed zones and DoT natively and keeps the lab in Go; `dnssec-signzone`/`dnssec-keygen` are battle-tested for NSEC chains and past-dated signatures. |
| Fixtures | commit signed zones; regenerate at start | **Regenerate at `docker compose up`** with relative validity windows | Committed signatures rot; the expired scenario must be expired relative to now. |

## 5. Architecture

```
                    ┌──────────────────── app container (Go binary) ────────────────────┐
 browser ──127.0.0.1:8000──► net/http: /api/*  + embedded console                        │
 docker compose exec app splittrust verify|resolve|inspect|build-record|vectors|dhcp     │
                    │                 verifier core (internal/verify)                    │
                    │   PublicResolver ──► libunbound ctx (lab root anchor, lab hints)   │
                    │   DoTClient ──────► TLS to local-dot / hotel-dot, name = claim ADN │
                    │   PvDFetcher ─────► https://pvd.<net>.lab/.well-known/pvd (lab CA) │
                    │   ExternalResolver (only with --external) ► DoT quad9.lab          │
                    └────────────────────────────────────────────────────────────────────┘
   internal compose network 172.30.97.0/24 (internal: true)
   .10 public-dns  CoreDNS: root, lab, corp.lab, banka.lab, stale.lab, expired.lab,
                   unsigned.lab, wrongds.lab, hotel.lab, pvd/ADN A records   (UDP/TCP 53)
   .20 local-dot   CoreDNS: internal.corp.lab (locally signed), internal.wrongds.lab,
                   internal.{stale,expired,unsigned}.lab, resolver.arpa DNSKEY   (DoT 853)
   .21 hotel-dot   CoreDNS: hijacked banka.lab view; cert for dns.hotel.lab only (DoT 853)
   .30 pvd         nginx: six documents selected by Host, one cert with all PvD SANs (443)
   .40 external    unbound: validating recursive over the lab root, DoT cert quad9.lab (853)
   bootstrap       one-shot: CA, keys, zones, signatures, manifest → named volume `labgen`
```

One Go module `github.com/djzivkovic/splittrust`, one binary `splittrust`, packages:

| Package | Responsibility |
|---|---|
| `internal/claim` | canonical names (lowercase, IDNA A-labels, wire format), RFC 4034 §6.1 order, `$X`, token, record owner name, claim validation (special-use, edge cases) |
| `internal/txtrec` | Verification Record TXT codec: per-RR concatenation, `key=value` pairs, `token`/`ds` rules |
| `internal/pvd` | RFC 8801 document fetch and validation (identifier, expires, prefixes, media type, size/timeouts) |
| `internal/dhcp` | DHCPv4 option 90 / DHCPv6 option 11 Authentication payload encode/decode for protocol 4 (bytes only, no sockets) |
| `internal/validate` | `PublicResolver` interface; `libunbound` implementation (cgo) and `daemon` implementation (AD/EDE mapping); both return `DnsEvidence` |
| `internal/dot` | DoT client: TLS with lab CA, server name = claim ADN, RFC 9525 matching via `crypto/x509`, bounded timeouts |
| `internal/verify` | the ordered pipeline (section 7), `VerificationReport`, DS binding and bounded local-answer validation |
| `internal/route` | scoped demo resolution: `local` / `default` / `none` (section 8) |
| `internal/lab` | trusted manifest and scenario catalogue (`LabProfile`, `ScenarioSummary`) |
| `internal/api` | HTTP handlers, request limits, embedded `web/` |
| `internal/vectors` | vector generation (`splittrust vectors`) and the forensic computations for the erratum |
| `cmd/splittrust` | CLI |
| `lab/` | `compose.yaml`, Dockerfiles, CoreDNS/unbound/nginx config templates, `bootstrap.sh` |
| `vectors/`, `docs/` | published artifacts; `docs/superpowers/` holds specs and plans |

## 6. Shared contracts

Adopted from the 27 Oct design with two additions. Go structs with `json` tags, snake_case JSON,
`schema_version: 1`, all times RFC 3339 UTC.

| Type | Content |
|---|---|
| `RawClaim` | `resolver`, `parent`, `subdomains []string`, `algorithm`, `salt` (base64url); unknown keys preserved |
| `CanonicalClaim` | canonical ADN and parent, relative subdomains in canonical order, routing scopes (FQDNs), decoded salt, whole-parent flag |
| `Inspection` | canonical names, scopes, salt length, `pseudo_wire_hex`, `token_input_hex`, `token`, `record_owner` — no authorization claim |
| `ParsedVerificationRecord` | `token`, `ds_values []string`, kept per TXT RR |
| `DnsEvidence` | `qname`, `qtype`, `rcode`, `security` ∈ {secure, insecure, bogus, indeterminate, error}, `why` (validator reason text), `ttl`, `rrsig_expires_at` (earliest covering RRSIG, if any), `wire_b64`, `observed_at` |
| `StageResult` | `id`, `status` ∈ {pass, fail, error, skipped}, `code`, `message`, `evidence` (JSON) |
| `Grant` | `resolver`, `scopes`, `expires_at`, `authorized_keys []string` (DNSKEY RDATA), `local_dnssec_mode` ∈ {delegated, not_established}, `path` ∈ {dnssec, external} |
| `VerificationReport` | `schema_version`, `scenario_id`, `trust_context: "lab"`, `decision` ∈ {accepted, rejected, indeterminate}, `reason`, `stages []StageResult`, `inspection`, `grant` |
| `ResolveReport` | `qname`, `qtype`, `route` ∈ {local, default, none}, `route_reason`, `answers []string`, `verification *VerificationReport`, `error_code` |
| `RecordBuildRequest` / `RecordBuild` | owner tool input / `claim` JSON, `record_owner`, `txt` presentation, `token`, `signing_state` ∈ {secure, insecure, bogus, not_checked}, `warnings` |
| `LabProfile` | manifest entry: `scenario_id`, `resolver` (the ADN the network announced via DNR — what the client would have learned), `claim_source` ∈ {pvd, inline}, `pvd_url` or `claim_file`, `dot_addr`, `ca_file`, `anchor_file`, `root_hints`, `permitted_namespaces`, `example_qname`, `expected` (decision, reason — presentation only) |

Reason codes (stable strings): `AUTHORIZED`, `EXTERNAL_TOKEN_MATCH` (new; `--external` only),
`INVALID_CLAIM`, `SPECIAL_USE_NAME` (new), `CLAIM_RESOLVER_MISMATCH` (new; claim ADN ≠ DNR-announced
ADN), `UNSUPPORTED_PROFILE`, `OUT_OF_LAB_SCOPE`, `PVD_EXPIRED`, `PVD_INVALID`, `DNSSEC_BOGUS`,
`DNSSEC_INSECURE_NO_FALLBACK`, `DNS_LOOKUP_FAILED`, `RECORD_MISSING`, `RECORD_INVALID`,
`TOKEN_MISMATCH`, `TLS_IDENTITY_FAILED`, `DS_MISMATCH`, `LOCAL_SIGNATURE_INVALID`,
`LOCAL_DNSSEC_NOT_ESTABLISHED`, `GRANT_EXPIRED`, `EXTERNAL_TIMEOUT`.

Stages, in order: `pvd → claim → token → public_dnssec → record → resolver_tls → ds → grant`; with
`--external` an `external_resolver` stage runs between `public_dnssec` and `record` only when the DNSSEC
state is `insecure`. For `claim_source: inline` the `pvd` stage is reported `skipped` with code
`INLINE_CLAIM`. Stages after a failure are reported as `skipped`; the `ds` stage of a token-only grant is
`skipped` with code `DS_NOT_PRESENT`.

Exit codes: 0 accepted/successful, 1 conclusive rejection, 2 invalid input or indeterminate.

## 7. Verification algorithm

1. **Profile.** Load the trusted manifest; the caller supplies only a `scenario_id` (or, for `inspect`,
   `build-record` and `verify --claim`, a claim file, which runs under the `inline` profile). Anything
   outside `permitted_namespaces` → `OUT_OF_LAB_SCOPE` before any network call.
2. **PvD** (`claim_source: pvd` only). HTTPS GET of the profile's fixed URL with the lab CA, TLS name =
   PvD ID, no redirects, 3 s timeout, 64 KiB cap, `Content-Type: application/pvd+json`; require
   `identifier` == PvD ID, `expires` in the future, `prefixes` present; exactly one `splitDnsClaims`
   entry in this profile (otherwise `UNSUPPORTED_PROFILE`). Inline claims skip this stage.
3. **Claim.** Validate before any DNS: ADN and parent are valid names; the claim's `resolver` MUST
   equal the profile's DNR-announced `resolver` (RFC 9704 §5: "that identifying name MUST be the name
   used in any corresponding authorization claim"), else `CLAIM_RESOLVER_MISMATCH`; the parent is not
   bound to the profile (a network may claim any parent — the owner's record decides) but must be inside
   `permitted_namespaces`; parent not under an RFC 6761 special-use name (`SPECIAL_USE_NAME`);
   `algorithm` ∈ {SHA384, SHA512}; salt decodes (padding tolerated) to 0–255 octets, warn if < 16; 1–16
   subdomains, no duplicates, `*` only alone; names lowercased and IDNA-encoded; warn if the network's
   order was not canonical. Compute `$X`, token, record owner.
   Token procedure is RFC 9704 §5 literally: `hash(len(salt) || salt || X)`, `X` = concatenation of
   canonical relative wire names each terminated by `0x00`; `*` is the literal label `\x01*` (RFC 4034
   §6.2 item 4; also the only form the DHCP encoding can carry).
4. **Public DNSSEC.** Resolve `TXT <record_owner>` through the `PublicResolver` (libunbound context
   configured with the lab root trust anchor and lab root hints only; fresh context per verification).
   `secure` → continue; `bogus` → `DNSSEC_BOGUS`; `insecure` → `DNSSEC_INSECURE_NO_FALLBACK` unless
   `--external`; transport/rcode failure → `indeterminate` / `DNS_LOOKUP_FAILED`. Authenticated NXDOMAIN
   or NODATA → `RECORD_MISSING`.
5. **External (only `--external` and only after `insecure`).** DoT query of the same owner to the
   profile's external resolver (`quad9.lab`, lab CA), 2 s timeout; timeout → `EXTERNAL_TIMEOUT`
   (rejected, per §6.1 "MUST consider the verification failed"); a matching token → continue with
   `grant.path = "external"` and reason `EXTERNAL_TOKEN_MATCH`; the console renders this yellow with the
   caveat text. No `ds` processing on this path (§7 presumes DNSSEC).
6. **Record.** Parse each TXT RR separately (character-strings concatenated within an RR, never across
   RRs; comma-separated `key=value`; unknown keys ignored; multiple `ds` allowed). An RR that does not
   parse (duplicate `token`, malformed pair, token that is not 48/64 decoded octets) is excluded from
   selection and recorded as a warning in the evidence; if no RR parses → `RECORD_INVALID`. Matching RRs
   are those whose `token` equals the expected token; none → `TOKEN_MISMATCH`. Token and `ds` values are
   only ever used from the same RR. Selection policy among matching RRs is fixed in step 8.
7. **Resolver TLS.** Connect to the profile's DoT address with server name = claim ADN and the lab CA;
   certificate must match the ADN per RFC 9525 (`crypto/x509` `VerifyHostname`); failure →
   `TLS_IDENTITY_FAILED`. This is the stage that rejects the replayed claim (scenario 7).
8. **DS (RFC 9704 §7).** If no matching RR carries `ds`: the resolver is authorized token-only,
   `local_dnssec_mode = not_established`, stage `skipped` with `DS_NOT_PRESENT`. Otherwise query
   `DNSKEY resolver.arpa.` over the authenticated DoT connection; for every `ds` value in every matching
   RR compute DS over owner `resolver.arpa.` for each returned DNSKEY, using the digest type carried in
   the `ds` value (SHA-256 in the lab), and compare the full RDATA (key tag alone is not a match).
   Approved keys = all DNSKEYs matched this way. If at least one matches → `local_dnssec_mode =
   delegated`. If matching RRs carry `ds` values but **none** matches → `DS_MISMATCH`, even when a
   token-only matching RR also exists: the owner expressed an intent to bind keys and a mismatch is
   either misconfiguration or an attacker who cannot produce the key; the verifier does not silently
   downgrade to token-only authority. (Rotation still works: during a key rollover both old and new RRs
   carry a matching `ds`.)
9. **Grant.** `expires_at` = min(now + validated TXT TTL, earliest RRSIG expiration covering the TXT
   RRset, PvD `expires`) — RFC 9704 §11 says a record expires when its TTL *or* its signature validity
   ends; the validator returns the RRSIGs with the answer (DO bit set) and `DnsEvidence` records the
   earliest expiration. Scopes = claimed FQDNs. Grants are never cached across verifications in this demo.

Local-answer validation (used by `resolve`, scenario 1 and 6 only): fetch `DNSKEY <child apex>` and the
`A` answer over the authorized DoT connection; the DNSKEY RRset must be signed by one of the approved
keys (RRSIG verify with miekg/dns), then the A RRset must verify under that DNSKEY set. A set that merely
*contains* an approved key but is signed by an unrelated key fails (`LOCAL_SIGNATURE_INVALID`). Only
direct A records at supported names; no CNAME, no denial proofs — anything else is
`LOCAL_RESPONSE_UNSUPPORTED`, never a secure answer.

## 8. Scoped resolution (`resolve --scenario ID --name FQDN`)

Label-wise suffix matching, never string suffix (`internal.corp.lab.evil.lab` is out of scope). Outside
`permitted_namespaces` → `route: none`, `OUT_OF_LAB_SCOPE`, zero DNS calls. In the lab but outside the
claim's scopes → `route: default` via the client's own validator over the lab's public view, independent
of PvD availability. Inside the scopes → fresh verification; accepted → `route: local` with validated
answer (requires `local_dnssec_mode = delegated`, else `LOCAL_DNSSEC_NOT_ESTABLISHED` with no answer);
rejected/indeterminate → `route: default` with `route_reason` explaining why. Baseline failure →
`DEFAULT_LOOKUP_FAILED`, never a retry through the rejected resolver. Grant expiry before use →
`GRANT_EXPIRED`, no answer.

## 9. Lab

Zones (all algorithm 13, DS digest 2; signed by `dnssec-signzone` in bootstrap unless stated):

| Zone | Signed | Purpose |
|---|---|---|
| `.` (lab root) | yes; its KSK is the client's trust anchor | delegates `lab`, `arpa` |
| `lab` | yes | DS for all signed children; **no DS** for `unsigned.lab` |
| `corp.lab` | yes | `dns.corp.lab._splitdns-challenge TXT "token=…,ds=…"`; unsigned delegation `internal NS` (NSEC proves no DS) |
| `banka.lab` | yes | legitimate bank zone; no `_splitdns-challenge` records at all |
| `stale.lab` | yes | TXT holds the token for the *old* salt |
| `expired.lab` | yes, RRSIG validity now−2 h → now−1 h | bogus on purpose |
| `unsigned.lab` | no | token matches but zone is insecure |
| `wrongds.lab` | yes | TXT token matches, `ds` digest deliberately differs |
| `hotel.lab` | yes | A records for `dns.hotel.lab`, `pvd.hotel.lab` |
| `internal.corp.lab` (local-dot) | yes, local KSK/ZSK | child served only by the local resolver; apex DNSKEY duplicates the `resolver.arpa.` KSK |
| `resolver.arpa.` (local-dot) | DNSKEY only | RFC 9704 §7 anchor for the local resolver |
| `banka.lab` (hotel-dot view) | no | hijacked view: `www.banka.lab A 172.30.97.66` |

Validity windows: ordinary signatures now−5 min → now+48 h; TXT TTL 60 s; PvD `expires` now+36 h.
`bootstrap` regenerates everything on every `docker compose up` into the named volume `labgen`
(sub-directories `client/`, `public-dns/`, `local-dot/`, `hotel-dot/`, `pvd/`, `external/`); each service
mounts only its own sub-directory read-only; private keys never leave the volume; nothing in Git.

Scenarios (profiles in `lab/scenarios.json`; expected outcomes are presentation metadata):

| Id | Parent / ADN / subdomains | PvD | Expected |
|---|---|---|---|
| `legit` | `corp.lab` / `dns.corp.lab` / `["internal"]` | `pvd.corp.lab` | accepted / `AUTHORIZED`; `resolve host.internal.corp.lab` → local, validated |
| `hotel` | `banka.lab` / `dns.hotel.lab` / `["*"]` | `pvd.hotel.lab` | rejected / `RECORD_MISSING`; `resolve www.banka.lab` → default |
| `stale-salt` | `stale.lab` / `dns.stale.lab` / `["internal"]` | `pvd.stale.lab` | rejected / `TOKEN_MISMATCH` |
| `expired-signature` | `expired.lab` / `dns.expired.lab` / `["internal"]` | `pvd.expired.lab` | rejected / `DNSSEC_BOGUS` |
| `unsigned` | `unsigned.lab` / `dns.unsigned.lab` / `["internal"]` | `pvd.unsigned.lab` | rejected / `DNSSEC_INSECURE_NO_FALLBACK`; with `--external`: accepted / `EXTERNAL_TOKEN_MATCH` |
| `wrong-ds` | `wrongds.lab` / `dns.wrongds.lab` / `["internal"]` | `pvd.wrongds.lab` | rejected / `DS_MISMATCH` |
| `replay` | corp's exact claim; profile `resolver` = `dns.corp.lab` (the hotel's DNR lies about its ADN) and `dot_addr` = hotel-dot | `pvd.hotel.lab` (second document) | rejected / `TLS_IDENTITY_FAILED` — token matches, name binding passes, the certificate does not |
| `special-use` | `home.arpa` / `dns.corp.lab` / `["printers"]` | `claim_source: inline` (claim file in the manifest) | rejected / `SPECIAL_USE_NAME`, zero network calls |

Certificates: one lab CA (bootstrap, openssl); `local-dot` leaf SANs = the five legitimate ADNs;
`hotel-dot` leaf SAN = `dns.hotel.lab` only; `pvd` leaf SANs = the six PvD IDs; `external` leaf SAN =
`quad9.lab`. The client trusts only the lab CA. The console is plain HTTP on `127.0.0.1:8000`.

## 10. CLI, API, console

CLI (`splittrust`):
```
inspect       --claim FILE [--json]
build-record  --input FILE [--json]              # owner tool; signing_state from the lab validator when the parent is a lab zone, else not_checked
verify        --scenario ID | --claim FILE [--external] [--json]   # --claim runs under the lab-scoped `inline` profile
resolve       --scenario ID --name FQDN [--json]
scenarios     [--json]
vectors       [--out DIR]                        # regenerates vectors/*.json and the forensic table
dhcp          encode --claim FILE | decode HEX   # option 90/11 payload, protocol 4
lab-init      --out DIR                          # bootstrap only: salts, tokens, TXT lines, PvD docs, manifest
```
JSON on stdout only; diagnostics on stderr; no ANSI in `--json` mode.

API: `GET /api/health`, `GET /api/capabilities`, `GET /api/scenarios`, `POST /api/inspect`,
`POST /api/verify {scenario_id, external?}`, `POST /api/resolve {scenario_id, qname}`,
`POST /api/records/build`. Rejections are HTTP 200 with the report; malformed body 422; unknown scenario
404; body > 16 KiB 413 (enforced on streamed bytes); request envelopes reject unknown fields while RFC
claim objects preserve them. Verification runs off the request goroutine with a 10 s overall deadline.

Console: one embedded page, three sections — scenario list with **expected vs actual** side by side;
ordered stage trace with status, code, message and evidence (collapsible); owner record form with
copyable TXT/JSON and the unsigned-zone warning. Persistent banner "LAB TRUST CONTEXT — private `.lab`
root, not the global DNS". Verdict colours: green accepted/`AUTHORIZED`, yellow `EXTERNAL_TOKEN_MATCH`
and `not_established`, red rejected, grey indeterminate/unknown. The page never computes verdicts.

## 11. Vectors and erratum

`vectors/encoding.json`: RFC §5.1 with the printed salt (→ `wA1lI3…Szal`) and with the draft-07 salt
(→ `z1qyK7…XFkD`), the study-guide `firma.rs` example (`PJv5…`), canonical-vs-alphabetical order,
uppercase normalisation, `*`, SHA512, IDN (`фирма.срб` as A-labels), empty salt (with warning), TXT
parsing cases (fragments, rotation RRs, duplicate token). `vectors/dhcp.json`: option 90 and option 11
payloads for the `firma.rs` claim and for a > 255-octet claim showing RFC 3396 splitting.
`vectors/pvd.json`: well-formed and malformed documents. `vectors/verification-cases.json`: the eight
scenarios with expected decision/reason and the evidence class each one exercises. Every expected value
is produced independently (`docs/research/rfc9704_token_check.py`, stdlib Python) and checked by
`go test`; no vector is the engine comparing itself to itself.

`docs/rfc9704-example-erratum.md`: the §5.1 printed token equals SHA-384 over the draft-07 salt
`"example salt bytes (should be random)"` with the digest's single `0x00` byte (offset 30) dropped before
base64url (full 63-character reproduction); the salt was reworded to "octets" in draft-10 without
recomputation; two consistent corrections offered. Second, lower-priority item: Figure 1's NSEC line
(RFC 4035 §2.3). Also a section "what implementers must decide" (`*` encoding, TXT delimiter, one claim
per DHCP message, RDM 0 counter, `ds` owner name, IDNA, canonical re-sorting). Wording for
implementation status: "no public implementation found; the authors reported none in February 2025".

## 12. Security and honesty rules (binding)

- Verdicts come only from the verifier; the scenario name never influences them.
- Profile IDs only at runtime; no caller-supplied IPs, URLs, CA paths, anchors or commands.
- Compose network `internal: true`; only `127.0.0.1:8000` published; no Docker socket mounts; no API
  that runs Compose.
- Never `InsecureSkipVerify`; never accept a DoT endpoint whose certificate does not match the ADN.
- Token and `ds` from the same RR only; a key-tag match alone is not a DS match; an approved key inside
  an attacker-signed DNSKEY set does not validate anything.
- `--external` never lowers acceptance rules and is never the default; its verdict is visibly yellow.
- Every report carries `trust_context: "lab"`; README and slides say "unauthorized split-DNS routing
  prevented", not "hostile-network DNS attacks prevented", and state that rejection does not make an
  untrusted default resolver safe.
- No traffic leaves the lab except image pulls at build time. The owner tool queries only lab zones.
- Private keys and CA material exist only in the `labgen` volume.

## 13. Team model and timeline (22 h)

The agent implements in the task order of the plan; humans gate.

| Hour | Agent | Human gate |
|---|---|---|
| 0–1 | design approval, plan written | Reviewer approves design and plan |
| 1–4 | contracts, `internal/claim`, `internal/txtrec`, `internal/dhcp`, `inspect`/`build-record`, vectors, unit tests | Reviewer checks vectors against the RFC and the Python script |
| 4–8 | bootstrap, Compose, CoreDNS/nginx/unbound configs, `internal/validate` (libunbound; fallback decision at the 45-minute mark) | **Gate A (H8):** secure / bogus / insecure / wrong-TLS are real; clean clone builds on macOS and Windows |
| 8–12 | `internal/dot`, `internal/verify`, DS binding, local validation, `internal/route`, scenarios, CLI | **Gate B (H12):** eight scenarios correct from the CLI |
| 12–16 | API, console, `--external`, polish of reasons and evidence | Operator breaks it; Storyteller builds slides from real screenshots |
| 16–18 | vectors + erratum doc, acceptance tests, README, `docs/demo.md` | **Gate C (H18): freeze**; backup video recorded |
| 18–21 | bug fixes only | two timed rehearsals, Q&A drill |
| 21–22 | buffer | rest |

Cut order if behind: console polish → DHCP codec → `--external` → `replay` → … never wrong `ds`, real
validation, TLS identity, honest verdicts.

Roles: **Reviewer** reads each merged task against RFC 9704 §5–7 and this document, owns the expected-
outcome table and signs the gates. **Operator** builds from a clean clone on both OSes at each gate,
files breakage, runs the live demo, records the backup video. **Storyteller** owns README, erratum text,
slides, Q&A list, and later the Namecheap/real-record track.

## 14. Changes relative to the 27 Oct design, and why

| Area | 27 Oct | Now | Why |
|---|---|---|---|
| Stack | Python 3.13, dnspython, FastAPI, React/Vite/Node 22 | Go single binary, embedded page | one toolchain, cross-OS, matches the adopter ecosystem |
| Validation plumbing | libunbound python worker subprocess | libunbound via cgo in-process; daemon + EDE fallback | same semantics, no subprocess protocol; fallback pre-decided |
| Fixture signing | dnspython `sign_zone` in Python bootstrap | BIND `dnssec-keygen`/`dnssec-signzone` in bootstrap container | no zone signer to write in Go |
| Scenarios | six | six + `replay` + `special-use` | "token match ≠ proof" demonstration; spec fidelity |
| §6.1 | excluded | explicit `--external`, default off, yellow | answers the predictable judge question with the RFC's own answer |
| DHCP | excluded | payload codec + vectors, no sockets | ≈1 h in Go; vectors nobody else has; one-claim-per-message finding |
| Claim validation | ASCII only | IDNA A-labels, special-use rejection, canonical-order warning | real-world and local (.срб) relevance |
| Team model | three coding lanes, 24 h | agent implements, three human gates, 22 h | what the team asked for |
| Everything else | — | kept | contracts, reason codes, stage order, per-scenario zones, PvD Host selection, relative validity windows, safety rules, exit codes, review-focus classes |

## 15. Builder-check resolutions (my calls — veto if you disagree)

An independent reader planned from a draft of this document and asked four questions. None changes what
gets built from the team's point of view, so I settled them here:

1. **Entry point for lab-free claims.** Profiles carry `claim_source: pvd | inline`; `special-use` is an
   inline profile and `verify --claim FILE` runs under the lab-scoped `inline` profile. The `claim` stage
   runs before any DNS, so special-use and malformed claims never touch the network.
2. **Binding the claim to the announced resolver.** The claim's `resolver` must equal the profile's
   DNR-announced ADN (`CLAIM_RESOLVER_MISMATCH`), exactly as RFC 9704 §5 requires; the parent is not
   bound to the profile because the owner's record, not the network, decides. The `replay` profile
   therefore models a hotel whose DNR announces `dns.corp.lab` — the TLS stage catches it.
3. **TXT selection policy.** Unparseable RRs are ignored with a warning; matching RRs with `ds` that all
   fail → `DS_MISMATCH` even if a token-only RR exists (no silent downgrade); approved keys are the
   union over matching RRs; token-only only when no matching RR carries `ds`.
4. **Grant expiry** also capped by the earliest covering RRSIG expiration, per RFC 9704 §11;
   `DnsEvidence.rrsig_expires_at` carries it.

## 16. Left to the builder

Exact Go file names inside the packages above; CoreDNS, unbound and nginx configuration syntax; the
bootstrap shell script; CSS; log formats; test names; the Dockerfile base images (suggested:
`golang:1.23-bookworm` build stage, `debian:bookworm-slim` runtime with `libunbound8`;
`coredns/coredns:1.12`; `nginx:1.27-alpine`; `internetsystemsconsortium/bind9:9.20` for bootstrap
tools); the subnet if `172.30.97.0/24` collides; how `labgen` is populated on Docker Desktop (named
volume, not a bind mount, to avoid Windows permission and line-ending issues).
