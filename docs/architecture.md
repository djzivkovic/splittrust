# SplitTrust: how it is built

What the tool does exactly, how the Docker lab is put together, and how a request travels through
the code. Written against the code on `iradosavljevic/spec` at the end of the hackathon day; file
paths are real, numbers are from the running lab.

---

## 1. What the tool does

SplitTrust is an implementation of the **client side of RFC 9704** ("Establishing Local DNS Authority in
Validated Split-Horizon Environments"), plus the domain owner's publishing tool and a laboratory to run
it against.

A network (via DHCP or a PvD document) tells a device: "my resolver R is authoritative for these names
under domain P". RFC 9704 lets the device check that the owner of P agreed. SplitTrust performs that
check and acts on the result. Concretely, given a network's announcement and a device profile, it:

1. **Canonicalises the claim** (`internal/claim`). Names are lowercased and converted to A-labels;
   subdomains become relative wire-format names sorted in RFC 4034 canonical order; `*` means the whole
   zone; Special-Use Domain Names (RFC 6761) are flagged.
2. **Computes the Verification Token** (`internal/claim/token.go`): `base64url(hash(len(salt) || salt || X))`
   where `X` is the concatenation of the canonical relative names, each terminated by a zero octet; the
   hash is SHA-384 or SHA-512 (ZONEMD algorithm numbers). This is the value the domain owner must have
   published.
3. **Makes the announced resolver prove its name** (`internal/dot`): a DNS-over-TLS connection to the
   announced address with the claim's resolver name as the TLS server name, verified against the CA pool
   (RFC 9525 matching). The presented certificate is kept as evidence either way.
4. **Fetches the owner's Verification Record** at `R._splitdns-challenge.P` **through a path the network
   cannot forge** (`internal/validate`, `internal/verify`):
   - validating devices do full DNSSEC validation in-process with libunbound, either forwarding over the
     authenticated DoT connection to the network's resolver (RFC 9704 Figure 4) or iterating from the
     root; Secure / Bogus / Insecure / Indeterminate decide (section 6.2);
   - a device whose default resolver is an external encrypted resolver (a phone with Private DNS) asks
     that resolver over DoT instead (section 6.1); no answer means failure; the AD bit is recorded;
   - a hybrid device validates first and uses the external path only when the zone is provably unsigned.
5. **Compares tokens** (`internal/txtrec`): the TXT RRset is parsed RR by RR; a record matches when its
   `token` equals the computed one; `token` and `ds` are only ever read from the same RR.
6. **Checks the delegated key** (RFC 9704 section 7, `internal/verify/ds.go`): if the matching record
   carries `ds` values, the device fetches `DNSKEY resolver.arpa.` from the resolver over the authenticated
   connection and accepts only a key whose DS, recomputed over the owner name `resolver.arpa.`, equals a
   published value byte for byte. A published `ds` that matches nothing is a rejection, never a silent
   downgrade to token-only authority.
7. **Issues a grant** or a rejection: the resolver may answer for exactly the claimed scopes, until the
   earliest of the record's TTL, the RRSIG expiration and the PvD document's expiry; the grant says whether
   local answers can be validated (a key was delegated) or not.

Every run produces one report per claim with an ordered trace of stages (`pvd, claim, token,
resolver_tls, public_dnssec, external_resolver, record, ds, grant`), each stage carrying a status, a
stable reason code and the evidence it was decided on. Decisions are `accepted`, `rejected` or
`indeterminate` (the device could not find out; it keeps its defaults).

The verdict is then **enforced** in two ways:

- `splittrust resolve` (and `POST /api/resolve`) resolves one name the way the device would: inside a
  granted scope the query goes to the authorised resolver over DoT and, when a key was delegated, the
  answer is validated under that key; outside it takes the device's default path.
- `splittrust proxy` is a plain-DNS server (`internal/proxy`). Any stub resolver pointed at it gets the
  same behaviour for every query: granted names are forwarded to the authorised resolver and validated
  (`AD=1`), token-only authority answers with `AD=0`, everything else follows the device's default path,
  Bogus becomes `SERVFAIL`, rejected claims never route a query, and the reason is attached as an Extended
  DNS Error (RFC 8914) for clients that send EDNS. Grants are cached and re-verified before expiry.

The owner side (`internal/owner`, `splittrust build-record`, `POST /api/records/build`) turns a proposed
claim into the TXT line to publish and the canonical claim to announce. Nothing is ever published by the
tool. A DHCP codec (`internal/dhcp`) encodes and decodes the RFC 9704 section 5.2.1 Authentication option
payload; the lab does not send DHCP.

What it is not: it does not intercept the host's DNS, and it does not listen for DHCP or Router
Advertisements (discovery is pre-configured per scenario). Verdicts about the lab's private root carry
`trust_context: "lab"`; the demo scenes validate our own Cloudflare-hosted zone `zivkovic.me` under the
IANA root and carry `trust_context: "global"`.

---

## 2. The Docker lab

`lab/compose.yaml` starts fourteen services. The lab's own DNS lives on the isolated bridge `splitlab`
(172.30.97.0/24, `internal: true`). The parts that have Internet access in real life also join the
ordinary bridge `egress`: the office and hotel resolvers, the devices (app, proxy) and the test runner.
That is what lets the demo validate Pangolin's real zone against the real root.

```
                                  splitlab 172.30.97.0/24 (internal)          egress (Internet)

  bootstrap  (one-shot)  writes the shared volume /gen: keys, signed zones, certificates, manifest
      |
      v
  public-dns   .10  BIND 9        the private DNS root "." and TLD "lab", seven parent zones, all signed
                                  except unsigned.lab; expired.lab signed with signatures already expired
  local-dot    .20  CoreDNS       the office resolvers:                                              yes
                                    :853 DoT, cert for dns.corp.lab, dns.*.lab and dns.splittrust.zivkovic.me;
                                         authoritative for internal.*.lab, mail.corp.lab,
                                         internal.splittrust.zivkovic.me and resolver.arpa.;
                                         forwards lab. to public-dns, everything else to the Internet
                                    :53  plain DNS: company Dodo's office resolver (dodo.example, no DNSSEC)
  hotel-dot    .21  CoreDNS       the hotel's resolver dns.hotel.lab:                                yes
                                    :853  DoT honest view (overrides www.<claimed zone>, relays the rest)
                                    :8853 DoT forging view (own copies of banka.lab and zivkovic.me with a
                                          correct-token Verification Record; every name -> the hotel's page)
                                    :53   plain DNS: the forged copies, for guests without SplitTrust
  pvd          .30  nginx, HTTPS  PvD Additional Information documents, one per network
  external     .40  unbound, DoT  "quad9.lab": a validating recursive resolver over the lab root
  app          .50  splittrust    `serve`: HTTP API + console, published on 127.0.0.1:8000            yes
  proxy        .60  splittrust    `proxy`: the plain-DNS front door; control API on :8001             yes
  client       .61  alpine+curl   a plain client; Docker hands it the proxy (172.30.97.60) as DNS server
  naive        .62  alpine+curl   the same client with the hotel's DNS (172.30.97.21)
  intranet     .70  nginx         Pangolin's internal host (host.internal.splittrust.zivkovic.me, host.internal.corp.lab)
  dodo-intranet .71 nginx         Dodo's internal host (intranet.dodo.example)
  bank         .80  nginx         the real www.banka.lab of the lab scenarios
  fake-bank    .66  nginx         the hotel's page: where every forged name points
  test         .51  (profile tools) runs the integration suite against the running lab              yes
```

### Trust material and how it is generated

`bootstrap` (`lab/bootstrap/bootstrap.sh`, image `lab/bind/Dockerfile`) runs once per `up` and fills the
named volume `labgen`, mounted read-only at `/gen` in every other service. It reuses a generation younger
than 20 hours and regenerates when it is missing, stale or `FORCE=1` is set (`docker compose down -v`
starts from scratch). It produces:

- a lab certificate authority and DoT/HTTPS certificates for local-dot, hotel-dot, pvd and external;
  the client gets `ca.pem`, and `ca-real.pem` (lab CA plus the system bundle) for the real-domain scenes;
- the DNSSEC hierarchy with BIND tools (`dnssec-keygen`, `dnssec-signzone`): a private root, the `lab`
  zone with DS records for its signed children, and the parent zones; `expired.lab` is signed with
  `-s now-7200 -e now-3600`; `unsigned.lab` is not signed and has no DS. The lab device's trust anchor is
  the `lab.` KSK (not the private root's): the resolvers forward everything outside `lab.` to the real
  Internet, so a device anchored at the private root would meet the real root's keys and go Bogus. The
  external resolver `quad9.lab` recurses over the private root and keeps the root KSK;
- everything the engine itself must produce, via `splittrust lab-init` (`internal/labgen`): a random
  16-octet salt per claim (fixed for the real scenario), the claims, the Verification Record TXT lines
  spliced into the parent zones (`stale-salt` gets a record for a different salt; `wrong-ds` a DS of a
  throw-away key), the PvD documents, the split-horizon child zones signed with one local KSK/ZSK pair
  whose DS is published as `ds=` where the catalogue says so, the `resolver.arpa.` DNSKEY zone, the hotel's
  forged copies of every claimed zone (and of `dodo.example`, listed in `forged_zones`), its `hosts`
  override, Dodo's plain `dodo.example` zone, and `client/manifest.json`. Real zones get no TXT line: Pangolin's
  record lives at Cloudflare and the claim's salt is fixed in the catalogue so it stays valid;
- `named.conf`, the CoreDNS Corefiles, the nginx and unbound configurations, copied into the volume so no
  service needs a bind mount (Docker Desktop and Rancher Desktop differ in what they allow).

The scenario catalogue is `internal/lab/scenarios.json`, embedded in the binary: thirteen scenarios, each
a network with its announced resolver(s), claim(s), PvD identifier or inline claim file, default device
and the expected verdict per device. The three `real-*` scenarios carry `trust_context: global` and
`anchor: iana`; they are the demo. The manifest the app loads is the catalogue plus generated paths.

### Why the pieces are what they are

- BIND serves the public zones because CoreDNS's `file` plugin does not special-case DS queries when
  parent and child live on the same server; BIND does, and DS handling is exactly what the lab tests.
- CoreDNS serves the hybrid resolvers because it combines authoritative files, forwarding and a `hosts`
  override in one DoT listener with a ten-line configuration.
- libunbound is built from source in the app image (`lab/app/Dockerfile`): Debian's package is linked
  against nettle and cannot do TLS to a forwarder, and Alpine's musl thread stacks overflow inside
  `ub_resolve` with TLS. The pinned release is checksum-verified.
- The office and hotel resolvers, the devices and the test runner have Internet because their real
  counterparts do; the lab's private DNS stays on the internal network. Company Dodo needs no scenario:
  it never verifies anything, so its devices are represented by the `naive` client and the browse API's
  `naive_dns` parameter (a lab resolver on port 53).

### Lifecycle commands

```bash
docker compose -f lab/compose.yaml up --build -d                          # build images, generate the lab, start
docker compose -f lab/compose.yaml exec app splittrust verify --scenario real-hotel-forged
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.splittrust.zivkovic.me   # through the proxy
docker compose -f lab/compose.yaml exec naive  curl -s http://intranet.dodo.example                   # hotel DNS directly
docker compose -f lab/compose.yaml --profile tools run --rm test              # integration suite
docker compose -f lab/compose.yaml down -v                                    # remove everything, keys included
```

---

## 3. Code paths

The module is `github.com/djzivkovic/splittrust`: about 5,000 lines of Go outside tests, a 1,400-line
React console, no frameworks beyond `miekg/dns`, `miekg/unbound` and `golang.org/x/net/idna`.

```
cmd/splittrust        CLI: inspect, build-record, verify, resolve, scenarios, dhcp, vectors, lab-init, serve, proxy
internal/claim        canonical form, RFC 4034 order, $X, token, record owner, Special-Use list
internal/txtrec       Verification Record TXT parse/format      internal/dhcp     option 90/11 payload codec
internal/pvd          RFC 8801 fetch and validate               internal/dot      DoT client, RFC 9525 identity
internal/validate     libunbound adapter (build tag libunbound) internal/verify   the pipeline, ds binding, local validation
internal/route        scoped resolution of one name             internal/proxy    plain-DNS front door, grant cache, EDE
internal/engine       wiring: manifest -> verifier with real dependencies; used by CLI, API and proxy
internal/api          HTTP API, /api/browse, embedded console    internal/lab      catalogue (scenarios.json) and manifest
internal/labgen       lab artefacts the engine must generate    internal/owner    the owner's record builder
internal/vectors      published test vectors and the RFC 5.1 forensics
web/                  the demo deck (React, Vite, Tailwind, framer-motion), built into internal/api/web/dist
tests/integration     runs inside the lab (compose service "test")
```

### Path A: a verification (`verify --scenario hotel-forged`, `POST /api/verify`, or the proxy's first query)

```
engine.Load(manifest) ──► engine.Profile(id) ──► engine.Verifier(profile)
                                                      │  real dependencies:
                                                      │   Public = validate.New(anchor, hints, CA, forwarder)   (libunbound)
                                                      │   DoT    = dot.Client{Roots: lab CA}
                                                      │   PvD    = pvd.Fetcher{Roots: lab CA}
                                                      ▼
                                              verify.Verifier.Verify(profile, inline, opts)
                                                      │
          ┌───────────────────────────────────────────┤ for each claim in the PvD document (or the inline claim):
          │ pvd            pvd.Fetch(url, pvd_id)      │  HTTPS, cert = PvD ID, no redirects, 64 KiB cap, application/pvd+json
          │ claim          claim.Canonicalize           │  special-use -> reject; lab namespaces; resolver must be announced (DNR)
          │ token          claim.Token                  │  the expected token, $X and token input kept as evidence
          │ resolver_tls   dot.Dial(addr, claim ADN)    │  certificate recorded; mismatch -> TLS_IDENTITY_FAILED, unreachable -> indeterminate
          │ public_dnssec  Public.Resolve(owner, TXT)   │  validating devices: Secure / Bogus / Insecure / Indeterminate
          │ external_resolver dot -> external resolver  │  private-dns always, hybrid after Insecure; no answer -> EXTERNAL_TIMEOUT
          │ record         txtrec.ParseRR per RR        │  token equality; token and ds from the same RR
          │ ds             DNSKEY resolver.arpa. + MatchDS │ full DS RDATA equality; mismatch -> DS_MISMATCH
          │ grant          scopes, expiry = min(TTL, RRSIG, PvD) │
          └───────────────────────────────────────────┘
                                                      ▼
                                   verify.Run { decision, claims[] { reason, stages[], inspection, grant } }
```

`validate.New` builds a fresh libunbound context per lookup from a generated configuration (trust anchor
file, optional root hints, the CA bundle, and a `forward-zone` over TLS with the forwarder's authenticated
name when the device resolves via the network). The resolving goroutine owns the context and destroys it
only after `ub_resolve` returns, so a timeout never frees memory the C library is still using. The
result is mapped to `Evidence{Security, Rcode, Records, Why, TTL, RRSIGExpiresAt, Forwarder}`; SERVFAIL
without a validation verdict maps to `error`, never to `insecure`.

### Path B: resolving one name (`resolve --scenario legit --name host.internal.corp.lab`, `POST /api/resolve`)

`route.Resolver.Resolve` checks the lab namespaces (anything else is refused without traffic), loads the
claims, finds the one whose scope covers the name label-wise, runs Path A, and then:

- grant with a delegated key: DoT to the authorised resolver, `DNSKEY <zone apex>` and the A query,
  `verify.ValidateLocal` under the approved keys only; a key set that merely contains the approved key
  but is signed by another key fails;
- grant without a delegated key: `LOCAL_DNSSEC_NOT_ESTABLISHED` (the strict CLI answer; the proxy, by
  decision, answers with `AD=0` instead);
- no grant: the device's default path (validator through the network resolver or iteratively; external
  DoT for the private-dns device).

### Path C: the proxy (`proxy --scenario legit --listen :53 --control :8001`)

`proxy.Server` implements `dns.Handler`. On a query it checks the namespaces (`REFUSED` otherwise), finds
the cached verdict covering the name (running Path A for the whole network when nothing is cached or a
grant is due for re-verification), and answers: granted names via DoT to the authorised resolver with
local validation (`AD=1`) or pass-through (`AD=0`) for token-only authority; everything else via the
device's default path; Bogus as `SERVFAIL`; each answer carrying an Extended DNS Error with the reason for
EDNS clients. `POST /join {scenario_id, device}` switches the network and drops the cache; `GET /status`
reports grants and the query count. The `client` container only knows the proxy as its DNS server.

### Path D: the console and API

`splittrust serve` mounts the API and the built demo deck from the same binary. The deck is deliberately
small: a title and three scenes, each a drawing that animates the real verification stages (built from the
report's ordered stages) and two browser frames fed by `/api/browse`. Everything else is CLI and API. The API is a thin layer
over the engine: strict JSON envelopes (unknown fields are 422, bodies over 16 KiB are 413, unknown
scenarios 404, rejections are ordinary 200 reports). `POST /api/browse` is the proof endpoint: it resolves
a name through the proxy (Pangolin's device) and through a chosen lab resolver on port 53 (`naive_dns`, Dodo's
device), then fetches the page: a lab address over plain HTTP by IP with the Host header, a real address
over HTTPS by name, summarised as status, server header and title. `POST /api/live` resolves a scenario's
Verification Record and the parent's DS iteratively from the trust anchor, the "check it yourself" view.
`/api/client/*` relays to the proxy's control API so the console can move the client between networks.
The console renders the engine's reports and never computes a verdict; its sentences are keyed by the
stable reason codes.

### Tests and what they prove

- Unit tests (10 packages, `go test ./...`): token vectors including the RFC's own example under both
  salts, TXT parsing rules, DHCP round trips, PvD validation, the verifier's security branches with fakes
  (resolver mismatch before DNS, DS mismatch despite a token-only RR, key substitution in local
  validation, insecure zone per device, external resolver unreachable, forged record is Bogus, grant
  expiry from RRSIG), scoped routing (label-wise suffix, no calls out of lab), the proxy's decisions, the
  API's envelopes, concurrency of the engine's CA cache, and that `vectors/*.json` are exactly what the
  engine generates.
- Integration suite (inside the lab): every scenario and device against the expected table, forward and
  in reverse, including the real-domain scenes when the test container has Internet; API parity with the
  running app; resolve paths; the DNSSEC states are real and survive the network's own resolver; the
  hotel cannot pass as `dns.corp.lab`; a black-holed forwarder times out cleanly; the proxy front door end
  to end, including Pangolin's intranet, the forged real domain and the phone reaching the real site.

---

## 4. Reading a report

```
scenario hotel-forged  device=validating-stub  resolution=via-network  trust_context=lab
claim 1: resolver dns.hotel.lab, scopes banka.lab.
  [pass   ] pvd                PVD_OK           pvd.hotel.lab: 1 claim(s)
  [pass   ] claim              CLAIM_OK         dns.hotel.lab. claims * under banka.lab.
  [pass   ] token              TOKEN_COMPUTED   expected token 4mEZ...
  [pass   ] resolver_tls       TLS_IDENTITY_OK  172.30.97.21:8853 authenticated as dns.hotel.lab. over DoT
  [fail   ] public_dnssec      DNSSEC_BOGUS     no DNSSEC records from 172.30.97.21 for DS banka.lab. while building chain of trust
  [skipped] external_resolver  NOT_REACHED
  [skipped] record             NOT_REACHED
  [skipped] ds                 NOT_REACHED
  [skipped] grant              NOT_REACHED
  => REJECTED DNSSEC_BOGUS
```

Read it as the device did: the claim was well formed, the resolver really is `dns.hotel.lab`, and the
owner's record could not be validated because the chain of trust from the lab root to `banka.lab` does
not cover what the hotel served. The hotel knew the token; it could not produce the bank's signature.
