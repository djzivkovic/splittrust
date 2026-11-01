# SplitTrust: what to say

Spoken text for the ten-slide main pitch, about 700 words, five minutes at a calm pace. Slide numbers
match the deck at `http://127.0.0.1:8000`. This is the shape of what to say, not a script to read out;
say it your way, keep each slide to its one point. The slides are illustrations; the live checks run in
the playground at `/demo`. The appendix (A1 to A9) is for questions; `docs/demo.md` has the Q&A table.

Every number and claim below has a source in the "Facts" section at the end. Don't add any on stage
that aren't there.

---

## 1. Title (0:00)

Hi everyone. We're Team NXDOMAIN and this is SplitTrust. It answers a question your laptop can't answer
today. A network tells it: "my resolver answers for your company's names". Did the company actually
agree to that?

## 2. Split-horizon DNS (0:15)

Quick bit of background, because this is where the whole problem lives. Most companies run internal
services, let's say a GitLab. For those they keep an internal DNS view. `git.dev.corp.lab` resolves to a
private address, 10.20.0.10, and only on the company network or through its VPN. Public DNS has never
heard of that name. In fact the public zone is signed, so a validating resolver gets a signed proof that
the name does not exist.

For years that just worked, because laptops used whatever resolver the network gave them. That's
changing. Phones have Private DNS. Apple and Windows ship encrypted DNS to a resolver you pick. Browsers
do DNS over HTTPS to a public resolver. A device like that never talks to the office resolver, so the
private GitLab name simply doesn't resolve for it. The company now has to ask the device for an
exception: "for these names, please use this resolver".

## 3. The problem (0:45)

And that exception is the problem, because any network can ask for it. The hotel's router hands out a
resolver that claims the very same names. There are several ways to send that kind of hint: DHCP options,
PvD documents, a VPN's configuration. The RFC says it plainly: none of them lets the client find out
whether the domain owner authorized it. So the device has two bad options. Trust every hint, and a hotel
can point `git.dev.corp.lab` wherever it likes. Trust none, and the private view breaks the moment the
device isn't using the network's resolver.

Now, the obvious answer is "just use the VPN". And a VPN is a perfectly good hint, the device trusts it
because it trusts the tunnel. But think about when that tunnel is actually up. Not in the minutes after
you join the Wi-Fi, while the captive portal is still open and your mail and chat clients are already
resolving internal names. Not with a split tunnel where DNS stays local. Not on your phone, not on a
contractor's laptop, not at a partner site. And not at the office itself, where nobody runs a VPN and a
rogue access point can hand out its own resolver. "Just require DNSSEC" doesn't help either: the real
intranet fails exactly like the forged one. What the device needs is a way to ask the company: did you
authorize this resolver for these names?

## 4. How RFC 9704 works (1:20)

RFC 9704, published in January, answers that in three steps. One, the domain owner publishes a
Verification Record: a single TXT record in its signed public zone, under the resolver's name, carrying a
salted hash of the names that resolver may answer for. Two, the network makes its claim: this resolver,
these names, this salt. Three, the client checks before it trusts. It opens TLS to the resolver and
checks the certificate matches the announced name. It fetches the owner's record and validates it with
DNSSEC. It recomputes the hash and compares. Only then does it send those names, and only those names,
to that resolver.

## 5. At the office (1:50)

So here's our employee at the office, GitLab bookmark open. [the animation runs] The laptop asks the
company resolver to prove its name over TLS, fetches the company's record, validates it, compares the
token. Accepted. The private answer, 10.20.0.10, is used, and every other name keeps its normal DNS
policy. The private view was always legitimate. Now it's also checked.

## 6. At the hotel (2:20)

Same laptop, same bookmark, hotel Wi-Fi, no tunnel. [the animation runs] Plain network DNS hands out an
address the attacker controls, and a laptop that just trusts the network connects to it. What leaks then
depends on the application, and intranets are full of applications that leak: tools on plain HTTP,
Windows clients that authenticate automatically to anything that looks internal, scripts that skip
certificate checks. HTTPS with a proper certificate stops the impersonation, but the request has already
left the laptop.

