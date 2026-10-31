# SplitTrust — what it is, what the lab is for, and how the console should flow

Status: implemented (2026-10-31) as the React console in `web/` — Stage / Live / About. Section 5 below
is the flow as built; section 6's backend additions exist (`/api/browse`, the story sentences live in
`web/src/lib/story.ts`, network metadata in `web/src/lib/networks.ts`).

---

## 1. The problem in one picture

```
   You, on hotel Wi-Fi                         The hotel's network says:
   ┌──────────────┐    DHCP / RA / PvD         "my resolver dns.hotel.lab
   │   device     │ <─────────────────────     answers for *.banka.lab"
   └──────┬───────┘
          │ www.banka.lab ?                    Should the device believe it?
          ▼
   ┌──────────────┐                            Today: nothing to check. Encrypting the
   │ dns.hotel.lab│ ──► 172.30.97.66 (fake)    query does not help — the device is talking
   └──────────────┘                            to the wrong server, encrypted.
```

Split-horizon DNS is legitimate and common: a company resolver answers for `internal.corp.example`
with addresses the public DNS never sees. The abuse is identical in shape: a hostile network claims
authority over names it does not own. **RFC 9704 gives the domain owner a way to say which resolver may
answer for which names, and gives the device a way to check that statement in a way the local network
cannot forge.** SplitTrust implements the device side (and the owner's publishing tool), and ships a
laboratory in which every actor is ours, so the attack and the defence can be shown live.

## 2. Three roles, one question

| Role | Real world | What they do under RFC 9704 | In SplitTrust |
|---|---|---|---|
| **Domain owner** | corp.example's DNS admin; the bank | Publishes a *Verification Record*: `TXT <resolver>._splitdns-challenge.<parent>` containing a **token** (a salted hash of the exact claim) and optionally a `ds` value that delegates a DNSSEC key to the resolver. The zone must be DNSSEC-signed for this to prove anything. | Owner tool (`build-record`, console tab); the real record we published in `zivkovic.me` |
| **Network** | Corporate Wi-Fi; hotel Wi-Fi | Announces its encrypted resolver (DNR: name + address) and a **claim**: "resolver R answers for subdomains S of parent P, salt X" via DHCP option or the PvD JSON document. | Each lab *scenario* is one network with one announcement |
| **Device** | Laptop, phone | Before using the resolver for those names: computes the token from the claim, fetches the owner's record **through a path the network cannot forge** (DNSSEC validation, or an external encrypted resolver it already trusts), checks the resolver's TLS certificate matches the announced name, checks the delegated key. Only then routes those names to that resolver. | `verify` (the pipeline), `proxy` (does it for every query of a plain client) |

The whole project answers one question, repeatedly: **"May this resolver answer for these names?"**
Everything in the UI should be phrased as that question and its answer.

## 3. Why a lab at all

You cannot demonstrate this on the public Internet without owning the network *and* the domain *and*
an attacker. The lab is a miniature Internet where we own all three:

```
                        ┌─────────────────────────────┐
                        │  public-dns (BIND)          │  a private DNS root "." with a REAL DNSSEC chain:
                        │  . → lab → corp/banka/...   │  root KSK → lab → corp.lab (signed), unsigned.lab,
                        └──────────────┬──────────────┘  expired.lab (signatures expired), ...
                                       │
   ┌───────────────┐      ┌────────────┴───────────┐      ┌──────────────────────┐
   │ pvd (nginx)   │      │ local-dot (CoreDNS)    │      │ hotel-dot (CoreDNS)  │
   │ PvD documents │      │ the COMPANY resolver   │      │ the HOTEL resolver   │
   │ per network   │      │ DoT, cert dns.corp.lab │      │ :853 honest relay    │
   └───────────────┘      │ serves internal.corp.lab│     │ :8853 forging view   │
                          └────────────────────────┘      │ :53 plain (naive)    │
   ┌───────────────┐                                      └──────────────────────┘
   │ external      │  "quad9.lab": the validating         ┌──────────┐ ┌────────┐ ┌──────────┐
   │ (unbound)     │  resolver a privacy phone uses       │ intranet │ │ bank   │ │fake-bank │
   └───────────────┘                                      │ .70      │ │ .80    │ │ .66      │
                                                          └──────────┘ └────────┘ └──────────┘
   ┌───────────────┐   ┌────────────┐   ┌────────────┐
   │ app (console) │   │ proxy      │   │ client     │  a plain Alpine box: curl + dig, DNS = proxy
   │ + API         │   │ Do53 front │   │ naive      │  same box, DNS = hotel directly
   └───────────────┘   │ door       │   └────────────┘
                       └────────────┘
   isolated network 172.30.97.0/24, no Internet; only the console port is published.
   `real` (profile): the one container with Internet, for the zivkovic.me scenario.
```

Every **scenario** is a *network the device can join*: the announcement it makes (resolver + claim), and
the state of the world around it (is the zone signed? is the record there? does the resolver's
certificate match?). The verdicts are real cryptography; only the Internet is small.

| Scenario (network) | What the network announces | The world | Verdict for a validating device |
|---|---|---|---|
| `legit` — Corp Wi-Fi | `dns.corp.lab` for `internal`, `dns2.corp.lab` for `mail` | corp.lab signed, records present, first one delegates a key | **accepted** — names route to the company resolver, validated |
| `hotel` — Hotel Wi-Fi | `dns.hotel.lab` for all of `banka.lab` | bank never published anything; hotel relays the bank's signed denial | rejected `RECORD_MISSING` |
| `hotel-forged` | same | hotel serves its own banka.lab incl. a record with the *correct token* | rejected `DNSSEC_BOGUS` — token right, signature chain absent |
| `replay` | the company's claim, announced as `dns.corp.lab` | hotel cannot present a certificate for that name | rejected `TLS_IDENTITY_FAILED` before any DNS |
| `stale-salt` | claim with a new salt | zone still has the old record | rejected `TOKEN_MISMATCH` |
| `expired-signature` | correct claim | zone's signatures expired | rejected `DNSSEC_BOGUS` |
| `unsigned` — Startup café | correct claim, record present | zone not DNSSEC-signed | validating device: rejected; Private-DNS phone: **accepted via Quad9, yellow** |
| `wrong-ds` | claim whose record carries a wrong `ds` | key mismatch | rejected `DS_MISMATCH` — no downgrade to token-only |
| `hotel-blocks-external` | hotel claim; device is a Private-DNS phone | Quad9 unreachable | rejected `EXTERNAL_TIMEOUT` |
| `special-use` — Home | `home.arpa` | RFC 6761 name | rejected without any traffic |
| `real-zivkovic` — Real Internet | `dns.splittrust.zivkovic.me` for `internal.splittrust.zivkovic.me` | real Cloudflare zone, real DS at the `.me` registry, real Quad9 | **accepted** under the IANA root (`trust_context: global`) |

Three **device profiles** change the answer the RFC gives:
`validating-stub` (laptop that validates DNSSEC itself; the network resolver is its forwarder),
`private-dns` (phone whose default resolver is Quad9; verifies through it, §6.1),
`hybrid` (validates, and falls back to Quad9 only when the zone is provably unsigned).

## 4. What is wrong with the current console

It is an engineer's test harness, not a story:

- The first thing on screen is an eleven-row table of ids with "expected vs actual" columns. Nothing says
  *who you are*, *where you are*, or *what the question is*.
- "Device", "resolution", "network", "scenario" and "client on the network" are five unexplained knobs
  in four places; the proxy panel and the verification table drive different things and look the same.
- The trace is a wall of stage ids and reason codes; the sentence that matters ("the hotel knew the
  token but the bank never signed it") is buried in `evidence` JSON.
- The payoff — a normal program reaching the right site or failing safely — is not in the UI at all; it
  lives in a terminal command the presenter has to type.
- The real-DNS result, the strongest thing we have, is a greyed-out row.

## 5. The intended flow: "you are a device"

One page, five panels in reading order, state flowing downward. Every panel answers one question in one
sentence first and shows the technical detail on demand.

```
 ┌───────────────────────────────────────────────────────────────────────────────────┐
 │ SplitTrust            LAB — a private root with a real DNSSEC chain · [real DNS ✓] │
 ├───────────────────────────────────────────────────────────────────────────────────┤
 │ 1  YOU ARE                                                                        │
 │   [ Laptop: validates DNSSEC ]  [ Phone: Private DNS (Quad9) ]  [ Hybrid ]        │
 │   "This laptop checks every DNSSEC signature itself; the network's resolver is    │
 │    only a forwarder."                                                             │
 ├───────────────────────────────────────────────────────────────────────────────────┤
 │ 2  JOIN A NETWORK                                                                 │
 │   ⌾ Corp Wi-Fi     ⌾ Hotel Guest ▾(honest · forging · replaying corp · no Quad9)  │
 │   ⌾ Startup Café (unsigned)   ⌾ Branch (expired / stale / wrong key)              │
 │   ⌾ Home (home.arpa)          ⌾ The real Internet (zivkovic.me)                   │
 │   This network says: "dns.hotel.lab answers for everything under banka.lab"       │
 │   announced via DNR + PvD pvd.hotel.lab · resolver 172.30.97.21:853               │
 ├───────────────────────────────────────────────────────────────────────────────────┤
 │ 3  THE DEVICE CHECKS                                      [ Verify ]  (auto-run)  │
 │   ● Claim read         dns.hotel.lab wants *.banka.lab                            │
 │   ● Token computed     4mEZ…oDb  (what the bank would have had to publish)        │
 │   ● Resolver identity  certificate is for dns.hotel.lab — as announced   ✓        │
 │   ✖ Owner's record     fetched through the hotel — the bank's zone never signed   │
 │                        it: DNSSEC Bogus                                           │
 │   ○ Key delegation     not reached                                                │
 │   ┌───────────────────────────────────────────────────────────────────────────┐   │
 │   │ REJECTED — DNSSEC_BOGUS                                                   │   │
 │   │ The hotel knows the token (it wrote the claim). It cannot produce the     │   │
 │   │ bank's signature. Nothing under banka.lab will be sent to this resolver.  │   │
 │   └───────────────────────────────────────────────────────────────────────────┘   │
 │   ▸ technical trace (stages, codes, evidence JSON, dig output)                    │
 ├───────────────────────────────────────────────────────────────────────────────────┤
 │ 4  NOW BROWSE                                                                     │
 │   http:// [ www.banka.lab           ] [Go]   suggestions: www.banka.lab ·         │
 │                                              host.internal.corp.lab · www.corp.lab│
 │   ┌─ Your device (through SplitTrust) ─┐  ┌─ A naive device on the same Wi-Fi ─┐  │
 │   │ cannot resolve www.banka.lab       │  │ "FAKE www.banka.lab served by the  │  │
 │   │ SERVFAIL · DNSSEC Bogus            │  │  hotel… Please enter your password"│  │
 │   │ route: default · no answer         │  │ 172.30.97.66                       │  │
 │   └────────────────────────────────────┘  └────────────────────────────────────┘  │
 ├───────────────────────────────────────────────────────────────────────────────────┤
 │ 5  DOMAIN OWNER  (tab)      publish a record · see the one live in zivkovic.me    │
 └───────────────────────────────────────────────────────────────────────────────────┘
 footer: lab self-test (all 11 scenarios × devices vs expected: 14/14 ✓) · legend · about
```

### Panel by panel

**1 — You are.** Three cards; selecting one re-runs the current network. One sentence each:
*Laptop* — "validates DNSSEC itself; the network's resolver is only a forwarder; an unsigned zone cannot
be verified"; *Phone with Private DNS* — "asks Quad9 for everything; verifies the owner's record through
Quad9, so its safety rests on Quad9"; *Hybrid* — "validates, and only when a zone is provably unsigned
asks Quad9". Default: Laptop.

**2 — Join a network.** Networks are SSID-like cards, not scenario ids. The hotel is one card with a
variant switch (honest / forging / replaying the company's claim / blocking Quad9) because the story is
"same hotel, four tricks". Selecting a card shows *what the network announces* in plain words and the
mechanism (DNR, PvD/DHCP), then auto-runs panel 3. Joining also moves the lab `client` container to that
network (the proxy's `/join`), so panel 4 is consistent with panel 3.

**3 — The device checks.** The pipeline rendered as a vertical checklist of five human steps (claim →
token → resolver identity → owner's record → key delegation), each with a one-line explanation generated
from the stage code, and a verdict card whose text is the *consequence for the user*: "nothing under
banka.lab will be sent to this resolver" / "names under internal.corp.lab go to dns.corp.lab and answers
are validated under the key the owner delegated" / "accepted, but only because Quad9 said so — yellow".
The existing stage trace, evidence JSON and `dig` output move into a collapsed "technical trace".
Multi-claim networks (Corp) show one checklist per claim, collapsed to a row each when all pass.

**4 — Now browse.** The payoff without a terminal. An address bar with suggested names. The app performs
the fetch *inside the lab* (`POST /api/browse {name}`): the left column resolves the name as the current
device would (through the proxy's path) and fetches `http://name/`, showing the page banner or the DNS
failure with its Extended DNS Error; the right column does the same through the hotel's plain DNS as a
naive device would (only when the current network is a hotel; otherwise it shows the public answer). The
page banners are the lab's three web servers — intranet, REAL bank, FAKE bank — written to be read from
the back of a room.

**5 — Domain owner (tab).** The publishing side: the current form, but framed as "a network asked you
for permission; here is what to publish and what to tell them", plus the live `zivkovic.me` record and
its real verification result (green under the IANA root) with the `dig` evidence.

**Footer / judges' panel.** The current expected-vs-actual table becomes a one-click "lab self-test"
that runs all scenarios × listed devices and reports N/N, for the Reviewer and for judges who ask "does
it really do all of this?".

### Rules for the copy

- Lead with the consequence, follow with the mechanism, end with the RFC section.
- Never show a reason code without its sentence. `DNSSEC_BOGUS` → "the owner's zone never signed this".
- Green = authority established and answers validated; **yellow** = authority rests on someone else
  (Quad9) or no key was delegated; red = rejected; grey = could not decide (network error) — and grey
  never pretends to be red or green.
- The lab banner stays on every screen; the real-DNS card is the only thing allowed to say "global".

## 6. What the API already provides, what the rebuild needs

Already there: `GET /api/scenarios` (with `expected`, `default_device`, `requires_internet`),
`POST /api/verify`, `POST /api/resolve`, `POST /api/records/build`, `POST /api/inspect`,
`GET /api/client/status`, `POST /api/client/join`.

Needed for the flow above (small, server-side):

1. `POST /api/browse {name}` → `{device: {route, answers, error, ede, body}, naive: {answers, body}}` — the
   app resolves via the proxy (DNS query to `172.30.97.60:53`) and via the hotel's plain DNS
   (`172.30.97.21:53`), then HTTP-GETs `http://<ip>/` with `Host: name` and returns the banner text. ~80
   lines of Go; the app already lives on the lab network.
2. Scenario metadata for the cards: `display.ssid`, `display.group` (hotel variants), `display.announces`
   (one sentence), `display.world` (one sentence), `display.consequence` per decision. Lives in
   `scenarios.json`; no engine changes.
3. A `steps` view of a claim report: map the nine stages onto the five human steps with sentences
   (`internal/api/story.go`, ~120 lines), returned alongside the raw stages so the console does not
   compute verdict text itself.
4. Console: rewrite `index.html`/`app.js`/`style.css` around the five panels (vanilla JS, ~500 lines).
   Estimated 3–4 hours total including the lab test for `/api/browse`.

## 7. What to say when asked "so what does the product look like?"

A resolver component on the device (or in the network's own router) that does what the proxy does: learn
the claim from DHCP/PvD, verify it, and only then split DNS for exactly those names — with the OS's own
split-DNS machinery (systemd-resolved per-domain DoT+DNSSEC, Windows NRPT) as the enforcement point.
The lab shows the whole loop end to end with real cryptography; the console shows it to a human.
