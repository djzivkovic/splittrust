# SplitTrust: the 5-minute demo

Two companies, the same week, the same employee habits. **SecureCompany** adopted RFC 9704 with SplitTrust: its
zone is the real, DNSSEC-signed `zivkovic.me` and it published one Verification Record. **UnsecureCompany** did not:
its devices use whatever resolver the network hands them. Every SecureCompany verdict that depends on DNS is computed live
against the public DNS (root, `.me`, Cloudflare, dns.quad9.net); the replayed claim is rejected on the
certificate before any DNS query. Every record can be checked from a laptop in the room.

Everything happens in the deck at `http://127.0.0.1:8000`. The main run is twelve slides and fits five
minutes: 1 title, 2 the problem, 3 why now, 4 how RFC 9704 works, 5 our solution, 6 the two companies,
7 Monday, 8 Tuesday, 9 what SecureCompany did, 10 what we built, 11 evidence (the lab probed live),
12 closing. After the closing slide comes an appendix for questions: 13 who it is for, 14 today's options
(click the four), 15 what changes for a company, 16 try the owner tool, 17 roadmap and limits. `→`
advances, `space` replays an animation, `1 2` switch SecureCompany's device (laptop, phone), `t` swaps the
browser frames for the dig output of the two real lookups. The proxy's decisions appear live next to the
browser frames on every scene.

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
| 0:00-0:25 | A hotel Wi-Fi tells your laptop: my resolver answers for your bank. Nothing today lets the laptop check whether the bank agreed; encrypting DNS to that resolver is a private conversation with the attacker. This is measured, not hypothetical. RFC 9704, January 2025, gives the owner a way to say who may answer and the device a way to check. | Slides 1, 2. |
| 0:25-0:45 | Why now: encrypted DNS has been in every OS for years, resolver discovery since 2022, and RFC 9704 was published in January 2025 with zero known implementations a month later. | Slide 3: five milestones, click "Feb 2025". |
| 0:45-1:05 | Three steps: the owner publishes one TXT record, a salted hash of the claim; the network announces the claim; the device makes the resolver prove its name over TLS, validates the record (DNSSEC, or a resolver it already trusts) and compares tokens. Only then does it route those names there. | Slide 4. |
| 1:05-1:30 | We built SplitTrust: the device side, verification and enforcement, in one Go binary; a DNS proxy any client can use; the owner's tool; a lab that attacks it; tested live against the public DNS with our own signed zone. Two companies, one week: SecureCompany adopted it, UnsecureCompany did not. | Slides 5, 6. |
| 1:30-2:05 | Monday at the office. SecureCompany's laptop verifies the network's claim before trusting the office resolver: token, TLS identity, the record from the real zone validated from the root down. Accepted. UnsecureCompany's laptop just uses the resolver. Both intranets load. The difference is invisible on Monday. | Slide 7: the drawing runs, both browser frames show the intranets, the proxy's decisions appear on the right. Mention that `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` works from any laptop in the room. |
| 2:05-3:05 | Tuesday at the hotel. The hotel claims both domains and its resolver serves a copy of each zone; for SecureCompany it even publishes a record with the correct token. UnsecureCompany's laptop does what it did on Monday and gets the hotel's page: the credentials are gone. SecureCompany's laptop validates against the real DNSSEC chain; the hotel has the token but not Cloudflare's signatures. Bogus, rejected, resolver never used. The name fails to resolve instead of resolving to the wrong place. Press 2: the phone with Private DNS asks Quad9 and reaches the real site. | Slide 8: the masked resolver, the red mark at "the real DNS", "Intranet login" on the left, "This site can't be reached" on the right. Press `2` for the phone. Press `t` for the dig output: SERVFAIL with EDE 6 on the right, the hotel's A record on the left. |
| 3:05-3:30 | What SecureCompany's IT did: DNSSEC on the zone (Cloudflare signs; the DS goes to the registry), one TXT record built with the owner tool, devices pointed at a resolver that checks. No application changes. The record is public and that is fine: a copied claim is rejected on the resolver's certificate before the first query. | Slide 9: the three tiles with the real zone's DS and TXT right now; the copied claim rejected. |
| 3:30-3:55 | What we built: one Go binary, about 5,400 lines, libunbound in-process; CLI, HTTP API and a Do53 proxy with EDE. A Docker lab with a private signed root, office and hotel resolvers (honest, forging, plain), PvD server, quad9.lab; 13 scenarios across 3 device profiles, 46 generated checks plus 5 end-to-end tests. And our own signed zone. | Slide 10, the architecture. Point at the proxy tile: that is what the laptops in the scenes used. |
| 3:55-4:25 | Evidence: the lab is probed from this page every four seconds, DNS, TLS, HTTP; the proxy's decisions on the right are what the laptops' queries did during the scenes. Nothing was recorded. | Slide 11. |
| 4:25-5:00 | What is real: the implementation, the proxy, our signed zone on the public DNS. What is not yet: OS integration, DHCP on the wire; unsigned zones only through the external-resolver path. Ask: one OS or resolver vendor to try it, one company with split-horizon DNS for a pilot, and sign your zone. (The erratum and the test vectors stay in the repo for anyone who asks.) | Slide 12. Appendix slides 13 to 17 are for questions. |

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Is this real or a lab trick?" | Slides 9, 11 and 16, and `t` on any scene | SecureCompany's zone is `zivkovic.me` at Cloudflare, DNSSEC-signed, DS at the `.me` registry. `dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me` and `dig +short zivkovic.me DS` from any laptop. The hotel and the office networks are containers; the verdicts are computed against the real DNS. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Slides 5 and 7 | No. `splittrust proxy` is a DNS server; the demo's protected device is a plain container whose DNS server is the proxy. On a laptop this is the dnscrypt-proxy pattern (127.0.0.1); a product would drive the OS split-DNS machinery (systemd-resolved, Windows NRPT). |
| "Why not just a VPN / DoH / DNSSEC?" | Slide 14 | Click through: encrypted DNS is a private conversation with the attacker; an always-on VPN does protect the company's own names (DNS goes through the tunnel to the office resolver) but gives up the local resolver entirely: hairpin, tunnel-first, no local names at partners, branches or home; DNSSEC alone rejects the forgery but also rejects the legitimate intranet, because internal names do not exist in the public zone. RFC 9704 adds the missing sentence: the owner allows this resolver for these names, so you can use the network you are on. |
| "What does a company actually have to do?" | Slides 15 and 16 | Sign the zone, publish one TXT record (type it on slide 6: the token equals the one live in the zone), run DoT with a certificate on the office resolver, and give devices a resolver that checks. No application changes. |
| "Do we need fifteen containers?" | Slide 11 | Fifteen compose services: eight long-running containers run the demo (the two networks' resolvers, PvD, proxy, app, three pages), five are the test bed (private root, quad9.lab, banka.lab, two plain clients), plus the one-shot bootstrap and the test runner profile. |
| "Who would buy this?" | Slide 13 | Organisations with split-horizon DNS and roaming devices (banks, hospitals, agencies, universities, branch-heavy firms); OS and MDM vendors ship the check; resolver and DDI vendors (BIND, Unbound, Knot, CoreDNS, Infoblox, BlueCat) already serve inbound DoT with views and would add claim automation. Not consumers, not hotels, not filtering. |
| "DNSSEC adoption is too low for this." | Slide 13 | True for a DNSSEC-only design: about 4 to 5 percent of .com is signed (Verisign 2023). RFC 9704 section 6.1 also allows verification through an external resolver the device already trusts; SplitTrust implements both paths and shows the second one as yellow, because the trust then rests on that resolver. |
| "Nobody emits DNR or PvD, so how does the device learn the claim?" | Slides 3 and 17 | Correct today: systemd 257 parses DNR, Windows has it behind a flag, Apple fetches PvD partially, and no network side emits either. A pilot delivers the claim through MDM or VPN configuration; the verification is the same. |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; DNSSEC validation is unbound itself via libunbound. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`; all services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- SecureCompany's verdict says "no answer": the venue's Internet or DoT to 9.9.9.9 is blocked. Show the lab scenarios from the CLI (`docker compose -f lab/compose.yaml exec app splittrust verify --scenario hotel-forged`, no Internet needed) or play the backup video.
- A browser frame says "Loading..." for more than a few seconds: `docker compose -f lab/compose.yaml restart proxy`; the deck re-joins the client on the next slide change.
- Everything else: play the backup video.
