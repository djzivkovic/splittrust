# SplitTrust — review, findings and 22-hour plan (team of 3)

Sources read: `SplitTrust_Proposal_NXDOMAIN.pdf`, hackathon guidelines, `Put jednog DNS upita.html`,
RFC 9704 (+ errata, + drafts -00…-14, + the authors' DNS-OARC 44 slides), RFC 8801, 3118, 8415 §20–21,
3396, 4034 §6, 4035 §2.3/§4.3, 8976 §2.2.3/§5.3, 9462, 9463, 6761, 9525.
All numbers below were recomputed with `rfc9704_token_check.py` (next to this file, stdlib only).

---

## 1. Verdict on the proposal

Strong, original, well scoped, and compliant with the security rules (isolated lab, synthetic data,
no third-party probing). The study guide is accurate — every number in it reproduces
(`PJv5…`, `oBAm…`, `rMcY…`, `wA1l…`). Two things to fix before you present:

1. **The erratum story is much stronger than "47 bytes ≠ 48 bytes".** See §2.1 — you can show
   *exactly* how the RFC example broke, and in doing so prove your token code agrees with the
   authors' own computation to 240 bits.
2. **Internal inconsistency:** Figure 1 lists "wrong `ds` value" as one of the six lab scenarios,
   but the roadmap puts the `ds`/`resolver.arpa` check under "if time allows". Pick one. Recommendation:
   replace scenario 6 with the *replayed claim / TLS name mismatch* scenario (§4), keep `ds` as stretch.

Smaller wording points: "RFC 9704 fixes this" → "gives hybrid clients a way to check this" (it only
helps devices that implement it, and only for hybrid clients). "We found no implementation" → cite
the authors' own slide at DNS-OARC 44 (Feb 2025): *"0 — Number of known implementations of RFC 9704"*,
and say "no public implementation that we could find as of Oct 2026".

---

## 2. Findings in RFC 9704 (what SplitTrust can report / must decide)

### 2.1 §5.1 example — forensics (erratum #1, Technical)

| | Salt string | Correct SHA-384 token (64 chars) |
|---|---|---|
| draft-07 (Dec 2023) | `example salt bytes (should be random)` | `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8AEtcHrFQkfiiQ79nhcHyXFkD` |
| draft-10 → RFC 9704 | `example salt octets (should be random)` | `wA1lI3Tdnm2z3rbjAa6A998luwSDTU9LU45SoruhsTBtmcdL5BhalHS2v5UCSzal` |
| **printed in RFC** | (`octets`) | `z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR-KJDv2eFwfJcWQM` (63 chars) |

- The printed token is **exactly** the SHA-384 digest for the *draft-07* salt ("bytes") with its single
  `0x00` byte (position 30 of 48) removed before base64url encoding — a full 63-character match, which
  explains both the 47-byte length and the "garbled" tail. The helper that produced the example evidently
  handled the digest as a C/NUL-terminated string. Then the salt wording was edited to "octets" in draft-10
  (the same edit changed "zero byte" → "zero octet") and the token was never recomputed.
- Djordje's research notes (referenced in his plan as "the helper's different salt" and "NUL-removal
  reproduction") appear to have reached the same two observations independently — so the team already
  owns this finding twice; make sure the erratum text and the slide tell it as one story.
- The draft-04 example (`6rQ7oO…MCg`, 66 chars = 49 bytes) was *also* not a valid SHA-384 output.
- Nothing about this is in the RFC errata (only 8590, the RFC 6698 → 4033 reference) or in the WG's
  GitHub issue tracker. It is new.
- Bonus: this *validates your reading of the algorithm* (length-prefixed salt, wire-format labels,
  trailing zero octet, canonical order). Say so on stage.

Erratum text: offer the RFC Editor both consistent fixes (keep "octets" → token `wA1l…`; or restore
"bytes" → token `z1qy…XFkD`).

### 2.2 Figure 1 (§7) NSEC line is wrong (erratum #2, lower priority)
`@ IN NSEC subdomain.parent.example. NS` — an NSEC at the apex with a type bitmap of only `NS` violates
RFC 4035 §2.3 (bitmap MUST include NSEC and RRSIG; apex also has SOA/DNSKEY). The insecure-delegation
proof it is trying to show is the NSEC **at the delegation point**: `subdomain IN NSEC <next> NS RRSIG NSEC`
(DS bit clear), plus the `subdomain IN NS …` delegation that the figure omits.

### 2.3 Under-specified points → SplitTrust must choose, document, and ship a test vector for each
1. **`*` (whole zone) hashing.** Is the pseudo-FQDN `\x01*\x00` or just `\x00`? Not stated. Choose
   `\x01*\x00` — RFC 4034 §6.2(4) keeps `*` as a literal label in canonical form, and the DHCP encoding
   can only carry `*` as a label anyway.
2. **Key/value delimiter in the TXT record.** Only shown by example (`"token=abc...,ds=QWE..."`).
   Accept comma-separated pairs in one string and pairs split across TXT strings; emit comma.
3. **Multiple claims over DHCP are impossible.** RFC 9704 says "*each* claim is encoded as a DHCP
   Authentication option", but RFC 8415 §20.2: "Any DHCP message MUST NOT include more than one
   Authentication option", and in DHCPv4 RFC 3396 (which 9704 invokes) makes clients *concatenate*
   repeated option 90 instances — and `$X` is not self-delimiting. One claim per DHCP message; PvD has no limit.
4. **Replay Detection field.** 9704 mandates RDM = 0 but never says what to put in the 64-bit field.
   RDM 0 means a strictly increasing counter, and an RFC 8415 §20.3 client MUST reject a message whose
   value is not greater than the last one from that server. A server sending a constant breaks on the 2nd
   message. Encoder: use an NTP-style timestamp; decoder: ignore.
5. **`ds=` digest owner name.** DS digest = hash(owner | DNSKEY RDATA). Over `resolver.arpa.` or over
   the claimed subdomain? Text implies `resolver.arpa.`; a zone operator who pastes the normal
   `dnssec-dsfromkey` output of the child zone will produce a non-matching value. (Stretch; document.)
6. **IDNA not mentioned.** PvD JSON may carry U-labels (`интранет.фирма.срб`); hash A-labels. Nice local
   angle for an RNIDS audience — make it a test vector.
7. **Order/case in PvD.** The verifier must always re-sort and lowercase itself (and warn when the
   network's `subdomains` array is not already in canonical order), otherwise two clients can disagree.
8. **Edge cases:** empty subdomain list, duplicates, salt > 255 octets, salt of 0 octets (allowed by the
   text — warn), subdomain not under parent (DHCP form), `*` mixed with other names → reject or warn; decide.
9. **Special-use names** (RFC 6761 registry: `.test`, `.localhost`, `.invalid`, `.example`, `.local`,
   `.onion`, `home.arpa`, `resolver.arpa`, `ipv4only.arpa`, `.alt`, …) MUST NOT be validated → explicit
   verdict `REJECTED / SPECIAL_USE`. Costs nothing, demonstrates spec fidelity.

### 2.4 Security points worth one slide
- A **matching token is not proof**: the hotel can compute the token for its own claim; the hotel can even
  *replay* firma's real claim (record exists, token matches). What stops it is (a) the tamperproof fetch
  and (b) the ADN ↔ TLS certificate binding when the client connects to the resolver. Show both.
- Unsigned parent zone + external-resolver path is legal (§6.2 Insecure → §6.1) but rests entirely on
  the external resolver and its path to the authoritatives. That is the justification for the owner tool's
  "your zone is not signed" warning. Mark the verdict yellow, not green.
- A hostile network blocking the external resolver → timeout → §6.1 says MUST fail. Rejection is the
  safe default; the attack degrades to denial of service, which the hotel could do anyway.

---

## 3. Risks for the 22 hours (ranked) and how to defuse them

| # | Risk | Mitigation |
|---|---|---|
| 1 | Writing DNSSEC chain validation yourself (NSEC/NSEC3 Insecure proofs are the hard part) | **Don't.** Run a validating resolver *on the client* (unbound with the lab trust anchor, like systemd-resolved/unbound on a real device). Map: `AD=1` → Secure; `SERVFAIL` with CD=0 but answer with CD=1 → Bogus; `NOERROR, AD=0` → Insecure. Cross-check with `delv -a lab-anchors`. This *is* the architecture of a validating stub, so the tamperproof property holds. |
| 2 | Web console eats the night | CLI with JSON output first. Console = one page that calls the same engine function and renders the `steps[]` array. No framework beyond FastAPI + a static HTML/HTMX page (or Streamlit). |
| 3 | Certificates everywhere (DoT on 3 resolvers, HTTPS on 2 PvD servers) | One `make ca` script in hour 1 producing a lab CA + all leaf certs into one shared volume; client trusts only that CA. |
| 4 | IPv6 RA with the PvD option in Docker | Do not. Give the client the PvD ID as if learned from RA (`--pvd pvd.firma.lab`); state it on the slide. The fetch rules of RFC 8801 §4.1 (HTTPS, cert DNS-ID == PvD ID, `expires`, `identifier`) are what you demonstrate. |
| 5 | DHCP transport | Ship encode/decode of the option 90/11 **payload** with test vectors (cheap, high value). Real dnsmasq `dhcp-option=90,<hex>` + tcpdump only if hour 17 arrives with everything green. |
| 6 | Four deliverables for three people | Cut list, in order: `ds` check → live DHCP → console animations → scenario 6 → owner-tool DNSSEC lookup. Never cut: engine + vectors + erratum + scenarios 1, 2, 5 + slides + backup video. |
| 7 | Live demo failure | Record a 3-minute screen capture at H17–19 and keep `make demo` idempotent (`make reset`). |

---

## 4. Lab design (one `docker compose up`)

Network `10.77.0.0/24`, private TLD `.lab` served by a lab root. One BIND 9 container serves **all**
authoritative zones (root, `lab`, `firma.lab`, `banka.lab`, `nepotpisana.lab`, `istekla.lab`) — far
simpler than one container per zone.

| Container | Role | Notes |
|---|---|---|
| `auth` | BIND 9 authoritative for all zones | `dnssec-keygen` + `dnssec-signzone`; `istekla.lab` signed with `-e <yesterday>`; `nepotpisana.lab` unsigned (no DS in `lab`); DS records for signed zones in `lab`, DS for `lab` in root |
| `external` | "Quad9": unbound, validating, DoT `quad9.lab` | lab root hints + `trust-anchor` for lab root; `tls-service-pem/key`; port 853 |
| `dns-firma` | company resolver, DoT ADN `dns.firma.lab` | `local-data` for `intranet.firma.lab`, `mail.firma.lab` → 10.0.5.x; forwards rest to `external` |
| `dns-hotel` | hotel resolver, DoT ADN `dns.hotel.lab` | `local-data` hijacking `banka.lab` → 10.77.0.66 |
| `pvd-firma` | nginx 443, `pvd.firma.lab` | serves `/.well-known/pvd` with `splitDnsClaims`, `Content-Type: application/pvd+json` |
| `pvd-hotel` | nginx 443, `pvd.hotel.lab` | hotel's claim for `banka.lab` (`"subdomains":["*"]`) |
| `client` | Python engine + CLI + console :8080 + local validating unbound on 127.0.0.1 | trusts only the lab CA; `/etc/resolv.conf` → 127.0.0.1 |
| `dhcp` (stretch) | dnsmasq emitting option 90 | only if time |

Scenarios (`make scenario N`, each prints the verdict + reason + step trace):

| # | Setup | Expected verdict |
|---|---|---|
| 1 | firma claims `intranet`,`mail`; zone signed; record correct | **ACCEPTED / SECURE_TOKEN_MATCH** → then DoT query `intranet.firma.lab` via `dns.firma.lab` returns 10.0.5.20 (the payoff) |
| 2 | hotel claims `*` of `banka.lab` | **REJECTED / NO_RECORD** (authenticated NXDOMAIN); `banka.lab` keeps resolving via `external` |
| 3 | IT added `vpn.intranet`, new salt, record not yet published | **REJECTED / TOKEN_MISMATCH** (lesson: publish record first, RFC §11) |
| 4 | `istekla.lab`: signatures expired | **REJECTED / BOGUS** |
| 5 | `nepotpisana.lab` unsigned: run in `--mode dnssec` then `--mode both` | **REJECTED / INSECURE_NO_FALLBACK**, then **ACCEPTED / EXTERNAL_TOKEN_MATCH** (yellow) |
| 6 | hotel replays firma's claim (ADN `dns.firma.lab`) but its resolver presents the `dns.hotel.lab` cert | token matches → **REJECTED / TLS_NAME_MISMATCH** |
| 6b (free) | claim for `home.arpa` | **REJECTED / SPECIAL_USE** — no lab needed |
| 7 (stretch) | `ds=` present, local `resolver.arpa.` DNSKEY doesn't match | REJECTED / DS_MISMATCH |

---

## 5. Interfaces to agree in hour 0 (so three people can work in parallel)

`claim.json` (input, same for PvD/DHCP/manual):
```json
{"source":"pvd","resolver":"dns.firma.lab","parent":"firma.lab",
 "subdomains":["intranet","mail"],"algorithm":"SHA384","salt":"Vn3kQ2r9bXz0pLm4Yt8wHA"}
```
`verdict.json` (output, consumed by CLI printer and console):
```json
{"verdict":"ACCEPTED|REJECTED|UNPROVEN",
 "reason":"SECURE_TOKEN_MATCH|EXTERNAL_TOKEN_MATCH|NO_RECORD|TOKEN_MISMATCH|BOGUS|INSECURE_NO_FALLBACK|TIMEOUT|SPECIAL_USE|MALFORMED_CLAIM|TLS_NAME_MISMATCH",
 "record_name":"dns.firma.lab._splitdns-challenge.firma.lab.",
 "expected_token":"…","observed_tokens":["…"],"dnssec_state":"secure|insecure|bogus|n/a",
 "authorized_names":["intranet.firma.lab","mail.firma.lab"],
 "steps":[{"n":1,"title":"Canonical order","detail":"…","data":{}}]}
```
`UNPROVEN` = token matches but the fetch path was not tamperproof (the guide's "pazi" case).

CLI contract (Python package `splittrust`, entry point `splittrust`):
```
splittrust token   --parent firma.lab --sub intranet --sub mail --salt-b64 Vn3k… [--alg SHA384]
splittrust record  --adn dns.firma.lab --parent firma.lab --sub … [--salt auto]   # owner tool → zone line + warnings
splittrust verify  --claim claim.json --mode dnssec|external|both --stub 127.0.0.1 --external quad9.lab:853 --ca lab-ca.pem [--json]
splittrust pvd     --id pvd.firma.lab --ca lab-ca.pem            # fetch + validate PvD JSON → claims
splittrust dhcp    encode claim.json | decode <hex>              # option 90/11 payload
splittrust vectors > test_vectors.json
```
Console: `GET /` page; `POST /api/verify` (claim.json → verdict.json); `POST /api/record`;
`GET /api/scenario/{n}` runs the preset claim against the lab.

Lab constants (fixed in hour 0, never change): hostnames/IPs above, lab CA path `/lab/ca/ca.pem`,
salts and tokens for scenarios 1–6 generated once by `splittrust record` and committed to `lab/zones/`.

---

## 6. Roles and timeline (H0 = start of the 22 hours)

**A — Engine** (Python, dnspython, cryptography). **B — Lab** (Docker, BIND, unbound, nginx, CA).
**C — Console, vectors, erratum, pitch** (FastAPI/HTMX or Streamlit; writing).

| Hours | A — Engine | B — Lab | C — Console / story |
|---|---|---|---|
| 0–1 | Kickoff together: agree §5 interfaces, repo layout, licence (MIT/Apache-2.0), scenario list. Everybody reads RFC 9704 §3, §5–§6 (4 pages). Send organisers the one-paragraph scope note promised in the proposal. |||
| 1–5 | Canonicalisation, sort, `$X`, token, record name, TXT k/v parser, claim validation (special-use, edge cases), unit tests, reproduce §2.1 forensics and guide numbers | `make ca`; BIND with all zones signed (one expired, one unsigned); lab root hints; `external` unbound validating + DoT; `dig @external … TXT +dnssec` shows `ad` | Console skeleton + owner tool (`/api/record`) calling A's package; erratum draft from §2.1; README skeleton |
| **5** | **Checkpoint 1:** `splittrust vectors` reproduces every number in §2.1; inside the lab `dig` of the firma record returns AD=1, `istekla.lab` → SERVFAIL, `nepotpisana.lab` → no AD. |||
| 5–11 | Resolution backends: validating stub (AD/CD/SERVFAIL mapping), external DoT with CA + SNI + timeout, verdict logic, PvD fetch/validation (RFC 8801 §4.1/§4.3), DHCP payload encode/decode | `dns-firma`, `dns-hotel` (DoT), `pvd-firma`, `pvd-hotel`, `client` with local unbound + lab CA; `make scenario N` runner; `make reset` | Step-trace rendering, scenario buttons, verdict colours (green/red/yellow); test-vector doc; slide outline |
| **11** | **Checkpoint 2:** scenarios 1 and 2 pass end-to-end from the CLI inside `client`. Start nap rotation (2–3 h each: C 10–12, A 12–14, B 14–16). |||
| 11–17 | Scenario 6 (TLS name check on use), UNPROVEN path, polish reasons, `vectors` export incl. IDN/`*`/SHA512/edge cases, docstrings | Scenarios 3–6 data, DoT "use" step for scenario 1, hardening (idempotent compose), optional dnsmasq option 90 | Console wired to all scenarios, owner tool warnings, README, erratum final text, deck v1 |
| **17** | **Checkpoint 3:** all six scenarios green from the console; feature freeze. |||
| 17–19 | Bug fixes only | Record backup video of the full demo; `docker compose up` from clean checkout | Dry-run the pitch twice with a timer; Q&A list (§8) |
| 19–21 | Tidy repo, tag `v0.1` | Final `make demo` rehearsal | Deck final, speaker split (A: engine+erratum, B: lab demo, C: problem+impact) |
| 21–22 | Buffer. Rest. |||

Definition of done per deliverable: engine (tests green, `vectors` file committed), lab (`make demo`
from clean clone < 3 min), console (six buttons, each shows trace + verdict), vectors + erratum
(markdown in repo, erratum text ready to paste into rfc-editor.org form **after** the hackathon —
the rules say report privately first; an RFC example error is not a vulnerability, but still hand it to
the organisers first and submit the erratum afterwards).

---

## 7. How to learn this fast (time-boxed)

Use your own guide (`Put jednog DNS upita.html`) as the onboarding doc — it is correct; I recomputed
its numbers. Then:

**Everyone (≈ 60 min, hour 0–1)**
- RFC 9704 §3 Scope, §5 + §5.1 + §5.2.2, §6 (+ the §6.2 erratum 8590). Skip §7–§10 for now.
- Guide chapters "Split-horizon DNS" and "RFC 9704 korak po korak".
- 20-minute exercise: A and C *independently* implement the token from the RFC text (no peeking at
  each other or at `rfc9704_token_check.py`), then compare against the §2.1 table. If you both match
  `wA1l…` and the 40-char prefix of the RFC token, you have read the spec correctly — and you have a
  slide ("two independent implementations agreed with each other and with the authors' 240 bits").

**A — Engine (≈ 45 min extra)**
- RFC 4034 §6.1 canonical order (1 page; right-to-left label compare, lowercase, absent < `\0`).
- RFC 3118 §2 and RFC 8415 §21.11 option layouts (1 page each); RFC 8976 §5.3 registry table
  (1 = SHA384, 2 = SHA512, mnemonics without a hyphen).
- RFC 4035 §4.3 validation states; dnspython: `dns.message.make_query(..., want_dnssec=True)`,
  flags `AD`/`CD`, `dns.query.tls(..., ssl_context=, server_hostname=)`, `dns.rdtypes.ANY.TXT.strings`.
- RFC 9525 §6 for name matching when checking the resolver's certificate against the ADN.

**B — Lab (≈ 60 min extra, hands-on)**
- `dnssec-keygen -a ECDSAP256SHA256 -f KSK`, `dnssec-signzone -S -o zone -e 20251001000000 …`
  (expired), `dnssec-dsfromkey`; a root zone + `lab` TLD in `named.conf`; `dig +dnssec +cd`, `delv -a`.
- unbound: `root-hints`, `trust-anchor:`/`trust-anchor-file`, `tls-service-pem/key`, `interface: …@853`,
  `local-zone`/`local-data`, `forward-zone` with `forward-tls-upstream: yes`, `tls-cert-bundle`.
- RFC 8801 §4.1 and §4.3 (fetch rules, mandatory keys `identifier`, `expires`, `prefixes`; media type
  `application/pvd+json`).

**C — Console / story (≈ 45 min extra)**
- RFC 9704 §8 (the figures are your storyboard), §11 (claim update order = scenario 3), §12.
- RFC 8801 §4.3 JSON shape; RFC 9704 §13.2–13.3 PvD keys.
- The DNS-OARC 44 slides (search "Hot off the Queue: RFC 9704") — quotable: "0 known implementations…
  actually getting it implemented might require a miracle".
- Verify before quoting on stage: Firefox's DoH suffix-exclusion behaviour (test in a VM or cite the
  docs verbatim), and the root KSK-2024 rollover dates in the guide.

---

## 8. Pitch (8–10 slides, 3-minute live demo) and likely questions

1. The gap in 30 s: hotel Wi-Fi says "I am authoritative for banka.rs"; encryption does not help.
2. **Live:** scenario 2 (hotel → rejected), scenario 1 (firma → accepted, then the DoT query to
   `intranet.firma.lab` works) — 90 s total. Scenario 5 if time (red in dnssec mode, yellow in both).
3. What RFC 9704 does in one picture (your Figure 1).
4. What we built: engine + lab + console + vectors (one slide, one screenshot each).
5. **The erratum slide** (§2.1 table, highlight the 40 matching characters) — the room will remember this.
6. What implementers need to decide that the RFC doesn't say (§2.3, five bullets).
7. Security impact and honest limits: needs OS/browser support; hybrid clients only; special-use names
   out of scope; unsigned zones lean on the external resolver.
8. Next steps: erratum submission, vectors published, note to the ADD WG list with §2.3.

Likely questions — one-line answers:
- *Why would a hotel announce a claim at all?* Because without RFC 9704 a hybrid client has to guess;
  with it, the hotel needs the bank's cooperation and gets nothing without it.
- *Isn't HTTPS/HSTS enough?* Browsers mostly, yes; apps with weak cert checks, IoT, internal
  services, and tracking/blocking are not covered.
- *Why DNSSEC on the device, nobody does that?* iOS 16+ has a validating stub option; and §6.1 works
  without it if you already use an external encrypted resolver — the lab shows both paths.
- *Why `.lab`?* `.test` is special-use (a correct verifier must refuse it), `.internal` is ICANN-reserved
  for names that never reach public DNS, which is exactly what the lab pretends to be. Cleanest would be a
  subdomain you own — say so.
- *Did you touch any real system?* No: isolated Docker network, throwaway keys, synthetic data; the
  only external traffic is ordinary DNS and package downloads.

---

## 9. Repo layout (suggested)

```
splittrust/
  splittrust/           # engine: claim.py canonical.py token.py record.py txt.py pvd.py dhcp.py
                        #         resolve.py (stub/external) verdict.py cli.py
  tests/                # pytest; vectors.json is both a fixture and a deliverable
  console/              # FastAPI app + static/index.html
  lab/                  # docker-compose.yml, ca/, auth/ (zones + Makefile), unbound/, nginx/, client/
  docs/                 # erratum.md, test-vectors.md, scenarios.md, slides/
  Makefile              # make ca | up | scenario N | demo | reset | vectors | test
```
