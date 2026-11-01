# SplitTrust: what to say

Spoken text for the ten-slide main pitch, about 650 words, five minutes at a calm pace. Slide numbers
match the deck at `http://127.0.0.1:8000`. The sentences are the shape, not a script to read; keep to
each slide's one point. The slides are illustrations; the live checks run in the playground at `/demo`.
The appendix (A1 to A9) is for questions; `docs/demo.md` has the Q&A table.

Every factual statement below is marked with its source in the "Facts" section at the end. Do not add
numbers on stage that are not in that list.

---

## 1. Title (0:00)

Hello everyone. We are Team NXDOMAIN and our project is SplitTrust. It answers a question a laptop
cannot answer today: when a network says "my resolver answers for your company's names", did the
company actually agree?

## 2. Split-horizon DNS (0:15)

Quick background, because the whole problem lives here. When a company has internal services, say a
GitLab, it runs an internal DNS view for those names. `git.dev.corp.lab` resolves to a private address,
10.20.0.10, and only on the company network or over its VPN. Public DNS has never heard of that name:
the public zone is signed, so a validating resolver gets a signed proof that the name does not exist.

For years this worked because laptops simply used whatever resolver the network handed them. That is
changing. Phones have Private DNS, Apple and Windows ship encrypted DNS to a resolver of the user's
choice, browsers do DNS over HTTPS to a public resolver. A device like that never asks the office
resolver, so the private GitLab name does not resolve for it at all. The company now has to ask the
device for an exception: "for these names, use this resolver".

## 3. The problem (0:45)

And that exception is the problem. Any network can ask for it. At the hotel the router hands out a
resolver that claims the same names. There are several ways for a network to send such a hint, DHCP
options, PvD documents, the VPN's own configuration, and, in the RFC's words, none of them lets the
client determine whether the domain owner authorized it. So today the device has two bad choices: trust
every hint, and a hotel can redirect `git.dev.corp.lab`; or trust none, and the private view breaks the
moment the device is not using the network's resolver.

"Just use the VPN" is the usual answer, and a VPN is a fine hint source: the device trusts it because it
trusts the tunnel. But it only covers a device whose tunnel is up and whose DNS goes through it. It does
not cover the minutes before the tunnel comes up, split tunnels where DNS stays local, the phone or the
contractor's laptop without a client, partner and branch networks, or the office Wi-Fi itself, where
nobody runs a VPN and a rogue access point can hand out its own resolver claiming the company's names.
And requiring DNSSEC on the laptop does not help: the real intranet fails exactly like the forged one.
What the device needs is a way to ask the company: did you authorize this resolver for these names?

## 4. How RFC 9704 works (1:20)

RFC 9704, published in January 2025, answers that in three steps. One: the domain owner publishes a
Verification Record, a single TXT record in its signed public zone under the resolver's name, carrying a
salted hash of the names that resolver may answer for. Two: the network supplies its claim: this
resolver, these names, this salt. Three: the client checks before it trusts. It opens TLS to the
resolver and checks that the certificate matches the announced name. It fetches the owner's record and
validates it with DNSSEC. It recomputes the hash and compares. Only then does it route those names,
and only those names, to that resolver.

## 5. At the office (1:50)

Our employee at the office, bookmark open. [the animation runs] The laptop asks the company resolver to
prove its name over TLS, fetches the company's record, validates it, compares the token. Accepted. The
private answer, 10.20.0.10, is used, and every other name keeps its normal DNS policy. The private view
is legitimate and now it is also checked.

## 6. At the hotel (2:20)

Same laptop, same bookmark, hotel Wi-Fi, VPN off. [the animation runs] Ordinary network DNS hands out
an address the attacker controls. SplitTrust asks the public zone for a record authorizing the hotel's
resolver and gets the company's signed denial: there is none. No exception is granted, and the invented
GitLab answer is rejected on the laptop's normal validating path. The name fails to resolve instead of
resolving to the wrong place. HTTPS remains a separate safeguard; this is about not sending the request
there in the first place.

## 7. What the company configures (2:55)

Three things. DNSSEC on the zone. One Verification Record, built with our tool. Laptops that check,
here through the SplitTrust proxy as their resolver. No application changed.

And the record is public, so what if the hotel copies the whole claim? The laptop opens TLS to the
announced resolver first and checks the certificate. It is for `dns.hotel.lab`, not for `dns.corp.lab`.
Rejected before a single DNS query. This is the resolver's DoT identity, not GitLab's web certificate.

## 8. What we built (3:15)

A working DNS path, not a protocol illustration. The verifier: the owner's permission, the resolver's
identity, and the delegated key when the record carries one. An enforcing DNS proxy on the path ordinary
applications use: scoped answers, DNSSEC-bogus data refused with SERVFAIL and an Extended DNS Error. And
the owner's record builder: claim in, TXT record out. One Go binary, CLI and HTTP, with an isolated
Docker lab. Network profiles are configured in this prototype.

