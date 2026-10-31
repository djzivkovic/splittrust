# SplitTrust — comparison of the two specs and a recommendation

Status: decision input for the team, 2026-10-31. Nothing here is implemented.

Compared documents:

- **D** = Djordje's `2026-10-27-splittrust-design.md` + `2026-10-27-splittrust-implementation.md`
  (branch `djzivkovic-specs`). Written on 27 Oct with Copilot for a 24-hour, three-engineers-coding model.
- **I** = Ilija's `docs/research/2026-10-31-review-and-plan.md` (this branch), written on 31 Oct after a
  full read of RFC 9704, its draft history, errata, and the dependent RFCs, and refined through a Q&A
  round in which Ilija chose: Go, Docker-only builds, validating-resolver-based DNSSEC, thin console,
  "replayed claim / TLS mismatch" as scenario 6, and **the agent implements while the three humans act as
  Reviewer / Operator / Storyteller**.

Both documents agree on far more than they disagree. The disagreements are listed first because they
are what the team has to settle at kickoff.

---

## 1. The six decisions the team must settle

| # | Topic | D says | I says | Recommendation and why |
|---|---|---|---|---|
| 1 | **Who writes the code** | Three engineers in lanes A/B/C, AI-assisted, subagent-driven plan | One agent implements; humans review against the RFC, operate the lab, and own the pitch | **I.** It is what Ilija asked for, and it changes every estimate in D: tasks are no longer parallel human lanes but a sequence with human gates. D's plan structure (Tasks 1–8, TDD, frozen contracts) survives; its lane ownership and 24 h budgets do not. |
| 2 | **Language / stack** | Python 3.13 + dnspython + libunbound (python3-unbound), FastAPI, React 19/Vite in a Node 22 container | Go single static binary (miekg/dns), embedded one-page console, no Node | **I (Go).** Real adopters are resolvers and clients; the newest DNS tooling that could pick this up is Go (CoreDNS, AdGuard Home, Tailscale, cloudflared, NextDNS). One `go build` yields the same binary on macOS/Windows/Linux, which "buildable on both OS" needs; it removes the Node toolchain, hashed Python lock files, mypy/ruff and `.venv\Scripts` Windows paths from the critical path. Cost: dnspython's `sign_zone` convenience is lost (see §2.4). D's *contracts* (models, reason codes, stages, exit codes) port 1:1 to Go structs. |
| 3 | **Wrong-`ds` scenario** | Mandatory; locally signed child zone, `resolver.arpa` DNSKEY over DoT, DS compare, local A validated with only approved keys | Stretch; replaced by "hotel replays firma's claim → TLS name mismatch" | **Keep D's wrong-ds AND add I's replay as scenario 7.** Wrong-ds is printed in the selected PDF and Djordje marked it mandatory; dropping it invites "you changed the submitted scope". With the agent coding, its cost is agent time, not human time: `DNSKEY.ToDS()` and `RRSIG.Verify()` exist in miekg/dns, so DS binding + bounded local-A validation is ≈3 h. The replay scenario costs ≈30 min (reuses the hotel resolver with firma's claim) and is the clearest answer to "why isn't a matching token enough?". |
| 4 | **§6.1 external-resolver path** | Excluded; §6.2 DNSSEC only; "insecure → rejected, no fallback configured" | Included as an explicit mode shown on the unsigned zone (red in DNSSEC-only, yellow with external resolver) | **Include as an explicit `--external` mode, default off.** Judges will ask "what if the phone already uses Quad9?" — the RFC's answer is §6.1, and showing it (yellow, with the caveat that security then rests on the external resolver) is more honest than omitting it. Cost ≈1 h (one DoT query to the lab's `quad9.lab` + token compare). It must never be the default path, and D's rule "never relax acceptance rules" applies. |
| 5 | **How the client gets Secure/Insecure/Bogus** | libunbound in a fixed worker subprocess, fresh context per lookup, read `secure`/`bogus`/rcode; explicitly forbids "replacing validation with an AD-bit check" | Validating unbound daemon on the client container; map AD / SERVFAIL(+CD retry) / no-AD | **libunbound semantics, Go implementation: try `github.com/miekg/unbound` (cgo) first; fall back to a localhost unbound daemon with `ede: yes`.** Both are unbound's validator; D's objection is to trusting an AD bit *from the network*, which neither option does. The cgo binding gives `Secure`/`Bogus`/`WhyBogus` in-process with a fresh context per verification (no cross-scenario cache); Docker-only builds make cgo acceptable. If the binding does not build cleanly within 45 min, the daemon with Extended DNS Errors (RFC 8914) gives the same three states plus the reason text ("Signature Expired", "DNSKEY Missing"). Write it into the spec as a decided fallback so nobody debates it at 3 a.m. |
| 6 | **Time budget** | 24 h, hour-6 trust gate, freeze at 21 | 22 h, checkpoints at 5/11/17 | **I (22 h), re-baselined for agent implementation.** See §4. The hour-6 "real trust gate" from D is kept as the first human gate: a signed TXT under the lab root validates Secure, expired is Bogus, unsigned is Insecure, wrong TLS name fails. |

