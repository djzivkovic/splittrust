# SplitTrust: the 5-minute demo

Two companies, the same week, the same employee habits. **Alfa** adopted RFC 9704 with SplitTrust: its
zone is the real, DNSSEC-signed `zivkovic.me` and it published one Verification Record. **Beta** did not:
its devices use whatever resolver the network hands them. Every Alfa verdict on screen is computed live
against the real DNS (root, `.me`, Cloudflare, dns.quad9.net); every record can be checked from a laptop
in the room.

Everything happens in the deck at `http://127.0.0.1:8000`, sixteen slides. Introduction: 1 title, 2 the
problem, 3 why today's tools do not close the gap (click through the four options), 4 how RFC 9704 works,
5 our solution, 6 try it (the owner tool, live against the real zone), 7 the two companies. Demo: 8 Monday,
9 Tuesday, 10 what Alfa did. Substance: 11 why adopt it, 12 what we built, 13 the lab right now, 14 what's
next, 15 closing. `→` advances, `space` replays an animation, `1 2` switch Alfa's device (laptop, phone),
`t` switches the terminal panel on the demo slides between the proxy's live log and the dig output of the
two lookups. The terminal is the proof that the lab is real. Five minutes cannot show all of it: the
script below skips 3, 6, 11 and 14 and keeps them for questions.

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
| 0:00-0:30 | A hotel Wi-Fi tells your laptop: my resolver answers for your bank. Nothing today lets the laptop check whether the bank agreed; encrypting DNS to that resolver is a private conversation with the attacker. RFC 9704, January 2025, gives the owner a way to say who may answer and the device a way to check. No public implementation existed. | Slides 1, 2 (skip 3). |
| 0:30-0:55 | Three steps: the owner publishes one TXT record in its signed zone, a salted hash of the claim; the network announces the claim; the device makes the resolver prove its name over TLS, fetches the record with DNSSEC and compares tokens. Only then does it route those names there. | Slide 4. |
| 0:55-1:10 | We built SplitTrust: the complete device side in one Go binary, a DNS proxy any client can use, the owner's tool, and a lab that attacks it; proven against our real zone. (Slide 6 is the owner tool live; use it in Q&A.) Two companies, one week: Alfa adopted it, Beta did not. | Slides 5, 7 (skip 6). |
| 1:10-1:50 | Monday at the office. Alfa's laptop verifies the network's claim before trusting the office resolver: computes the token, makes the resolver prove its name, fetches Alfa's record from the real zone and validates it from the root down. Accepted. Beta's laptop just uses the resolver. Both intranets load. The difference is invisible on Monday. | Slide 8, Monday: the drawing runs (Alfa's packet goes up to "the real DNS" and comes back green), then both browser frames show the intranets. Mention that `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` works from any laptop in the room. |
| 1:50-2:50 | Tuesday at the hotel. The hotel Wi-Fi claims both domains and its resolver serves a copy of each zone; for Alfa it even publishes a record with the correct token. Beta's laptop does what it did on Monday and gets the hotel's page: the credentials are gone. Alfa's laptop validates the record against the real DNSSEC chain; the hotel has the token but not Cloudflare's signatures. Bogus, rejected, resolver never used. The name fails to resolve instead of resolving to the wrong place. Press 2: Alfa's phone with Private DNS asks Quad9 and reaches the real site. | Slide 9, Tuesday: the hotel resolver wears a mask; Alfa's check comes back red at "the real DNS"; browser frames: "Intranet login" (the hotel's) on the left, "This site can't be reached" on the right. Press `2`: Alfa's phone goes to Quad9 and the right frame shows the real zivkovic.me. |
| 2:50-3:20 | What Alfa's IT did: enabled DNSSEC (Cloudflare, one click, DS at the registry), published one TXT record built with the owner tool, pointed its devices at a resolver that checks. No application changes. And the record being public is fine: a copied claim is rejected on the resolver's certificate before the first query. | Slide 10: three tiles (sign the zone, publish one record, devices that check) with the real zone's DS and TXT as they are right now; below, the copied claim rejected on the certificate (`dns.hotel.lab` vs the announced name). |
| 3:20-3:50 | What we built: one Go binary, 5,200 lines, libunbound in-process: claim and token, PvD and DHCP, DoT identity, DNSSEC validation through the network's resolver, ds binding, grants; three faces: CLI, HTTP API (this deck), and a Do53 proxy any stub can use, with EDE codes. A Docker lab: BIND private root with seven signed zones, CoreDNS office and hotel resolvers (honest, forging, plain), PvD server, quad9.lab, 13 scenarios times 3 device profiles, 46 integration checks. And a real zone. | Slide 12, the architecture drawing (skip 11). Point at the proxy box: that is what the laptops in the scenes used. |
| 3:50-4:35 | The lab, right now: fourteen containers probed from this page every four seconds, DNS queries, TLS handshakes, HTTP requests. The proxy's live log on the right is what the laptops' queries did during the scenes. Nothing was recorded. If asked about the RFC: its one worked example cannot be reproduced (47 bytes where SHA-384 gives 48; the earlier draft's salt plus a dropped zero byte explains it exactly); the erratum and 20 test vectors are in the repo. | Slide 13: the green dots and the log. |
| 4:35-5:00 | What is real: the implementation, the proxy, the real zone, the vectors. What is not yet: OS integration, DHCP on the wire, unsigned zones. Ask: file the erratum, publish the vectors to the ADD working group, get one resolver vendor to try it, sign your zone. | Slide 15 (skip 14). |

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Is this real or a lab trick?" | Slides 6, 10 and 13, and `t` on any scene | Alfa's zone is `zivkovic.me` at Cloudflare, DNSSEC-signed, DS at the `.me` registry. `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` and `dig +short zivkovic.me DS` from any laptop. The hotel and the office networks are containers; the verdicts are computed against the real DNS. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Slides 5 and 8 | No. `splittrust proxy` is a DNS server; the demo's protected device is a plain container whose DNS server is the proxy. On a laptop this is the dnscrypt-proxy pattern (127.0.0.1); a product would drive the OS split-DNS machinery (systemd-resolved, Windows NRPT). |
| "Why not just a VPN / DoH / DNSSEC?" | Slide 3 | Click through: encrypted DNS is a private conversation with the attacker; an always-on VPN does protect the company's own names (DNS goes through the tunnel to the office resolver) but gives up the local resolver entirely: hairpin, tunnel-first, no local names at partners, branches or home; DNSSEC alone rejects the forgery but also rejects the legitimate intranet, because internal names do not exist in the public zone. RFC 9704 adds the missing sentence: the owner allows this resolver for these names, so you can use the network you are on. |
| "What does a company actually have to do?" | Slides 6 and 11 | Sign the zone, publish one TXT record (type it on slide 6: the token equals the one live in the zone), run DoT with a certificate on the office resolver, and give devices a resolver that checks. No application changes. |
| "Do we need fifteen containers?" | Slide 13 | Nine run the demo (two networks' resolvers, PvD, proxy, app, three pages); the rest are the test bed for the RFC's corner cases and the integration suite. |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; DNSSEC validation is unbound itself via libunbound. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`; all services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- Alfa's verdict says "no answer": the venue's Internet or DoT to 9.9.9.9 is blocked. Show the lab scenarios from the CLI (`docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged`, no Internet needed) or play the backup video.
- A browser frame says "Loading..." for more than a few seconds: `docker compose -f lab/compose.yaml restart proxy`; the deck re-joins the client on the next slide change.
- Everything else: play the backup video.
