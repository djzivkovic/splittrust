# SplitTrust

**Who may answer for a domain inside a network: an implementation and test lab for [RFC 9704](https://www.rfc-editor.org/rfc/rfc9704).**
Team NXDOMAIN, DNS SEC(urity) Hackathon 2026.

A hotel Wi-Fi can tell your device "my resolver is authoritative for `banka.rs`". Nothing today proves the
bank agreed, and encrypting DNS does not help when you are talking to the wrong server. RFC 9704 lets the
domain owner publish a signed statement of *which resolver may answer for which names*, and lets the device
check it in a way the local network cannot tamper with. The standard had no public implementation, no test
vectors, and a worked example that cannot be reproduced. SplitTrust provides all three.

> Every verdict carries `trust_context: "lab"`: the lab runs a private DNS root with a real DNSSEC chain;
> the cryptography and the verdicts are real, the Internet is simulated and nothing leaves the lab, except
> the one `real-zivkovic` scenario, which carries `trust_context: "global"` and runs in a separate
> egress-enabled container against our own real zone.

## What is in the box

| Piece | What it does |
|---|---|
| `splittrust` (one Go binary) | RFC 9704 verifier: claim canonicalisation, token, Verification Record lookup with local DNSSEC validation (libunbound) through the network's resolver or iteratively, the §6.1 external-resolver path for devices configured that way, resolver TLS identity (RFC 9525), §7 `ds` key binding over `resolver.arpa.`, grants with TTL/RRSIG/PvD-bounded expiry; scoped resolution; **a Do53 proxy so ordinary stubs resolve through the verdicts**; owner tool; DHCP option 90/11 codec; CLI, HTTP API and the embedded animated console |
| `lab/` | Docker Compose lab: BIND serving a signed private root, `lab` TLD and seven parent zones (one expired, one unsigned); CoreDNS hybrid resolvers for the company (`dns.corp.lab`, DoT) and the hotel (`dns.hotel.lab`, honest and *forging* views); nginx PvD server; unbound as `quad9.lab`; a one-shot bootstrap that regenerates keys, zones and certificates relative to now |
| Ten lab scenarios + one real-DNS scenario × three simulated devices | `legit`, `hotel`, `hotel-forged`, `stale-salt`, `expired-signature`, `unsigned`, `wrong-ds`, `replay`, `hotel-blocks-external`, `special-use`, `real-zivkovic`; devices `validating-stub`, `private-dns`, `hybrid` |
| `vectors/` | Published test vectors: token encoding (incl. the RFC example under both salts, `*`, IDN, SHA-512), TXT parsing, DHCP payloads, PvD documents, expected verdicts |
| `docs/rfc9704-example-erratum.md` | The forensic explanation of the RFC's broken §5.1 example, a second erratum for Figure 1, and eight points the RFC leaves to implementers |
| `docs/demo.md` | The 5-minute demo script and Q&A cards |
| `docs/architecture.md` | What the tool does exactly, how the Docker lab is built, and how a request travels through the code |

## The console

`http://127.0.0.1:8000` has three pages:

- **Demo** (the presentation): guided scenes, one real situation at a time, five full-screen steps each.
  1 Situation (who you are, what the network announces, what is actually true); 2 What the network sent (the
  PvD document verbatim and the token the device derives from it); 3 What the device checks (the query
  animated on a map of the actors, with a plain-language checklist); 4 Verdict and evidence (the
  consequence in one sentence, the query as `dig` would show it, the resolver's certificate next to the
  announced name); 5 Proof (two devices open the page: one without SplitTrust, one with). Keys: left/right
  arrows move through steps and scenes, `1 2 3` switch the device, `space` replays, `n` shows presenter notes.
- **Tools**: the same engine with every option exposed (verify, resolve, inspect a claim, build a record, the
  DNS proxy's status) and the raw JSON.
- **How it works**: what the project does, what the lab is, how to present, limits.

The console is React + Vite + Tailwind in `web/`, built in the image's first stage and embedded into the Go
binary; the committed `internal/api/web/dist` is a convenience for `go build` on hosts without Node
(`cd web && npm ci && npm run build` regenerates it).

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

1. **pvd**: RFC 8801 Additional Information over HTTPS (certificate = PvD ID, no redirects, 64 KiB cap, `application/pvd+json`); every `splitDnsClaims` entry is verified independently.
2. **claim**: canonical names (lowercase, IDNA), RFC 6761 special-use names rejected, lab scope enforced, and the claim's resolver must be an ADN the network announced via DNR (with DDR the certificate alone binds).
3. **token**: RFC 9704 §5 literally: `hash(len(salt) || salt || X)`.
4. **resolver_tls**: authenticate the announced resolver by name over DoT before trusting anything it says (RFC 9704 §8).
5. **public_dnssec** (`validating-stub`, `hybrid`): the Verification Record, validated locally with libunbound, forwarding over the authenticated DoT connection to the network's resolver (RFC 9704 Figure 4) or iterating from the root. Secure / Bogus / Insecure / Indeterminate decide (§6.2).
6. **external_resolver** (`private-dns`; `hybrid` after Insecure): the same record through the device's external encrypted resolver (§6.1); no answer ⇒ failed.
7. **record**: per-RR parsing; token and `ds` only ever from the same RR.
8. **ds**: §7: DNSKEY `resolver.arpa.` over DoT, DS recomputed over `resolver.arpa.`, full RDATA compared; no silent downgrade to token-only when a published `ds` does not match.
9. **grant**: expiry = min(TTL, RRSIG expiration, PvD expiry).

`resolve` then shows what the grant is for: names inside it go to the authorised resolver and the answer is
validated under the delegated keys; everything else takes the device's default path.

## Expected outcomes

| Scenario | `validating-stub` | `private-dns` | `hybrid` |
|---|---|---|---|
| `legit` | accepted (`AUTHORIZED`, two claims; claim 1 delegated, claim 2 token-only) | | accepted |
| `hotel` | rejected `RECORD_MISSING` | rejected `RECORD_MISSING` | |
| `hotel-forged` | rejected `DNSSEC_BOGUS` (correct token, no signature chain) | | |
| `stale-salt` | rejected `TOKEN_MISMATCH` | | |
| `expired-signature` | rejected `DNSSEC_BOGUS` | | |
| `unsigned` | rejected `DNSSEC_INSECURE_NO_FALLBACK` | accepted `EXTERNAL_TOKEN_MATCH` (yellow) | accepted (yellow) |
| `wrong-ds` | rejected `DS_MISMATCH` | | |
| `replay` | rejected `TLS_IDENTITY_FAILED` | | |
| `hotel-blocks-external` | | rejected `EXTERNAL_TIMEOUT` | |
| `special-use` | rejected `SPECIAL_USE_NAME`, no traffic | | |
| `real-zivkovic` (real DNS, see below) | accepted `AUTHORIZED` once `zivkovic.me` is DNSSEC-signed; `DNSSEC_INSECURE_NO_FALLBACK` while it is not | accepted `EXTERNAL_TOKEN_MATCH` via the real `dns.quad9.net` | |

## No CLI needed: the DNS front door

`splittrust proxy` is a plain-DNS (Do53) forwarding resolver any stub can be pointed at. In the lab a
client container with **no SplitTrust code** gets it as its DNS server; its naive twin gets the hotel's DNS:

```bash
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.corp.lab   # company intranet page, AD=1
docker compose -f lab/compose.yaml exec client dig host.internal.corp.lab +dnssec      # flags: ... ad; EDE: validated under the delegated key
# move the client to the hotel Wi-Fi (also a dropdown in the console):
docker compose -f lab/compose.yaml exec client curl -s -X POST http://172.30.97.60:8001/join -d '{"scenario_id":"hotel"}'
docker compose -f lab/compose.yaml exec client curl -s http://www.banka.lab              # cannot resolve: SERVFAIL, EDE 6 DNSSEC Bogus
docker compose -f lab/compose.yaml exec naive  curl -s http://www.banka.lab              # "FAKE www.banka.lab served by the hotel ... password :)"
docker compose -f lab/compose.yaml exec client curl -s -X POST http://172.30.97.60:8001/join -d '{"scenario_id":"hotel","device":"private-dns"}'
docker compose -f lab/compose.yaml exec client curl -s http://www.banka.lab              # "REAL www.banka.lab" via quad9.lab
```

Per query: inside a verified claim → authenticated DoT to the authorised resolver, validated under the
delegated key when one exists (`AD=1`), token-only authority answers with `AD=0`; outside → the device's
default path (local DNSSEC validation, or the external DoT resolver for `private-dns`); Bogus →
`SERVFAIL`. Rejected claims never route a query. Grants are cached and re-verified before they expire
(RFC 9704 §11); verdicts are explained to EDNS clients as Extended DNS Errors (RFC 8914). Names outside
the lab namespaces are `REFUSED` without any traffic. `GET /status` and `POST /join` on `:8001` move
the simulated client between networks; the console mirrors them under "Client on the network".

On a real host this is the dnscrypt-proxy/stubby pattern (point the OS resolver at `127.0.0.1`); we
document it, we do not do it on stage. Driving the OS's own split-DNS machinery instead (systemd-resolved
per-domain DoT + DNSSEC, Windows NRPT, macOS `/etc/resolver`) is the natural next step for a product.

## The one scenario that leaves the lab

`real-zivkovic` verifies a Verification Record published in the **real** zone `zivkovic.me` (Cloudflare):

```
dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me. 3600 IN TXT "token=BiwP_K0bA7xckVbslagu9l-Ku9PgYkSCem6r_GbySJHqpQF1gXmxOT0AjCFqOIGi"
```

The device validates under the IANA root trust anchor (`dns-root-data`), iterating from the real root
because the lab's resolver has no Internet access, and the `private-dns` device asks the real
`dns.quad9.net`. The announced resolver is still the lab's `dns.splittrust.zivkovic.me` (local-dot). It
runs only in the egress-enabled `real` service; the console and the `app` container stay offline:

```bash
docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic
docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic --device private-dns
```

Its reports carry `trust_context: "global"`. The claim's salt is fixed in the catalogue so the published
record stays valid across lab rebuilds. Only ordinary DNS queries leave the machine; the zone is ours.

## What this is not

- Not an OS integration: nothing intercepts the host's DNS; protection applies to clients that use the SplitTrust proxy (or the CLI) as their resolver.
- Not DHCP/RA discovery: discovery is pre-configured per scenario; the DHCP option is encoded and decoded, not sent.
- Not the global DNS: verdicts are about a private root the lab controls. Rejecting a claim does not make an untrusted default resolver safe; publishing a record protects only clients that implement the check.
- The binary must be built with `-tags libunbound` (the image always is); without it the pure packages still build and test, but nothing validates.

## Repository map

```
cmd/splittrust        CLI (inspect, build-record, verify, resolve, scenarios, dhcp, vectors, lab-init, serve, proxy)
internal/claim        canonical form, RFC 4034 order, $X, token, record owner, special-use list
internal/txtrec       Verification Record TXT codec        internal/dhcp     option 90/11 payload codec
internal/pvd          RFC 8801 fetch/validate              internal/dot      DoT client with RFC 9525 identity
internal/validate     libunbound (cgo, -tags libunbound)   internal/verify   the pipeline, ds binding, local validation
internal/route        scoped resolution                    internal/proxy    Do53 front door with grant cache + EDE
internal/engine       wiring shared by CLI, API and proxy
internal/api          HTTP API, /api/browse, embedded console (dist)   internal/lab  scenario catalogue + manifest
web/                  the console: React + Vite + Tailwind + framer-motion (Demo, Tools, How it works)
internal/labgen       lab artefacts the engine must make   internal/vectors  published vectors + forensics
lab/                  compose, Dockerfiles, bootstrap, CoreDNS/nginx/unbound configs
tests/integration     runs inside the lab (compose "test" service)
docs/                 design, plan, comparison, erratum, demo, research
```

Licence: MIT. Built with AI assistance (Devin) under the direction of the team, as the hackathon rules allow.