Everything below either agrees already or is a one-line adoption.

---

## 2. Dimension-by-dimension

### 2.1 Fidelity to the selected proposal
- Six scenarios, CLI + web console, owner record builder with unsigned-zone warning, Docker lab, test
  vectors, erratum: **both**. D is stricter about not renaming or reducing submitted deliverables; adopt
  that stance. Final scenario list: D's six + replay (7) + special-use rejection (free, no lab needed).
- D names scenarios `legit, hotel, stale-salt, expired-signature, unsigned, wrong-ds` with **one parent
  zone per scenario** (`corp.lab`, `banka.lab`, `stale.lab`, `expired.lab`, `unsigned.lab`, `wrongds.lab`).
  I used `firma.lab`/`banka.lab` etc. **Adopt D's per-scenario zones**: no zone reloads between
  scenarios, no cache contamination, scenarios run in any order. Keep I's Serbian-flavoured names only in
  the pitch, not in the lab.

### 2.2 Safety and scoping rules (D is stronger — adopt wholesale)
- Runtime accepts **profile IDs only**, never caller-supplied resolver IPs, URLs, CA paths or anchors.
- Compose network `internal: true`; only the console port published on `127.0.0.1`.
- Every report carries `trust_context: "lab"`; never print an unqualified "globally authorized".
- No OS DNS interception, no VPN, no browser integration, no database; protection applies only to
  explicit SplitTrust queries. State this in README and on stage.
- Token and `ds` values must come from the **same TXT RR**; TXT character-strings are concatenated within
  one RR, never across RRs; duplicate `token` keys are invalid; multiple `ds` allowed.
- Expected scenario outcome is presentation metadata; verdicts are never derived from the scenario name.
- Rejection is not an error: HTTP 200 with a structured report; CLI exit 0 accepted / 1 rejected /
  2 invalid-or-indeterminate.
- Generated keys/certs live in an ignored `lab/generated/`; no private keys in Git; never `verify=False`.

I had most of these in weaker form; D's wording is better and should be the spec's wording.

### 2.3 Findings about RFC 9704 (I adds; D partially has them)
- **§5.1 example forensics.** The printed 63-char token is *exactly* SHA-384 over the draft-07 salt
  `"example salt bytes (should be random)"` with the digest's single `0x00` byte (position 30) removed
  before base64url; the salt was then reworded to "octets" in draft-10 without recomputation. D's plan
  references research notes about "the helper's different salt" and "NUL-removal reproduction", so
  Djordje reached the same two facts independently — the team owns one complete story. Reproduction:
  `docs/research/rfc9704_token_check.py`. The erratum should offer the RFC Editor both consistent fixes.
- **Figure 1 NSEC line** violates RFC 4035 §2.3 (bitmap must include NSEC and RRSIG; the insecure-
  delegation proof belongs at the delegation name, and the `NS` delegation itself is missing). Second,
  lower-priority erratum.
- **Under-specified points that become vectors** (I): `*` hashed as literal label `\x01*\x00` (D agrees:
  "do not replace it with an empty relative name"); TXT key/value delimiter is only shown by example;
  DHCP can carry one claim per message (RFC 8415 §20.2 + RFC 3396 concatenation); RDM=0 requires a
  strictly increasing 64-bit counter the RFC never mentions; `ds=` digest owner name (`resolver.arpa.` vs
  the subdomain); IDNA not mentioned (`.срб` vector); verifier must re-sort and lowercase PvD input.
- **"No implementation" claim.** D: "no first/only implementation claim". I: the authors' own DNS-OARC 44
  slide (Feb 2025) says "0 — Number of known implementations". Compromise wording: *"we found no public
  implementation; the authors reported none in February 2025."*

