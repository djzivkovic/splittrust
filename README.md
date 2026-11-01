# SplitTrust

**Who may answer for a domain inside a network: an implementation and test lab for [RFC 9704](https://www.rfc-editor.org/rfc/rfc9704).**
Team NXDOMAIN, DNS SEC(urity) Hackathon 2026.

Companies need private DNS views for services such as GitLab. A network announcing a resolver does not
prove that the domain owner authorized it to provide that view. RFC 9704 lets a client authenticate
the owner's permission and use the local resolver only for the approved names.
SplitTrust implements that check, puts it on an ordinary DNS path through a proxy, and provides owner
tooling, a reproducible lab, test vectors and an analysis of the RFC's worked example.

> The presentation and playground follow one employee's private GitLab bookmark across office and hotel
> networks. The playground uses the lab's private DNSSEC chain (`trust_context: "lab"`); the slides are
> illustrations, not measured results. The CLI/API also retain the real-zone cases for DNSSEC-signed
> `zivkovic.me`, validated against public DNS with `trust_context: "global"`.

## What is in the box

| Piece | What it does |
|---|---|
| `splittrust` (one Go binary) | RFC 9704 verifier: claim canonicalisation, token, Verification Record lookup with local DNSSEC validation (libunbound) through the network's resolver or iteratively, the §6.1 external-resolver path for devices configured that way, resolver TLS identity (RFC 9525), §7 `ds` key binding over `resolver.arpa.`, grants with TTL/RRSIG/PvD-bounded expiry; scoped resolution; **a Do53 proxy so ordinary stubs resolve through the verdicts**; owner tool; DHCP option 90/11 codec; CLI, HTTP API and the embedded demo deck |
| `lab/` | Docker Compose lab: CoreDNS hybrid resolvers for the office (`dns.splittrust.zivkovic.me` / `dns.corp.lab`, DoT, plus UnsecureCompany's plain-DNS resolver) and the hotel (`dns.hotel.lab`: honest, forging and plain views), both with Internet access; BIND serving a signed private root, `lab` TLD and seven parent zones (one expired, one unsigned); nginx PvD server; unbound as `quad9.lab`; web servers for both intranets and the hotel's fake page; a plain client and its twin without SplitTrust; a one-shot bootstrap that regenerates keys, zones and certificates |
| Three real-domain scenes + twelve lab scenarios × three simulated devices | demo: `real-office`, `real-hotel-forged`, `real-replay` (SecureCompany's real zone `zivkovic.me`); terminal story: `gitlab-office`, `gitlab-hotel`; corner cases: `legit`, `hotel`, `hotel-forged`, `stale-salt`, `expired-signature`, `unsigned`, `wrong-ds`, `replay`, `hotel-blocks-external`, `special-use`; devices `validating-stub`, `private-dns`, `hybrid` |
| `vectors/` | Published test vectors: token encoding (incl. the RFC example under both salts, `*`, IDN, SHA-512), TXT parsing, DHCP payloads, PvD documents, expected verdicts |
| `docs/rfc9704-example-erratum.md` | The forensic explanation of the RFC's broken §5.1 example, a second erratum for Figure 1, and eight points the RFC leaves to implementers |
| `docs/demo.md` | The presentation script, separate playground handoff, and Q&A cards |
| `docs/architecture.md` | What the tool does exactly, how the Docker lab is built, and how a request travels through the code |

## The console

`http://127.0.0.1:8000` is the presentation. The **ten-slide main pitch** is: title, split-horizon DNS
(the background), private-DNS problem, how owner authorization works, office example, hotel example,
company configuration/copied claim, working deliverables, reproducible evidence, and closing. The spoken
text is `docs/speech.md`. The footer counts the main pitch separately
from the **nine-slide appendix**: historical context, detailed architecture, proxy rules, inventory,
beneficiaries/deployers, complementary protections, deployment, owner-record format, and one concrete pilot.
HTTPS, encrypted DNS, DNSSEC and VPNs are explained as complementary tools, not a winner/loser scorecard.
The historical February 2025 implementation report is not presented as a current novelty claim.
The examples compare the **same employee and `git.dev.corp.lab` bookmark** under two DNS policies:
trust network DNS directly, or use SplitTrust to verify a scoped local exception. The office view
explains legitimate private access. At the hotel, an authenticated missing-record response establishes
that the hotel has no authorization; a separate forged GitLab answer then fails DNSSEC. Validation is
shown at the client-side proxy, never at the public-DNS cloud. The copied-claim example distinguishes
the resolver's DNS-over-TLS certificate from GitLab's HTTPS certificate.

The presentation is **explanation-only**: no device switch, live browser frames, resolver-decision logs,
health probes, or live record builder. Visiting or navigating any slide makes **no API requests** and
does not query DNS, run Docker commands, or change the proxy's network. Left/right arrows navigate;
the timeline and comparison buttons change local explanatory content only. The examples animate packets
and reveal checks using a local, explanatory sequence, not live results. Each step lasts about 2.1 seconds,
with active-path highlighting and a reading pause after packet travel. **Replay illustration** or
**space** restarts the sequence; reduced-motion preferences show the completed illustration instead.
The old `1`, `2`, `t` and `e` device/evidence controls remain removed. The closing **Try it yourself** link explicitly opens `/demo`,
where the real command runner and owner tool remain.

For slides alone, run `npm run dev` from `web` or serve the built frontend as static files; Docker
and the API are not required. The separate playground needs the running lab.

The console is React + Vite + Tailwind in `web/`, built in the image's first stage and embedded into the Go
binary; the committed `internal/api/web/dist` is a convenience for `go build` on hosts without Node
(`cd web && npm ci && npm run build` regenerates it). Everything else (all fifteen scenarios, every
option, raw JSON) is reachable through the CLI and the HTTP API.

### Try it yourself

The closing slide links to `http://127.0.0.1:8000/demo`, a standalone playground. Its default
**Live terminal** tab tells one story: SecureCompany hosts GitLab privately so its source code stays
on the company network. Employees use **`git.dev.corp.lab`** at the office or over the corporate VPN.
Public DNS has no address for it; an authorized office resolver supplies the private view. DNS chooses
the address, while network controls and application authentication enforce access. A hotel must not
gain authority over that name merely by supplying Wi-Fi DNS.

Three ordered presets run real commands inside the Docker **app** container:

| Preset | Actual commands and evidence |
|---|---|
| Office: open GitLab | `dig @172.30.97.10 git.dev.corp.lab A +dnssec` gets an authoritative public-view NXDOMAIN. Then `dig @172.30.97.63 git.dev.corp.lab A +dnssec` gets the validated private address through the proxy's `gitlab-office` profile. `curl --resolve` uses that actual address to fetch the `INTERNAL GITLAB` page. The report compares both observed DNS views. |
| Hotel: trust the Wi-Fi | `dig @172.30.97.21 git.dev.corp.lab A` gets the hotel's fake address. `curl --resolve` visits that address using the same hostname. A successful attack requires the actual `FAKE PAGE / GITLAB LOGIN` response. No DNSSEC or RFC 9704 check is performed. |
| Hotel: verify with SplitTrust | `dig @172.30.97.63 git.dev.corp.lab A +dnssec` queries the proxy's `gitlab-hotel` profile. The company's signed DNS does not authorize the hotel resolver; its invented answer produces `SERVFAIL` and Extended DNS Error 6 (DNSSEC Bogus). No HTTP request is made. |

The pages are small HTTP stand-ins, not a GitLab installation, and collect no credentials. Blocking the
hotel redirect does not provide VPN connectivity: the employee still needs the corporate VPN to reach
the real private repository. The new `dev.corp.lab` view is separate from the deck's existing names.

The terminal shows captured stdout, stderr, exit codes and timing after each run completes. The report
below it uses that same DNS response and the proxy's status and events from the actual lookup, not
a separate CLI verification or a scripted outcome. `dig` is an ordinary client: **the proxy performs
the validation**. `+dnssec` requests DNSSEC data, while AD reports the trusted lab proxy's assertion.
Even a `SERVFAIL` response can have process exit code 0; only matching DNSSEC-Bogus evidence counts as a blocked attack.
Missing tools, timeouts, incomplete output and unexpected results remain **inconclusive**. This is an
HTTP DNS-redirection lab, **not an HTTPS certificate bypass**, and plain `dig` does not validate DNSSEC.
All three presets use the private lab trust environment and need no public DNS or HTTP traffic.
The separate `demo-proxy` container has no published port or egress network. Before each protected run,
the backend switches that proxy's lab profile and clears its grants using its existing control API.
The presentation's `proxy` service is never switched by terminal runs.

Compose explicitly enables these endpoints with `SPLITTRUST_DEMO_COMMANDS=1`; otherwise they return
503. `GET /api/demo/presets` lists the presets and `POST /api/demo/run` accepts only
`{"preset_id":"hotel-unverified"}` (or another listed ID). No caller-supplied commands or targets, shell,
Docker socket, or `docker exec` endpoint are exposed. Only one run is allowed at a time (409 if busy),
with a 35-second deadline and 64 KiB per output stream. HTTP follow-up is restricted to the two configured
lab web-server IPs. Keep this demonstration service local, as the Compose localhost port binding does.

The generic scenario-picker tab is intentionally omitted from the presentation playground. All scenarios,
device profiles and full verifier reports remain available through the CLI and HTTP API.

The **Build a record** tab uses the existing owner API to generate a TXT line and claim JSON. It does
not publish DNS records or establish authorization, and its signing-status warning remains visible.
Editing a field clears the previous output so it cannot be mistaken for the new claim's record.
Use **Back to presentation** to return to the title, or **Go to appendix** to open its first slide
directly at `/#appendix`. Reloading that URL keeps the appendix entry point; Home returns to the main pitch.

The presentation's browser regression check catches clipped diagram labels at 1366×768 and 1280×720.
From `web`, run `npm ci`, `npx playwright install chromium`, then `npm run test:presentation`.
It starts and stops its own local frontend and supplies API responses at the network boundary, so no DNS
lab is needed for the layout, navigation, command-transcript, playground-result and owner-form regression checks.
The presentation check visits all 18 slides with `/api/*` blocked and verifies that no requests are attempted.
Geometry checks cover label clipping and clearance between the architecture boxes and public-zone cloud.

## Run it (Docker only; macOS, Windows or Linux)

```bash
docker compose -f lab/compose.yaml up --build -d           # builds the images and generates the lab (first time ~3-5 min)
open http://127.0.0.1:8000                                  # the console
docker compose -f lab/compose.yaml exec app splittrust scenarios
docker compose -f lab/compose.yaml exec app splittrust verify --scenario real-hotel-forged
docker compose -f lab/compose.yaml exec app splittrust verify --scenario unsigned --device private-dns
docker compose -f lab/compose.yaml exec app splittrust resolve --scenario real-office --name host.internal.splittrust.zivkovic.me
docker compose -f lab/compose.yaml --profile tools run --rm test   # integration suite against the running lab
docker compose -f lab/compose.yaml down -v                  # remove everything, including generated keys
```

Requirements: Docker Engine 26+ with Compose v2 (Docker Desktop or Rancher Desktop). No Go, Python or
Node on the host. The lab regenerates its keys and signatures when they are older than 20 h; `down -v`
forces a fresh generation.

When upgrading an existing lab to the GitLab story, a new generation is required for its profiles,
signed private zone and hotel override. Rebuild the images, stop **this Compose project's** DNS/app
services, run its bootstrap with `FORCE=1`, then start the services again. Do not regenerate keys
under running DNS servers: their loaded certificates and trust anchors would no longer match.

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
| `gitlab-office` (private GitLab) | accepted `AUTHORIZED` | | |
| `gitlab-hotel` (hotel claims developer services) | rejected `RECORD_MISSING` | | |
| `real-office` (SecureCompany's office, real zone) | accepted `AUTHORIZED` | accepted `EXTERNAL_TOKEN_MATCH` (AD=1 from the real dns.quad9.net) | accepted |
| `real-hotel-forged` (hotel claims SecureCompany's domain) | rejected `DNSSEC_BOGUS` | rejected `RECORD_MISSING` | |
| `real-replay` (hotel replays SecureCompany's claim) | rejected `TLS_IDENTITY_FAILED` | | |

## No CLI needed: the DNS front door

`splittrust proxy` is a plain-DNS (Do53) forwarding resolver any stub can be pointed at. In the lab a
client container with **no SplitTrust code** gets it as its DNS server; its naive twin gets the hotel's DNS:

```bash
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.splittrust.zivkovic.me   # SecureCompany's intranet page
docker compose -f lab/compose.yaml exec client dig host.internal.splittrust.zivkovic.me +dnssec      # EDE: authorised resolver
# move the client to the hotel Wi-Fi (the Demo page does this when you change scene):
docker compose -f lab/compose.yaml exec client curl -s -X POST http://172.30.97.60:8001/join -d '{"scenario_id":"real-hotel-forged"}'
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.splittrust.zivkovic.me   # cannot resolve: SERVFAIL, EDE 6 DNSSEC Bogus
docker compose -f lab/compose.yaml exec naive  curl -s http://intranet.unsecure.example                   # "FAKE PAGE ... served by the hotel resolver"
docker compose -f lab/compose.yaml exec client curl -s -X POST http://172.30.97.60:8001/join -d '{"scenario_id":"real-hotel-forged","device":"private-dns"}'
docker compose -f lab/compose.yaml exec client dig +short zivkovic.me                                 # the real Cloudflare addresses, via dns.quad9.net
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

## The real domain

SecureCompany's zone is `zivkovic.me` at Cloudflare: DNSSEC-signed, DS at the `.me` registry, and this record published:

```
dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me. 300 IN TXT "token=BiwP_K0bA7xckVbslagu9l-Ku9PgYkSCem6r_GbySJHqpQF1gXmxOT0AjCFqOIGi"
```

The office resolver, the hotel resolver, the app and the proxy have Internet access (compose network
`egress`), so SecureCompany's device validates under the IANA root trust anchor (`dns-root-data`) through the
network's resolver, exactly as RFC 9704 Figure 4 describes, and the phone profile asks the real
`dns.quad9.net`. The announced office resolver is the lab's (`dns.splittrust.zivkovic.me` is a SAN of its
certificate); the hotel's forged copy of the zone is served by the lab's hotel resolver. Company UnsecureCompany's
domain is `unsecure.example` (RFC 2606); it has no scenario because it verifies nothing. The claim's salt is
fixed in the catalogue so the published record stays valid across lab rebuilds. Only ordinary DNS queries
and one HTTPS request to our own site leave the machine. The lab's private root and `.lab` zones remain
for the corner cases; those scenarios run without Internet.

## What this is not

- Not an OS integration: nothing intercepts the host's DNS; protection applies to clients that use the SplitTrust proxy (or the CLI) as their resolver.
- Not DHCP/RA discovery: discovery is pre-configured per scenario; the DHCP option is encoded and decoded, not sent.
- The hotel and office networks are containers; what is real is SecureCompany's zone, the DNS it is validated against, and the resolver the phone uses. Rejecting a claim does not make an untrusted default resolver safe; publishing a record protects only clients that implement the check.
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
internal/democmd      preset-only lab command runner, bounded output and observed outcomes
internal/api          HTTP API, /api/browse, /api/live, embedded deck   internal/lab  scenario catalogue + manifest
web/                  the demo deck: React + Vite + Tailwind + framer-motion
internal/labgen       lab artefacts the engine must make   internal/vectors  published vectors + forensics
lab/                  compose, Dockerfiles, bootstrap, CoreDNS/nginx/unbound configs
tests/integration     runs inside the lab (compose "test" service)
docs/                 design, plan, comparison, erratum, demo, research
```

Licence: MIT. Built with AI assistance (Devin) under the direction of the team, as the hackathon rules allow.