With SplitTrust the laptop asks the public zone: is there a record authorizing the hotel's resolver? It
gets the company's signed answer: there isn't. No exception, and the invented GitLab address is thrown
away on the laptop's normal validating path. The name fails to resolve instead of resolving to the wrong
place. To be clear, this doesn't get you into GitLab from the hotel. For that you still need the office
or the VPN. It makes sure the request never goes to the attacker.

## 7. What the company configures (2:55)

Three things. DNSSEC on the zone. One Verification Record, built with our tool. And laptops that check,
here through the SplitTrust proxy as their resolver. No application changed.

The record is public, so what if the hotel just copies the whole claim? The laptop opens TLS to the
announced resolver first and looks at the certificate. It's for `dns.hotel.lab`, not for `dns.corp.lab`.
Rejected before a single DNS query. That's the resolver's own identity, nothing to do with GitLab's web
certificate.

## 8. What we built (3:15)

This is a working DNS path, not a drawing of a protocol. The verifier: the owner's permission, the
resolver's identity, and the delegated key when the record carries one. An enforcing DNS proxy that sits
on the path ordinary applications use: scoped answers, and anything DNSSEC-bogus refused with SERVFAIL and
an Extended DNS Error that says why. And the owner's record builder: claim in, TXT record out. One Go
binary, CLI and HTTP, and an isolated Docker lab around it. One honest limit: in this prototype the
network profiles are configured, not discovered on the wire.

## 9. Evidence (3:45)

What we showed: private GitLab access authorized under the delegated key; the hotel's claim rejected on
the company's signed denial; and a wrong delegated key refused instead of quietly downgrading to a
token-only trust. Behind it: fifteen scenario profiles, three device profiles, reproducible token, TXT,
DHCP and PvD vectors, two trust contexts, a private DNSSEC lab and our own signed zone on the public
DNS, and a documented discrepancy in the RFC's worked example, with a reproducer.

## 10. Closing (4:15)

So: private DNS that works, without handing every network you join authority over your company's names.
The implementation is there to inspect in the playground. The next step we want is one managed-device
pilot with a company that runs split-horizon DNS. Thank you.

---

## If something fails on stage

- The slides make no backend requests; they cannot fail on the venue's network. Space or "Replay illustration" restarts an animation.
- The playground (`/demo`) needs the Docker lab. If a command stalls, say so and return to the slides; the Q&A can point at the command output in the README.

## Answers you will need (short forms)

