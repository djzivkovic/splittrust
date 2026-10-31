# SplitTrust: the 5-minute demo

Two companies, the same week, the same employee habits. **SecureCompany** adopted RFC 9704 with SplitTrust: its
zone is the real, DNSSEC-signed `zivkovic.me` and it published one Verification Record. **UnsecureCompany** did not:
its devices use whatever resolver the network hands them. Every SecureCompany verdict that depends on DNS is computed live
against the public DNS (root, `.me`, Cloudflare, dns.quad9.net); the replayed claim is rejected on the
certificate before any DNS query. Every record can be checked from a laptop in the room.

Everything happens in the deck at `http://127.0.0.1:8000`. The main run is ten slides: 1 title, 2 the
problem, 3 why now, 4 how RFC 9704 works, 5 at the office, 6 at the hotel, 7 what SecureCompany did,
8 what we built, 9 live checks, 10 closing. After the closing slide comes an appendix for questions:
11 what SplitTrust implements (inventory and limits), 12 who buys and who ships, 13 today's options (click
the four), 14 what changes for a company, 15 try the owner tool, 16 roadmap. `→` advances, `space`
replays an animation, `1 2` switch SecureCompany's device (laptop, phone), `t` shows the details on a
demo slide: the claim, the stage codes, the raw records, and the dig output of the two real lookups.
The proxy's decisions appear live next to the browser frames on every scene.

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
| 0:00-0:30 | A hotel Wi-Fi tells your laptop: my resolver answers for your bank. The laptop has no way to check that the bank agreed, and encrypting DNS to that resolver is a private conversation with the attacker. This is measured: interception in 259 of 3,047 networks in one study. RFC 9704, January 2025, gives the owner a way to say who may answer and the device a way to check. | Slides 1, 2. |
| 0:30-0:50 | Why now: encrypted DNS has been in every OS for years, resolver discovery since 2022, and RFC 9704 came out in January 2025 with zero known implementations a month later. | Slide 3; click "Feb 2025". |
| 0:50-1:15 | Three steps: the owner publishes one TXT record, a salted hash of the claim; the network announces the claim; the device checks the resolver's certificate over TLS, validates the record with DNSSEC and compares tokens. Only then does it route those names there. We built that check, a DNS proxy that enforces it, and the owner's tool. | Slide 4. |
| 1:15-1:50 | Two companies. SecureCompany signed its zone (our real zivkovic.me), published the record, and its laptops check. UnsecureCompany trusts whatever resolver the network hands out. At the office both intranets load; only SecureCompany's laptop verified the resolver first. On a trusted network the difference is invisible. | Slide 5: the drawing runs, both browser frames show the intranets, the proxy's decisions appear on the right. |
| 1:50-2:50 | At the hotel. The hotel's resolver claims both domains and serves a copy of each zone, including a record with the correct token. UnsecureCompany's laptop gets the hotel's login page. SecureCompany's laptop validates against the real DNSSEC chain: the hotel has the token but not the owner's signatures. Bogus, rejected, resolver never used. The name fails to resolve instead of resolving to the wrong place. Press 2: the phone with Private DNS asks Quad9 and reaches the real site. | Slide 6: the masked resolver, the red mark at "public DNS", "Intranet login" on the left, "This site can't be reached" on the right. Press `2` for the phone. Press `t` for the dig output: SERVFAIL with EDE 6 on the right, the hotel's A record on the left. |
| 2:50-3:15 | What SecureCompany did: DNSSEC on the zone, one TXT record, devices pointed at a resolver that checks. No application changes. The record is public; a hotel that copies the claim is rejected on the certificate before the first query. | Slide 7: the three tiles, green; the copied claim rejected. Press `t` for the raw DS and TXT. |
| 3:15-3:40 | What we built: one Go binary with libunbound in-process; CLI, HTTP API and a plain-DNS proxy that returns SERVFAIL with an Extended DNS Error when a claim is rejected. A Docker lab with a private signed root, the office and hotel resolvers, 13 attack and corner-case scenarios. And our own signed zone. | Slide 8. Point at the proxy tile: that is what the laptops in the scenes used. |
| 3:40-4:10 | Live checks: the lab is probed from this page every four seconds, DNS, TLS, HTTP; on the right, what the proxy decided for the laptops' queries. | Slide 9. |
| 4:10-5:00 | Built: the check, the proxy, the record tool, tested against our signed zone. Not yet: OS integration, claims over DHCP or PvD on the wire; unsigned zones only through a resolver the device already trusts. Ask: one OS or resolver vendor to try it, one company with split-horizon DNS for a managed-device pilot. | Slide 10. Appendix slides 11 to 16 are for questions. |

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Is this real or a lab trick?" | Slides 7 and 9, slide 15, and `t` on any scene | SecureCompany's zone is `zivkovic.me` at Cloudflare, DNSSEC-signed, DS at the `.me` registry. `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` and `dig +short zivkovic.me DS` from any laptop. The hotel and the office networks are containers; the verdicts are computed against the real DNS. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Slides 5 and 11 | No. `splittrust proxy` is a DNS server; the demo's protected device is a plain container whose DNS server is the proxy. On a laptop this is the dnscrypt-proxy pattern (127.0.0.1); a product would drive the OS split-DNS machinery (systemd-resolved, Windows NRPT). |
| "Why not just a VPN / DoH / DNSSEC?" | Slide 13 | Click through: encrypted DNS is a private conversation with the attacker; an always-on VPN does protect the company's own names (DNS goes through the tunnel to the office resolver) but gives up the local resolver entirely: hairpin, tunnel-first, no local names at partners, branches or home; DNSSEC alone rejects the forgery but also rejects the legitimate intranet, because internal names do not exist in the public zone. RFC 9704 adds the missing sentence: the owner allows this resolver for these names, so you can use the network you are on. |
| "What does a company actually have to do?" | Slides 14 and 15 | Sign the zone, publish one TXT record (type it on slide 15: the token equals the one live in the zone), run DoT with a certificate on the office resolver, and give devices a resolver that checks. No application changes. |
| "Do we need fifteen containers?" | Slide 9 | Fifteen compose services: eight long-running containers run the demo (the two networks' resolvers, PvD, proxy, app, three pages), five are the test bed (private root, quad9.lab, banka.lab, two plain clients), plus the one-shot bootstrap and the test runner profile. |
| "Who would buy this?" | Slide 12 | Organisations with split-horizon DNS and roaming devices (banks, hospitals, agencies, universities, branch-heavy firms); OS and MDM vendors ship the check; resolver and DDI vendors (BIND, Unbound, Knot, CoreDNS, Infoblox, BlueCat) already serve inbound DoT with views and would add claim automation. Not consumers, not hotels, not filtering. |
| "DNSSEC adoption is too low for this." | Slide 12 | True for a DNSSEC-only design: about 4 to 5 percent of .com is signed (Verisign 2023). RFC 9704 section 6.1 also allows verification through an external resolver the device already trusts; SplitTrust implements both paths and shows the second one as yellow, because the trust then rests on that resolver. |
| "Nobody emits DNR or PvD, so how does the device learn the claim?" | Slides 3 and 16 | Correct today: systemd 257 parses DNR, Windows has it behind a flag, Apple fetches PvD partially, and no network side emits either. A pilot delivers the claim through MDM or VPN configuration; the verification is the same. |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; DNSSEC validation is unbound itself via libunbound. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`; all services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- SecureCompany's verdict says "no answer": the venue's Internet or DoT to 9.9.9.9 is blocked. Show the lab scenarios from the CLI (`docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged`, no Internet needed) or play the backup video.
- A browser frame says "Loading..." for more than a few seconds: `docker compose -f lab/compose.yaml restart proxy`; the deck re-joins the client on the next slide change.
- Everything else: play the backup video.
