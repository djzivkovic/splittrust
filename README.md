# SplitTrust

An implementation of [RFC 9704](https://www.rfc-editor.org/rfc/rfc9704) (split-horizon DNS with the
domain owner's permission), with a DNS proxy that enforces it, an owner tool, and a Docker lab to
attack it. Team NXDOMAIN, DNS SEC(urity) Hackathon 2026.

Companies run private DNS views for internal services, say a GitLab at `git.dev.corp.lab`. A network
can announce a resolver and claim to answer for those names, but nothing lets the device check that the
company agreed. RFC 9704 fixes that: the owner publishes a signed Verification Record, the network makes
its claim, and the client checks the resolver's certificate, the record and the token before it routes
those names there. SplitTrust is that check, put on an ordinary DNS path.

## What is here

| Piece | What it does |
|---|---|
| `splittrust` (one Go binary) | The verifier (claim and token, DoT identity per RFC 9525, DNSSEC validation with libunbound, the §6.1 external-resolver path, §7 `ds` key binding, grants with bounded expiry), a Do53 proxy so ordinary stubs resolve through the verdicts, the owner's record tool, a DHCP option 90/11 codec, CLI, HTTP API and the embedded presentation |
| `lab/` | Docker Compose: CoreDNS resolvers for the office and the hotel (honest, forging and plain views), BIND with a signed private root and seven parent zones, an nginx PvD server, unbound as `quad9.lab`, the two companies' internal hosts on a 10.20.0.0/24 LAN, the hotel's fake page, plain clients |
| `internal/lab/scenarios.json` | Fifteen scenarios across three device profiles: the GitLab story, three real-domain scenes against our own signed zone `zivkovic.me`, and the RFC's corner cases (stale salt, expired signatures, unsigned zone, wrong key, replayed claim, blocked external resolver, special-use names) |
| `vectors/` | Test vectors: token encoding (including the RFC's example under both salts), TXT parsing, DHCP payloads, PvD documents, expected verdicts |
| `docs/` | `speech.md` (what to say), `demo.md` (script and Q&A), `SplitTrust-pitch.pptx`, `architecture.md`, and `rfc9704-example-erratum.md` on the RFC's worked example |

## Run it

Docker Engine 26+ with Compose v2 is all you need on the host.

```bash
docker compose -f lab/compose.yaml up --build -d        # first time: 3 to 5 minutes
open http://127.0.0.1:8000                               # the presentation; /demo is the live playground
docker compose -f lab/compose.yaml exec app splittrust scenarios
docker compose -f lab/compose.yaml exec app splittrust verify --scenario gitlab-hotel
docker compose -f lab/compose.yaml exec app splittrust verify --scenario unsigned --device private-dns
docker compose -f lab/compose.yaml --profile tools run --rm test    # integration suite
docker compose -f lab/compose.yaml down -v
```

Without Docker, the pure parts run with Go 1.26 or newer:

```bash
go run ./cmd/splittrust inspect --claim examples/firma-claim.json
go run ./cmd/splittrust build-record --input examples/owner-request.json
go run ./cmd/splittrust vectors
go test ./...
```

## The presentation

`http://127.0.0.1:8000` is a ten-slide pitch followed by a nine-slide appendix. The slides are
illustrations and make no requests; they work without the lab (`cd web && npm run dev`). The spoken text
is `docs/speech.md`; `docs/SplitTrust-pitch.pptx` is the same ten slides with the speech as speaker notes
(`cd web && npm run build && npm run export:pptx` regenerates it).

The closing slide links to `/demo`, a playground that runs real `dig` and `curl` commands inside the lab
for one bookmark, `git.dev.corp.lab`: at the office (public NXDOMAIN, validated private answer
`10.20.0.10`, the GitLab stand-in page), at the hotel without protection (the fake login stand-in), and at
the hotel through the proxy (`SERVFAIL`, Extended DNS Error 6). The pages are plain-HTTP stand-ins that
collect nothing; this is a DNS redirection lab, not an HTTPS bypass. A second tab builds a Verification
Record from a claim.

Browser tests: `cd web && npm ci && npx playwright install chromium && npm run test:presentation`.

## How a verification runs

```
pvd -> claim -> token -> resolver_tls -> public_dnssec -> external_resolver -> record -> ds -> grant
```

The claim comes from a PvD document (RFC 8801) or is configured. Names are canonicalised, special-use
names rejected, and the token computed as `hash(len(salt) || salt || X)` (§5). The announced resolver
must present a certificate for its name over DoT before anything it says is used (§8). The Verification
Record is validated with DNSSEC, either locally through the network's resolver (§6.2) or through the
device's own external encrypted resolver (§6.1). Token and `ds` are read from the same TXT record; a
published `ds` that does not match the resolver's key is a rejection, not a downgrade (§7). A grant
expires with the TTL, the RRSIG or the PvD document, whichever comes first.

## Expected outcomes

| Scenario | `validating-stub` | `private-dns` | `hybrid` |
|---|---|---|---|
| `gitlab-office` | accepted `AUTHORIZED` | | |
| `gitlab-hotel` | rejected `RECORD_MISSING` | | |
| `legit` | accepted `AUTHORIZED` (two claims) | | accepted |
| `hotel` | rejected `RECORD_MISSING` | rejected `RECORD_MISSING` | |
| `hotel-forged` | rejected `DNSSEC_BOGUS` | | |
| `stale-salt` | rejected `TOKEN_MISMATCH` | | |
| `expired-signature` | rejected `DNSSEC_BOGUS` | | |
| `unsigned` | rejected `DNSSEC_INSECURE_NO_FALLBACK` | accepted `EXTERNAL_TOKEN_MATCH` | accepted |
| `wrong-ds` | rejected `DS_MISMATCH` | | |
| `replay` | rejected `TLS_IDENTITY_FAILED` | | |
| `hotel-blocks-external` | | rejected `EXTERNAL_TIMEOUT` | |
| `special-use` | rejected `SPECIAL_USE_NAME`, no traffic | | |
| `real-office` (zivkovic.me) | accepted `AUTHORIZED` | accepted `EXTERNAL_TOKEN_MATCH` | accepted |
| `real-hotel-forged` | rejected `DNSSEC_BOGUS` | rejected `RECORD_MISSING` | |
| `real-replay` | rejected `TLS_IDENTITY_FAILED` | | |

## The proxy

`splittrust proxy` is a plain-DNS forwarding resolver any stub can point at. Inside a verified claim,
queries go over authenticated DoT to the authorised resolver and are validated under the delegated key;
outside, they take the device's default path. Rejected claims never route a query; Bogus answers become
`SERVFAIL` with an Extended DNS Error (RFC 8914). `GET /status` and `POST /join` on port 8001 move the
simulated client between networks. In the lab the `client` container has the proxy as its DNS server and
no SplitTrust code of its own:

```bash
docker compose -f lab/compose.yaml exec client dig host.internal.splittrust.zivkovic.me +dnssec
docker compose -f lab/compose.yaml exec client curl -s -X POST http://172.30.97.60:8001/join -d '{"scenario_id":"real-hotel-forged"}'
docker compose -f lab/compose.yaml exec client dig host.internal.splittrust.zivkovic.me +dnssec   # SERVFAIL, EDE 6
```

## The real domain

`zivkovic.me` is ours: DNSSEC-signed at Cloudflare, DS at the `.me` registry, with this record published:

```
dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me. 300 IN TXT "token=BiwP_K0bA7xckVbslagu9l-Ku9PgYkSCem6r_GbySJHqpQF1gXmxOT0AjCFqOIGi"
```

The `real-*` scenarios validate under the IANA root through the lab's resolvers, and the phone profile
asks the real `dns.quad9.net`. Only ordinary DNS queries leave the machine. Everything else runs on the
lab's private root and needs no Internet.

## Limits

- Not an OS integration: protection applies to clients that use the proxy (or the CLI) as their resolver.
- Discovery is configured per scenario; the DHCP option is encoded and decoded, not sent on the wire.
- The networks are containers. Rejecting a claim does not make an untrusted default resolver safe, and a published record protects only clients that perform the check.
- The binary needs `-tags libunbound` to validate (the image always has it); without it the pure packages build and test, but nothing validates.

## Layout

```
cmd/splittrust      CLI: inspect, build-record, verify, resolve, scenarios, dhcp, vectors, serve, proxy
internal/claim      canonical form, RFC 4034 order, $X, token, record owner, special-use list
internal/txtrec     Verification Record codec          internal/dhcp     option 90/11 codec
internal/pvd        RFC 8801 fetch and validate         internal/dot      DoT client, RFC 9525 identity
internal/validate   libunbound (cgo)                    internal/verify   the pipeline, ds binding, local validation
internal/route      scoped resolution                   internal/proxy    Do53 front door, grant cache, EDE
internal/engine     wiring shared by CLI, API and proxy internal/democmd  the playground's command runner
internal/api        HTTP API and the embedded web app   internal/lab      scenario catalogue and manifest
internal/labgen     generated lab artefacts             internal/vectors  published vectors
web/                React + Vite + Tailwind             lab/              compose, Dockerfiles, bootstrap, configs
tests/integration   runs inside the lab
```

Licence: MIT.