### 2.4 Lab construction
| | D | I | Recommendation |
|---|---|---|---|
| Authoritative | CoreDNS `file` plugin serving pre-signed zones; CoreDNS TLS for local DoT | BIND 9 (one container, all zones); unbound for DoT resolvers | Either works. With Go, **CoreDNS** keeps the lab in one language and serves DoT natively; keep **BIND's `dnssec-signzone`/`dnssec-keygen` in the bootstrap container** for signing (incl. `-e` past date for the expired zone) instead of re-implementing NSEC-chain generation in Go. dnspython's `sign_zone` was D's convenience; this replaces it with battle-tested tools. |
| Validator | libunbound (python3-unbound) worker | unbound daemon | See decision 5. |
| PvD | one HTTPS service, six immutable documents selected by allow-listed Host header, SANs for all six | nginx per network | **Adopt D's single service.** Simpler, and the hotel case (PvD/ADN under `hotel.lab`, claim about `banka.lab`) is explicit. |
| Discovery | pre-configured PvD URL per profile; no RA/DHCP | same (mock RA) | Agree. Say "discovery is pre-configured" on the slide. |
| Signatures | now−5 min → now+48 h; expired fixture now−2 h → now−1 h; PvD expires now+36 h; TTL 60 s; regenerate at `up` | signed once, committed | **Adopt D's relative windows + regenerate on `docker compose up`** (bootstrap one-shot). Committed zone files rot. |
| Network | `172.30.97.0/24` | `10.77.0.0/24` | Irrelevant; check for collisions at kickoff. |
| Client trust | lab CA + lab root anchor mounted read-only, separated from server keys | same | Agree. |

### 2.5 Engine contracts
D's models (`RawClaim`, `CanonicalClaim`, `Inspection`, `DnsEvidence`, `StageResult`, `Grant`,
`VerificationReport`, `ResolveReport`, `RecordBuild`, `LabProfile`) and reason codes (`AUTHORIZED`,
`INVALID_CLAIM`, `RECORD_MISSING`, `TOKEN_MISMATCH`, `DNSSEC_BOGUS`, `DNSSEC_INSECURE_NO_FALLBACK`,
`TLS_IDENTITY_FAILED`, `DS_MISMATCH`, …) are more complete than I's `verdict.json`. **Adopt D's
contracts as Go types**, add `EXTERNAL_TOKEN_MATCH` (decision 4, yellow) and `SPECIAL_USE_NAME`, keep
the stage order `pvd → claim → token → public_dnssec → record → resolver_tls → ds → grant`.

Scoped resolution (`resolve --scenario ID --name FQDN`, route `local/default/none`) is D's and is the
"payoff" moment of the demo; I only had it as a dig command. Adopt.

### 2.6 CLI / API / console
- CLI: D `inspect | build-record | verify | resolve | scenarios | lab-init`; I `token | record | verify |
  pvd | dhcp | vectors`. **Merge:** `inspect`, `build-record`, `verify`, `resolve`, `scenarios`, `vectors`,
  `dhcp encode|decode` (payload only; D excluded DHCP, I keep the codec because it is ≈1 h in Go and
  yields vectors that no one else has), `lab-init` stays a bootstrap-container concern.
- API: D's routes (`/api/scenarios`, `/api/inspect`, `/api/verify`, `/api/resolve`, `/api/records/build`,
  `/api/health`, `/api/capabilities`) with 422/404/413 semantics. Adopt; Go `net/http`.
- Console: D React 19 + Vite + Vitest in Node 22; I one static page embedded in the binary (Ilija chose
  "thin page"). **Drop React/Node entirely.** Three sections stay as D specified (scenarios, trace,
  owner form) plus persistent lab-trust label and actual-vs-expected display.

### 2.7 Testing
D: pytest unit/integration/parity + Vitest; I: `go test` + vectors + compose `test` service. Same
philosophy (TDD, no fake verdicts, integration against the real lab). Go removes two toolchains. Keep
D's five "Review Focus" classes (RR mixing, timeouts/TLS failures never accepted, key substitution,
scenario order/cache, out-of-scope inputs make zero network calls) as the acceptance list.

### 2.8 Team model and humans' work (the real difference)
D assumes three people each own code. Under I's model the humans' 22 hours go to:
- **Reviewer:** reads each merged task against RFC 9704 §5–7 and D's contracts; writes/approves the
  expected-outcome table; signs off the hour-5 trust gate and the hour-11 end-to-end gate.