## 9. Evidence (3:45)

What we demonstrated: private GitLab access authorized under the delegated key; the hotel's claim
rejected on the company's signed denial; a wrong delegated key refused rather than downgraded to a
token-only trust. Behind it: fifteen scenario profiles, three device profiles, reproducible token, TXT,
DHCP and PvD vectors, two trust contexts (a private DNSSEC lab and our own signed zone on the public
DNS), and a documented discrepancy in the RFC's worked example with a reproducer.

## 10. Closing (4:15)

The result: legitimate private DNS without granting every network authority over the company's names.
The implementation is ready to inspect in the playground. The next step is one managed-device pilot
with a company that runs split-horizon DNS. Thank you.

---

## If something fails on stage

- The slides make no backend requests; they cannot fail on the venue's network. Space or "Replay illustration" restarts an animation.
- The playground (`/demo`) needs the Docker lab. If a command stalls, say so and return to the slides; the Q&A can point at the command output in the README.

## Answers you will need (short forms)

- *Are the slides showing live results?* No: the slides are illustrations. The playground runs the actual `dig` and `curl` commands inside the lab and shows their output. The CLI also runs the real-zone scenarios under the public DNSSEC chain.
- *Why not a VPN?* A VPN sends DNS through the tunnel to the company's own resolver, and the device trusts that hint because it trusts the tunnel. That covers devices whose tunnel is up and whose DNS goes through it. It does not cover the time before the tunnel is up, split tunnels where DNS stays local, phones and contractor laptops without a client, partner and branch networks, or the office LAN itself (a rogue access point can hand out a resolver claiming the company's names). RFC 9704 lets a device accept such a hint from any network, including a VPN (section 10 covers IKEv2), only after checking with the domain owner. Complementary, not competing.
- *Isn't DNSSEC enough?* It rejects the forged answer, but it rejects the legitimate intranet the same way, because the internal names do not exist in the public zone. RFC 9704 adds the owner's authorization for a resolver to answer those names.
- *Isn't this only a hotel problem?* No. Any network the device joins can send a local domain hint: hotel, conference, partner site, home router, or a rogue access point at the office. The hotel is the illustration; the check is the same everywhere.
- *What if the zone is unsigned?* The laptop cannot verify. A device with a preconfigured external encrypted resolver can verify through it (RFC 9704 section 6.1), and its security then rests on that resolver. Sign the zone.
- *What if the attacker blocks the path to the public DNS?* Verification fails and nothing is routed to the hotel's resolver: denial of service, not redirection.
- *How does the device learn the claim?* Over a DHCP Authentication option or a PvD document (RFC 9704 section 5.2). In this prototype the network profiles are configured. A pilot would deliver them through device management.
- *How do you revoke?* Replace the record and the salt; the change takes effect as cached records expire (TTL and signature validity bound the grant).
- *Is anyone shipping this?* At DNS-OARC 44 in February 2025 a co-author reported no known implementations. That is a dated report; we do not claim to be the only one today.

## Facts used above, with sources

- RFC 9704 published January 2025, Proposed Standard, ADD working group: https://www.rfc-editor.org/rfc/rfc9704 (datatracker: https://datatracker.ietf.org/doc/rfc9704/). Its abstract: "DNS clients that are not configured to use this resolver by default can use it for these specific domains only." Its introduction lists the existing local-domain-hint mechanisms (RDNSS selection RFC 6731, PvD dnsZones RFC 8801, IKEv2 INTERNAL_DNS_DOMAIN RFC 8598) and states that "none of the local domain hint mechanisms enable clients to determine whether this special treatment is authorized by the domain owner." Section 10 covers validation with IKEv2 (VPNs).
- Devices that do not use the network's resolver by default: Android Private DNS since Android 9 (2018), https://support.google.com/android/answer/9654714; iOS 14 and macOS 11 encrypted DNS (2020), WWDC 2020 session 10047; Windows 11 DoH; Firefox DoH by default in the US since 2020 and Chrome's Secure DNS auto-upgrade, https://www.chromium.org/developers/dns-over-https/.
- Verification Record: TXT at `<resolver>._splitdns-challenge.<parent>`, token = hash(len(salt) || salt || claimed names), RFC 9704 section 5; claims carried in DHCP Authentication option or PvD `splitDnsClaims`, section 5.2; external-resolver path, section 6.1; local validation, section 6.2; `ds` key delegation, section 7.
- "No known implementations", February 2025: Benjamin Schwartz, DNS-OARC 44, https://indico.dns-oarc.net/event/52/contributions/1168/.
- A signed zone yields authenticated denial of existence (NSEC/NSEC3): RFC 4035 section 3.1.3 and RFC 5155.
- The lab's private addresses (10.20.0.0/24) and names are ours; `zivkovic.me` is our own zone, DNSSEC-signed, with the Verification Record published.
- Counts on slide 9 (fifteen scenario profiles, three device profiles) come from `internal/lab/scenarios.json` and `internal/verify` in this repository.
