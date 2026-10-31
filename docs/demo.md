# SplitTrust: the 5-minute demo

Two companies, the same week, the same employee habits. **Alfa** adopted RFC 9704 with SplitTrust: its
zone is the real, DNSSEC-signed `zivkovic.me` and it published one Verification Record. **Beta** did not:
its devices use whatever resolver the network hands them. Every Alfa verdict that depends on DNS is computed live
against the public DNS (root, `.me`, Cloudflare, dns.quad9.net); the replayed claim is rejected on the
certificate before any DNS query. Every record can be checked from a laptop in the room.

Everything happens in the deck at `http://127.0.0.1:8000`, seventeen slides in pitch order: 1 title,
2 the problem (with the incident evidence), 3 why now (click the milestones: DoT 2016, Android Private DNS
2018, Apple encrypted DNS 2020, DDR 2022, DDR/DNR RFCs 2023, systemd DNR 2024, RFC 9704 January 2025, zero
known implementations February 2025), 4 how RFC 9704 works, 5 our solution, 6 the two companies, 7 Monday,
8 Tuesday, 9 what Alfa did, 10 try it (the owner tool, live against the real zone), 11 who buys and who
ships, 12 why today's tools do not close the gap (click the four options), 13 what changes for a company,
14 what we built, 15 evidence: the lab probed live, 16 what's next, 17 closing. `→` advances, `space`
replays an animation, `1 2` switch Alfa's device (laptop, phone), `t` swaps the browser frames for the dig
output of the two real lookups. The proxy's decisions appear live next to the browser frames on every
scene. Five minutes cannot show all of it: the script skips 10, 11, 12, 13 and 16 and keeps them for
questions.

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
| 0:00-0:30 | A hotel Wi-Fi tells your laptop: my resolver answers for your bank. Nothing today lets the laptop check whether the bank agreed; encrypting DNS to that resolver is a private conversation with the attacker. RFC 9704, January 2025, gives the owner a way to say who may answer and the device a way to check. We found no public implementation; the RFC's authors reported none known in February 2025. | Slides 1, 2. |
| 0:30-0:50 | Why now: every building block ships (DoT since 2016, Private DNS on Android, encrypted DNS and DDR on Apple and Windows, DNR parsed by systemd 257), and RFC 9704 was published in January 2025 with zero known implementations a month later. Three steps: the owner publishes one TXT record, a salted hash of the claim; the network announces the claim; the device makes the resolver prove its name over TLS, validates the record (DNSSEC, or a resolver it already trusts) and compares tokens. Only then does it route those names there. | Slides 3 (click "Jan 2025"), 4. |
| 0:50-1:10 | We built SplitTrust: the device side, verification and enforcement, in one Go binary, a DNS proxy any client can use, the owner's tool, and a lab that attacks it; tested live against the public DNS with our own signed zone. Two companies, one week: Alfa adopted it, Beta did not. | Slides 5, 6. |
| 1:10-1:50 | Monday at the office. Alfa's laptop verifies the network's claim before trusting the office resolver: computes the token, makes the resolver prove its name, fetches Alfa's record from the real zone and validates it from the root down. Accepted. Beta's laptop just uses the resolver. Both intranets load. The difference is invisible on Monday. | Slide 7, Monday: the drawing runs (Alfa's packet goes up to "the real DNS" and comes back green), then both browser frames show the intranets and the proxy's decisions appear on the right. Mention that `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` works from any laptop in the room. |
| 1:50-2:50 | Tuesday at the hotel. The hotel Wi-Fi claims both domains and its resolver serves a copy of each zone; for Alfa it even publishes a record with the correct token. Beta's laptop does what it did on Monday and gets the hotel's page: the credentials are gone. Alfa's laptop validates the record against the real DNSSEC chain; the hotel has the token but not Cloudflare's signatures. Bogus, rejected, resolver never used. The name fails to resolve instead of resolving to the wrong place. Press 2: Alfa's phone with Private DNS asks Quad9 and reaches the real site. | Slide 8, Tuesday: the hotel resolver wears a mask; Alfa's check comes back red at "the real DNS"; browser frames: "Intranet login" (the hotel's) on the left, "This site can't be reached" on the right. Press `2`: Alfa's phone goes to Quad9 and the right frame shows the real zivkovic.me. Press `t` for the dig output: SERVFAIL with EDE 6 on the right, the hotel's A record on the left. |
| 2:50-3:20 | What Alfa's IT did: enabled DNSSEC (Cloudflare signs the zone; the DS record goes to the registry), published one TXT record built with the owner tool, pointed its devices at a resolver that checks. No application changes. And the record being public is fine: a copied claim is rejected on the resolver's certificate before the first query. | Slide 9: three tiles (sign the zone, publish one record, devices that check) with the real zone's DS and TXT as they are right now; below, the copied claim rejected on the certificate (`dns.hotel.lab` vs the announced name). |
| 3:20-3:50 | What we built: one Go binary, about 5,400 lines, libunbound in-process: claim and token, PvD and DHCP, DoT identity, DNSSEC validation through the network's resolver, ds binding, grants; three faces: CLI, HTTP API (this deck), and a Do53 proxy any stub can use, with EDE codes. A Docker lab: BIND private root with seven parent zones (one deliberately unsigned, one with expired signatures), CoreDNS office and hotel resolvers (honest, forging, plain), PvD server, quad9.lab; 13 scenarios across 3 device profiles, 20 expected verdicts, 46 generated checks plus 5 end-to-end tests. And our own signed zone on the public DNS. | Slide 14, the architecture drawing (skip 10 to 13). Point at the proxy box: that is what the laptops in the scenes used. |
| 3:50-4:35 | The lab, right now: 14 endpoints across the lab's services probed from this page every four seconds, DNS queries, TLS handshakes, HTTP requests. The proxy's live log on the right is what the laptops' queries did during the scenes. Nothing was recorded. If asked about the RFC: its one worked example cannot be reproduced (47 bytes where SHA-384 gives 48; the earlier draft's salt plus a dropped zero byte explains it exactly); the erratum and 20 test vectors are in the repo. | Slide 15: the green dots and the proxy decisions. |
| 4:35-5:00 | What is real: the implementation, the proxy, our signed zone on the public DNS, the vectors. What is not yet: OS integration, DHCP on the wire; unsigned zones only through the external-resolver path. Ask: file the erratum, publish the vectors to the ADD working group, get one resolver vendor to try it, sign your zone. | Slide 17 (skip 16). |

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Is this real or a lab trick?" | Slides 9, 10 and 15, and `t` on any scene | Alfa's zone is `zivkovic.me` at Cloudflare, DNSSEC-signed, DS at the `.me` registry. `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` and `dig +short zivkovic.me DS` from any laptop. The hotel and the office networks are containers; the verdicts are computed against the real DNS. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Slides 5 and 7 | No. `splittrust proxy` is a DNS server; the demo's protected device is a plain container whose DNS server is the proxy. On a laptop this is the dnscrypt-proxy pattern (127.0.0.1); a product would drive the OS split-DNS machinery (systemd-resolved, Windows NRPT). |
| "Why not just a VPN / DoH / DNSSEC?" | Slide 12 | Click through: encrypted DNS is a private conversation with the attacker; an always-on VPN does protect the company's own names (DNS goes through the tunnel to the office resolver) but gives up the local resolver entirely: hairpin, tunnel-first, no local names at partners, branches or home; DNSSEC alone rejects the forgery but also rejects the legitimate intranet, because internal names do not exist in the public zone. RFC 9704 adds the missing sentence: the owner allows this resolver for these names, so you can use the network you are on. |
| "What does a company actually have to do?" | Slides 10 and 13 | Sign the zone, publish one TXT record (type it on slide 6: the token equals the one live in the zone), run DoT with a certificate on the office resolver, and give devices a resolver that checks. No application changes. |
| "Do we need fifteen containers?" | Slide 15 | Fifteen compose services: eight long-running containers run the demo (the two networks' resolvers, PvD, proxy, app, three pages), five are the test bed (private root, quad9.lab, banka.lab, two plain clients), plus the one-shot bootstrap and the test runner profile. |
| "Who would buy this?" | Slide 11 | Organisations with split-horizon DNS and roaming devices (banks, hospitals, agencies, universities, branch-heavy firms); OS and MDM vendors ship the check; resolver and DDI vendors (BIND, Unbound, Knot, CoreDNS, Infoblox, BlueCat) already serve inbound DoT with views and would add claim automation. Not consumers, not hotels, not filtering. |
| "DNSSEC adoption is too low for this." | Slide 11 | True for a DNSSEC-only design: about 4 to 5 percent of .com is signed (Verisign 2023). RFC 9704 section 6.1 also allows verification through an external resolver the device already trusts; SplitTrust implements both paths and shows the second one as yellow, because the trust then rests on that resolver. |
| "Nobody emits DNR or PvD, so how does the device learn the claim?" | Slides 3 and 16 | Correct today: systemd 257 parses DNR, Windows has it behind a flag, Apple fetches PvD partially, and no network side emits either. A pilot delivers the claim through MDM or VPN configuration; the verification is the same. |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; DNSSEC validation is unbound itself via libunbound. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`; all services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- Alfa's verdict says "no answer": the venue's Internet or DoT to 9.9.9.9 is blocked. Show the lab scenarios from the CLI (`docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged`, no Internet needed) or play the backup video.
- A browser frame says "Loading..." for more than a few seconds: `docker compose -f lab/compose.yaml restart proxy`; the deck re-joins the client on the next slide change.
- Everything else: play the backup video.