- **Operator:** builds from a clean clone on macOS and Windows at each gate, breaks it, files issues,
  runs the live demo, records the backup video.
- **Storyteller:** README, erratum text (one story, see §2.3), slides, Q&A list; later the Namecheap /
  real-record track (deferred).
This is a better use of 22 h than three partially-idle coders waiting on each other's interfaces, and it
produces humans who can answer the judges.

---

## 3. What each document gets wrong or leaves open

**D**
- Written for a Windows host (`.venv\Scripts`, PowerShell) and for three human lanes; both are now moot.
- Assumes Python 3.13 `python3-unbound` and Node 22 containers — three toolchains for one product.
- Excludes §6.1 entirely, leaving the most predictable judge question unanswered.
- Declines any "no implementation" statement although the authors themselves published "0".
- Does not treat the under-specified points in §2.3 as vectors (`*` is the exception).
- 24 h framing vs the actual 22 h.

**I**
- Scenario naming and zone layout weaker than D's (fixed above).
- Safety wording and runtime input restrictions weaker than D's (adopt D's).
- Had wrong-ds as stretch — acceptable for three coders, not needed once the agent codes.
- `verdict.json` less complete than D's typed reports (adopt D's).
- Commits signed zone files instead of regenerating fixtures (adopt D's relative windows).

---

## 4. Proposed unified timeline (22 h, agent implements, humans gate)

| Hour | Agent delivers (in D's task order, Go) | Human gate |
|---|---|---|
| 0–1 | Kickoff: team settles §1; agent writes the unified design doc + plan on `iradosavljevic/spec` (superpowers format), builder-check | Reviewer approves design |
| 1–4 | Task 1: contracts, canonicalisation, token, record builder, TXT codec, vectors incl. forensics; `inspect`/`build-record` CLI; unit tests | Reviewer checks vectors against RFC + `rfc9704_token_check.py` |
| 4–8 | Task 2: bootstrap (CA, keys, signed zones with BIND tools, CoreDNS configs, PvD docs), compose, validator adapter (miekg/unbound or daemon+EDE) | **Gate A (≈H8):** secure / bogus / insecure / wrong-TLS all real, from a clean clone on both OSes |
| 8–12 | Task 3: verifier pipeline, DoT identity, DS binding, bounded local-A validation; Task 4: six (+1) scenarios, scoped `resolve`, full CLI | **Gate B (≈H12):** all scenarios green from the CLI |
| 12–16 | Task 5–6: API + embedded console; `--external` mode; special-use; DHCP codec | Operator breaks it; Storyteller drafts slides from real screenshots |
| 16–18 | Task 7: vectors + erratum doc; Task 8: parity/acceptance tests, README, demo.md | **Gate C (H18): freeze.** Backup video recorded |
| 18–21 | Bug fixes only | Two timed rehearsals; Q&A drill |
| 21–22 | Buffer | Rest |

Cut order if behind (D's and I's agree): console polish → DHCP codec → `--external` mode → replay
scenario → … never: wrong-ds, real validation, TLS checks, honest verdicts.

---

## 5. Recommendation in one paragraph

Take **D as the product and safety specification** (it traces to the selected PDF and is more rigorous
about scope, inputs and honesty), take **I's RFC findings, vectors, replay scenario, §6.1 mode, DHCP
codec and the agent-implements team model**, and rebuild the **engineering stack in Go with Docker-only
builds**: one binary (CLI + API + embedded console), libunbound semantics via cgo with a decided daemon
fallback, CoreDNS serving zones signed by BIND tools in a one-shot bootstrap, D's per-scenario zones and
relative signature windows. Re-baseline to 22 hours with three human gates. The next step, once the team
agrees §1, is a single unified design document in `docs/superpowers/specs/` that states explicitly what
changed relative to the 27 Oct design and why, followed by the implementation plan.

## 6. Open items that are not decisions yet
- Confirm the git identity for this branch (`Ilija Radosavljevic <45182003+ilija02@users.noreply.github.com>`,
  derived from GitHub user `ilija02`; the Diplomski repos on GitLab use the Rivian address).
- Namecheap: whether the two owned domains can be DNSSEC-signed quickly (Namecheap BasicDNS/PremiumDNS
  have a DNSSEC toggle in the UI; API support for the toggle is doubtful). Deferred until the lab works.
- Whether Djordje's two documents move under `docs/superpowers/` on `main` as history, or stay on his branch.
