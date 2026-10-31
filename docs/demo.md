# SplitTrust: the 5-minute demo

Two companies, the same week, the same employee habits. **Alfa** adopted RFC 9704 with SplitTrust: its
zone is the real, DNSSEC-signed `zivkovic.me` and it published one Verification Record. **Beta** did not:
its devices use whatever resolver the network hands them. Every Alfa verdict on screen is computed live
against the real DNS (root, `.me`, Cloudflare, dns.quad9.net); every record can be checked from a laptop
in the room.

Everything happens in the deck at `http://127.0.0.1:8000`: a title slide, three scenes, then "What we
built" (architecture) and "What we found" (the RFC's broken example, recomputed live), one screen each. `→` advances, `space` replays the animation, `1 2` switch Alfa's device (laptop, phone), `e` shows
the raw evidence. The screen carries drawings and results; you carry the details (this script). Rehearse
twice with a timer; record a backup video. The demo needs the venue's Internet.

## Before you go on stage

```bash
docker compose -f lab/compose.yaml up --build -d        # from a clean clone: a few minutes
docker compose -f lab/compose.yaml exec app splittrust verify --scenario real-office    # must say ACCEPTED
open http://127.0.0.1:8000
```

If anything looks stale: `docker compose -f lab/compose.yaml down -v && docker compose -f lab/compose.yaml up --build -d`.

## Script

| Time | Say | Show |
|---|---|---|
| 0:00-0:40 | Two companies. Both run an intranet that only the office resolver knows. Alfa published one TXT record in its real zone and runs a resolver that checks on its laptops. Beta did neither. Nothing in today's DNS lets a device check whether the network's resolver is allowed to answer for a company's names; encrypting DNS does not help when you talk to the wrong server. RFC 9704 fixes that, and had no public implementation. | Title slide: the two company cards. |
| 0:40-1:30 | Monday at the office. Alfa's laptop verifies the network's claim before trusting the office resolver: computes the token, makes the resolver prove its name, fetches Alfa's record from the real zone and validates it from the root down. Accepted. Beta's laptop just uses the resolver. Both intranets load. The difference is invisible on Monday. | Slide 2, Monday: the drawing runs (Alfa's packet goes up to "the real DNS" and comes back green), then both browser frames show the intranets. Mention that `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` works from any laptop in the room. |
| 1:30-2:40 | Tuesday at the hotel. The hotel Wi-Fi claims both domains and its resolver serves a copy of each zone; for Alfa it even publishes a record with the correct token. Beta's laptop does what it did on Monday and gets the hotel's page: the credentials are gone. Alfa's laptop validates the record against the real DNSSEC chain; the hotel has the token but not Cloudflare's signatures. Bogus, rejected, resolver never used. The name fails to resolve instead of resolving to the wrong place. Press 2: Alfa's phone with Private DNS asks Quad9 and reaches the real site. | Slide 3, Tuesday: the hotel resolver wears a mask; Alfa's check comes back red at "the real DNS"; browser frames: "Intranet login" (the hotel's) on the left, "This site can't be reached" on the right. Press `2`: Alfa's phone goes to Quad9 and the right frame shows the real zivkovic.me. |
| 2:40-3:20 | What Alfa's IT did: enabled DNSSEC (Cloudflare, one click, DS at the registry), published one TXT record built with the owner tool, pointed its devices at a resolver that checks. No application changes. And the record being public is fine: a copied claim is rejected on the resolver's certificate before the first query. | Slide 4: three tiles (sign the zone, publish one record, devices that check) with the real zone's DS and TXT as they are right now; below, the copied claim rejected on the certificate (`dns.hotel.lab` vs the announced name). |
| 3:20-4:00 | What we built: one Go binary, 5,200 lines, libunbound in-process: claim and token, PvD and DHCP, DoT identity, DNSSEC validation through the network's resolver, ds binding, grants; three faces: CLI, HTTP API (this deck), and a Do53 proxy any stub can use, with EDE codes. A Docker lab: BIND private root with seven signed zones, CoreDNS office and hotel resolvers (honest, forging, plain), PvD server, quad9.lab, 13 scenarios times 3 device profiles, 46 integration checks. And a real zone. | Slide 5, the architecture drawing. Point at the proxy box: that is what the laptops in the scenes used. |
| 4:00-4:40 | The RFC's only worked example is wrong, and we know exactly why: 63 characters, 47 octets, SHA-384 gives 48. Our engine recomputes it live on this slide: with the printed salt, a different token; with the previous draft's salt, a token whose first 40 characters match the printed one, and dropping the single zero octet at offset 30 gives the printed token exactly. A C-string bug, then a salt reworded without recomputing. Eight more decisions the RFC leaves to implementers, each a vector and a scenario. | Slide 6: the three token rows (the green prefix) and the list on the right. |
| 4:40-5:00 | Limits and ask: needs resolver or OS support to be transparent; unsigned zones lean on the external resolver; discovery is pre-configured in the lab. Ask: file the erratum, publish the vectors to the ADD working group, get one resolver vendor to try it. | Slide 6, bottom line. |

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Is this real or a lab trick?" | Slide 4 | Alfa's zone is `zivkovic.me` at Cloudflare, DNSSEC-signed, DS at the `.me` registry. `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` and `dig +short zivkovic.me DS` from any laptop. The hotel and the office networks are containers; the verdicts are computed against the real DNS. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Slide 2 | No. `splittrust proxy` is a DNS server; the demo's protected device is a plain container whose DNS server is the proxy. On a laptop this is the dnscrypt-proxy pattern (127.0.0.1); a product would drive the OS split-DNS machinery (systemd-resolved, Windows NRPT). |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; DNSSEC validation is unbound itself via libunbound. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`; all services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- Alfa's verdict says "no answer": the venue's Internet or DoT to 9.9.9.9 is blocked. Show the lab scenarios from the CLI (`docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged`, no Internet needed) or play the backup video.
- A browser frame says "Loading..." for more than a few seconds: `docker compose -f lab/compose.yaml restart proxy`; the deck re-joins the client on the next slide change.
- Everything else: play the backup video.