- *Are the slides showing live results?* No, the slides are illustrations. The playground runs the actual `dig` and `curl` commands inside the lab and shows their output. The CLI also runs the real-zone scenarios under the public DNSSEC chain.
- *What does the attacker actually get? The bookmark is HTTPS.* The connection, not the login. A proper certificate stops the impersonation of an HTTPS site, but the request still leaves the laptop, and the intranet is not only HTTPS sites with proper certificates: plain-HTTP tools, Windows clients that do Integrated Authentication to anything in the intranet zone (that is how Responder-style hash capture works), agents and scripts that skip certificate checks, first visits without HSTS. The point is not to send the request at all.
- *Why not a VPN?* A VPN sends DNS through the tunnel to the company's own resolver, and the device trusts that hint because it trusts the tunnel. That covers a device whose tunnel is up and whose DNS goes through it. It does not cover the time before the tunnel is up, split tunnels where DNS stays local, phones and contractor laptops without a client, partner and branch networks, or the office LAN itself, where a rogue access point can hand out a resolver claiming the company's names. RFC 9704 lets a device accept a hint from any source, including a VPN (section 10 covers IKEv2), only after checking with the domain owner. Complementary, not competing.
- *Could the attacker interfere with a laptop that is on the VPN?* With an always-on, full-tunnel VPN and DNS inside the tunnel: only by denying service (blocking the tunnel; poisoning the VPN server's name fails on the VPN's own certificate check). That laptop is a plain stub to one resolver and RFC 9704 explicitly leaves it out of scope. The scenario is about every device and every moment the tunnel does not cover.
- *Does this get the employee into GitLab from the hotel?* No. It stops the request from going to the attacker. Reaching the private GitLab still needs the office network or the VPN.
- *Isn't DNSSEC enough?* It rejects the forged answer, but it rejects the legitimate intranet the same way, because the internal names do not exist in the public zone. RFC 9704 adds the owner's authorization for a resolver to answer those names.
- *Isn't this only a hotel problem?* No. Any network the device joins can send a local domain hint: hotel, conference, partner site, home router, or a rogue access point at the office. The hotel is the illustration; the check is the same everywhere.
- *What if the device's own encrypted resolver is blocked?* That is the one gap outside the RFC. If the device's default resolver is opportunistic (Android's "Automatic" mode, for example) and the hotel blocks it, the device falls back to plain DNS to the hotel and is a plain stub again. RFC 9704 protects the exception path; the default-resolver policy (strict, not opportunistic) is a separate decision the device has to make.
- *What if the zone is unsigned?* The laptop cannot verify. A device with a preconfigured external encrypted resolver can verify through it (RFC 9704 section 6.1), and its security then rests on that resolver. Sign the zone.
- *What if the attacker blocks the path to the public DNS?* Verification fails and nothing is routed to the hotel's resolver: denial of service, not redirection.
- *How does the device learn the claim?* Over a DHCP Authentication option or a PvD document (RFC 9704 section 5.2). In this prototype the network profiles are configured. A pilot would deliver them through device management.
- *How do you revoke?* Replace the record and the salt; the change takes effect as cached records expire (TTL and signature validity bound the grant).
- *Is anyone shipping this?* At DNS-OARC 44 in February 2025 a co-author reported no known implementations. That is a dated report; we do not claim to be the only one today.

## Facts used above, with sources

- RFC 9704 published January 2025, Proposed Standard, ADD working group: https://www.rfc-editor.org/rfc/rfc9704 (datatracker: https://datatracker.ietf.org/doc/rfc9704/). Its abstract: "DNS clients that are not configured to use this resolver by default can use it for these specific domains only." Its introduction lists the existing local-domain-hint mechanisms (RDNSS selection RFC 6731, PvD dnsZones RFC 8801, IKEv2 INTERNAL_DNS_DOMAIN RFC 8598) and states that "none of the local domain hint mechanisms enable clients to determine whether this special treatment is authorized by the domain owner." It also puts pure stub clients (all queries to one resolver) out of scope. Section 10 covers validation with IKEv2 (VPNs).
- Devices that do not use the network's resolver by default: Android Private DNS since Android 9 (2018), https://support.google.com/android/answer/9654714 (its "Automatic" mode is opportunistic and falls back to plain DNS); iOS 14 and macOS 11 encrypted DNS (2020), WWDC 2020 session 10047; Windows 11 DoH; Firefox DoH by default in the US since 2020 and Chrome's Secure DNS auto-upgrade, https://www.chromium.org/developers/dns-over-https/.
- Windows Integrated Authentication is sent automatically to sites in the Local Intranet zone ("Automatic logon only in Intranet zone" is the default): https://learn.microsoft.com/en-us/windows-server/security/windows-authentication/windows-authentication-overview and the Internet Explorer / Edge security-zone documentation. Name-resolution poisoning to capture NetNTLM challenge-responses is the technique implemented by Responder (https://github.com/lgandx/Responder), normally via LLMNR/NBNS/mDNS; a resolver answering for internal names reaches the same clients.
- A public CA cannot issue a certificate for a name that only resolves privately (no DNS-01 or HTTP-01 validation possible); the CA/Browser Forum Baseline Requirements forbid certificates for internal names since 2015. So an attacker cannot present a valid certificate for the private GitLab name unless the company's internal CA is compromised.
- Verification Record: TXT at `<resolver>._splitdns-challenge.<parent>`, token = hash(len(salt) || salt || claimed names), RFC 9704 section 5; claims carried in DHCP Authentication option or PvD `splitDnsClaims`, section 5.2; external-resolver path, section 6.1; local validation, section 6.2; `ds` key delegation, section 7.
- "No known implementations", February 2025: Benjamin Schwartz, DNS-OARC 44, https://indico.dns-oarc.net/event/52/contributions/1168/.
- A signed zone yields authenticated denial of existence (NSEC/NSEC3): RFC 4035 section 3.1.3 and RFC 5155.
- The lab's private addresses (10.20.0.0/24) and names are ours; `zivkovic.me` is our own zone, DNSSEC-signed, with the Verification Record published.
- Counts on slide 9 (fifteen scenario profiles, three device profiles) come from `internal/lab/scenarios.json` and `internal/verify` in this repository.
