# SplitTrust

**Who may answer for a domain inside a network — an implementation and test lab for [RFC 9704](https://www.rfc-editor.org/rfc/rfc9704).**
Team NXDOMAIN, DNS SEC(urity) Hackathon 2026.

A hotel Wi-Fi can tell your device "my resolver is authoritative for `banka.rs`". Nothing today proves the
bank agreed, and encrypting DNS does not help when you are talking to the wrong server. RFC 9704 lets the
domain owner publish a signed statement of *which resolver may answer for which names*, and lets the device
check it in a way the local network cannot tamper with. The standard had no public implementation, no test
vectors, and a worked example that cannot be reproduced. SplitTrust provides all three.

> Every verdict carries `trust_context: "lab"` — the lab runs a private DNS root with a real DNSSEC chain;
> the cryptography and the verdicts are real, the Internet is simulated and nothing leaves the lab — except
> the one `real-zivkovic` scenario, which carries `trust_context: "global"` and runs in a separate
> egress-enabled container against our own real zone.

## What is in the box

| Piece | What it does |
|---|---|
| `splittrust` (one Go binary) | RFC 9704 verifier: claim canonicalisation, token, Verification Record lookup with local DNSSEC validation (libunbound) through the network's resolver or iteratively, the §6.1 external-resolver path for devices configured that way, resolver TLS identity (RFC 9525), §7 `ds` key binding over `resolver.arpa.`, grants with TTL/RRSIG/PvD-bounded expiry; scoped resolution; owner tool; DHCP option 90/11 codec; CLI, HTTP API and an embedded console |
| `lab/` | Docker Compose lab: BIND serving a signed private root, `lab` TLD and seven parent zones (one expired, one unsigned); CoreDNS hybrid resolvers for the company (`dns.corp.lab`, DoT) and the hotel (`dns.hotel.lab`, honest and *forging* views); nginx PvD server; unbound as `quad9.lab`; a one-shot bootstrap that regenerates keys, zones and certificates relative to now |
| Ten lab scenarios + one real-DNS scenario × three simulated devices | `legit`, `hotel`, `hotel-forged`, `stale-salt`, `expired-signature`, `unsigned`, `wrong-ds`, `replay`, `hotel-blocks-external`, `special-use`, `real-zivkovic`; devices `validating-stub`, `private-dns`, `hybrid` |
| `vectors/` | Published test vectors: token encoding (incl. the RFC example under both salts, `*`, IDN, SHA-512), TXT parsing, DHCP payloads, PvD documents, expected verdicts |
| `docs/rfc9704-example-erratum.md` | The forensic explanation of the RFC's broken §5.1 example, a second erratum for Figure 1, and eight points the RFC leaves to implementers |
| `docs/demo.md` | The 5-minute demo script and Q&A cards |

## Run it (Docker only; macOS, Windows or Linux)

```bash
docker compose -f lab/compose.yaml up --build -d           # builds the images and generates the lab (first time ~3-5 min)
open http://127.0.0.1:8000                                  # the console
docker compose -f lab/compose.yaml exec app splittrust scenarios
docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged
docker compose -f lab/compose.yaml exec app splittrust verify --scenario unsigned --device private-dns
docker compose -f lab/compose.yaml exec app splittrust resolve --scenario legit --name host.internal.corp.lab
docker compose -f lab/compose.yaml --profile tools run --rm test   # integration suite against the running lab
docker compose -f lab/compose.yaml down -v                  # remove everything, including generated keys
```

Requirements: Docker Engine 26+ with Compose v2 (Docker Desktop or Rancher Desktop). No Go, Python or
Node on the host. The lab regenerates its keys and signatures when they are older than 20 h; `down -v`
forces a fresh generation.

### Without the lab

The pure parts run anywhere with Go ≥ 1.26 (the floor set by our dependencies):

```bash
go run ./cmd/splittrust inspect --claim examples/firma-claim.json          # canonical form, token, record owner
go run ./cmd/splittrust build-record --input examples/owner-request.json   # owner tool
go run ./cmd/splittrust dhcp encode --claim examples/firma-claim.json      # option 90/11 payload
go run ./cmd/splittrust vectors                                            # the RFC 5.1 forensics
go test ./...
```

## How a verification runs

```
pvd → claim → token → resolver_tls → public_dnssec → external_resolver → record → ds → grant
```

1. **pvd** — RFC 8801 Additional Information over HTTPS (certificate = PvD ID, no redirects, 64 KiB cap, `application/pvd+json`); every `splitDnsClaims` entry is verified independently.
2. **claim** — canonical names (lowercase, IDNA), RFC 6761 special-use names rejected, lab scope enforced, and the claim's resolver must be an ADN the network announced via DNR (with DDR the certificate alone binds).
3. **token** — RFC 9704 §5 literally: `hash(len(salt) || salt || X)`.
4. **resolver_tls** — authenticate the announced resolver by name over DoT before trusting anything it says (RFC 9704 §8).
5. **public_dnssec** (`validating-stub`, `hybrid`) — the Verification Record, validated locally with libunbound, forwarding over the authenticated DoT connection to the network's resolver (RFC 9704 Figure 4) or iterating from the root. Secure / Bogus / Insecure / Indeterminate decide (§6.2).
6. **external_resolver** (`private-dns`; `hybrid` after Insecure) — the same record through the device's external encrypted resolver (§6.1); no answer ⇒ failed.
7. **record** — per-RR parsing; token and `ds` only ever from the same RR.
8. **ds** — §7: DNSKEY `resolver.arpa.` over DoT, DS recomputed over `resolver.arpa.`, full RDATA compared; no silent downgrade to token-only when a published `ds` does not match.
9. **grant** — expiry = min(TTL, RRSIG expiration, PvD expiry).

`resolve` then shows what the grant is for: names inside it go to the authorised resolver and the answer is
validated under the delegated keys; everything else takes the device's default path.

## Expected outcomes

| Scenario | `validating-stub` | `private-dns` | `hybrid` |
|---|---|---|---|
| `legit` | accepted (`AUTHORIZED`, two claims; claim 1 delegated, claim 2 token-only) | | accepted |
| `hotel` | rejected `RECORD_MISSING` | rejected `RECORD_MISSING` | |
| `hotel-forged` | rejected `DNSSEC_BOGUS` — correct token, no signature chain | | |
| `stale-salt` | rejected `TOKEN_MISMATCH` | | |
| `expired-signature` | rejected `DNSSEC_BOGUS` | | |
| `unsigned` | rejected `DNSSEC_INSECURE_NO_FALLBACK` | accepted `EXTERNAL_TOKEN_MATCH` (yellow) | accepted (yellow) |
| `wrong-ds` | rejected `DS_MISMATCH` | | |
| `replay` | rejected `TLS_IDENTITY_FAILED` | | |
| `hotel-blocks-external` | | rejected `EXTERNAL_TIMEOUT` | |
| `special-use` | rejected `SPECIAL_USE_NAME`, no traffic | | |
| `real-zivkovic` (real DNS, see below) | accepted `AUTHORIZED` once `zivkovic.me` is DNSSEC-signed; `DNSSEC_INSECURE_NO_FALLBACK` while it is not | accepted `EXTERNAL_TOKEN_MATCH` via the real `dns.quad9.net` | |

## The one scenario that leaves the lab

`real-zivkovic` verifies a Verification Record published in the **real** zone `zivkovic.me` (Cloudflare):

```
dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me. 3600 IN TXT "token=BiwP_K0bA7xckVbslagu9l-Ku9PgYkSCem6r_GbySJHqpQF1gXmxOT0AjCFqOIGi"
```

The device validates under the IANA root trust anchor (`dns-root-data`), iterating from the real root
because the lab's resolver has no Internet access, and the `private-dns` device asks the real
`dns.quad9.net`. The announced resolver is still the lab's `dns.splittrust.zivkovic.me` (local-dot). It
runs only in the egress-enabled `real` service — the console and the `app` container stay offline:

```bash
docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic
docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic --device private-dns
```

Its reports carry `trust_context: "global"`. The claim's salt is fixed in the catalogue so the published
record stays valid across lab rebuilds. Only ordinary DNS queries leave the machine; the zone is ours.

## What this is not

- Not an OS integration: nothing intercepts the host's DNS; protection applies to explicit `splittrust` queries.
- Not DHCP/RA discovery: discovery is pre-configured per scenario; the DHCP option is encoded and decoded, not sent.
- Not the global DNS: verdicts are about a private root the lab controls. Rejecting a claim does not make an untrusted default resolver safe; publishing a record protects only clients that implement the check.
- The `LIBUNBOUND=0` build is a code-level fallback, not an operational image: it needs an external validating unbound daemon (`SPLITTRUST_DAEMON=host:port`, lab trust anchor and root hints configured there) and supports iterative resolution only. The lab always builds with libunbound.

## Repository map

```
cmd/splittrust        CLI (inspect, build-record, verify, resolve, scenarios, dhcp, vectors, lab-init, serve)
internal/claim        canonical form, RFC 4034 order, $X, token, record owner, special-use list
internal/txtrec       Verification Record TXT codec        internal/dhcp     option 90/11 payload codec
internal/pvd          RFC 8801 fetch/validate              internal/dot      DoT client with RFC 9525 identity
internal/validate     libunbound (cgo) / daemon fallback   internal/verify   the pipeline, ds binding, local validation
internal/route        scoped resolution                    internal/engine   wiring shared by CLI and API
internal/api          HTTP API + embedded console          internal/lab      scenario catalogue + manifest
internal/labgen       lab artefacts the engine must make   internal/vectors  published vectors + forensics
lab/                  compose, Dockerfiles, bootstrap, CoreDNS/nginx/unbound configs
tests/integration     runs inside the lab (compose "test" service)
docs/                 design, plan, comparison, erratum, demo, research
```

Licence: MIT. Built with AI assistance (Devin) under the direction of the team, as the hackathon rules allow.
