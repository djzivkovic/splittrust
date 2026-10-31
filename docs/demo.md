# SplitTrust: the 5-minute demo

Hard limit: 5 minutes. Three networks go live; the rest stay in the lab for questions.
Everything happens on the console's **Demo** page (`http://127.0.0.1:8000`), which is a sequence of scenes
with five screens each: Situation, What the network sent, What the device checks, Verdict and evidence,
Proof. Right arrow advances (and moves to the next scene after the proof), `1 2 3` switch the device,
`space` replays the animation, `n` shows the presenter notes under the screen. The four talk scenes are
first in the strip; the rest are for questions. No terminal needed.
Rehearse twice with a timer; record a backup video.

## Before you go on stage

```bash
docker compose -f lab/compose.yaml up --build -d        # from a clean clone: ~3 min, includes the lab generation
docker compose -f lab/compose.yaml exec app splittrust scenarios
open http://127.0.0.1:8000
```

If anything looks stale (signatures are generated for 48 h, the lab regenerates itself after 20 h):

```bash
docker compose -f lab/compose.yaml down -v && docker compose -f lab/compose.yaml up --build -d
```

## Script

| Time | Say | Show |
|---|---|---|
| 0:00–0:40 | A hotel Wi-Fi tells your phone "I answer for banka.rs". Nothing today lets the phone check whether the bank agreed. Encrypting DNS does not help: you are talking to the wrong server, encrypted. RFC 9704 (Jan 2025) gives the bank a way to say *who* may answer *for what*, and the device a way to check it. No public implementation existed. We built one, plus the lab to attack it. | Slide 1: the hotel/bank picture. |
| 0:40–1:30 | **The hotel forges the record.** The hotel's own resolver serves the Verification Record with the *correct* token. It wrote the claim, so it knows the token. The device computes the same token, fetches the record through the hotel, and the signature chain says: the bank's zone never signed this. Bogus. Rejected. The token is not the proof; the bank's signature is. | Scene *Hotel: forged record*, steps 1 to 4. On step 3 let the animation run: the query reaches `banka.lab` and the map breaks there. Step 4: read the verdict card; point at the dig output (token present, DNSSEC bogus). |
| 1:30–2:20 | **The company that actually agreed, and a client that never heard of SplitTrust.** corp.lab is signed and publishes two records; both claims accepted, the first delegates a key. In step 4, `host.internal.corp.lab` loads the intranet page with the AD bit. Then back to *Hotel Guest*: resolve `www.banka.lab`. This device cannot resolve it (SERVFAIL, DNSSEC Bogus) while the device without SplitTrust on the same Wi-Fi gets the hotel's fake bank page. | Scene *Office: the intranet*, steps 3 to 5 (the green path lights up; step 5 loads the intranet page with the AD flag). Then scene *Hotel: plain hijack*, step 5: two columns, fake bank on the left, cannot resolve on the right. |
| 2:20–2:50 | **The unsigned zone: both answers the RFC gives.** A device that validates DNSSEC has no proof and no fallback: rejected (§6.2). A phone whose default resolver is Quad9 verifies through it (§6.1): accepted, but yellow: its security now rests entirely on that resolver. Sign your zone. | Scene *Cafe: unsigned zone*, step 3 as the laptop (red at the zone); press `2` for the phone: the query goes to quad9.lab instead, yellow on step 4. |
| 2:50–3:30 | What we built: one Go binary (verifier, DNS proxy, CLI, API, console); a Docker lab with a private signed root, hybrid resolvers for a company and a hotel (honest and forging), PvD servers, an external resolver, web servers and a plain client; ten lab networks, three simulated devices, one real zone (`zivkovic.me`, green under the IANA root); published test vectors; an erratum. | Slide: architecture in one picture (How it works page / design §5). |
| 3:30–4:15 | **The RFC's only example is wrong, and we know exactly why.** 63 characters, 47 octets, SHA-384 gives 48. The printed token is the digest for the *previous draft's* salt with one zero byte dropped (a C-string bug), and the salt was reworded afterwards without recomputing. Two independent implementations (Go, Python) agree to the bit. Plus eight things the RFC leaves to implementers: `*` encoding, one claim per DHCP message, the replay counter, the DS owner name, and more. | Slide: the forensics table from `docs/rfc9704-example-erratum.md`. |
| 4:15–5:00 | Honest limits: needs OS/browser support; hybrid clients only; special-use names out of scope; unsigned zones lean on the external resolver; our lab is a private root: real verdicts, simulated world. Ask: file the erratum, publish the vectors to the ADD working group, get one resolver vendor to try it. | Slide: limits + ask. |

## Q&A cards (the other seven scenarios)

| Question | Run | Answer |
|---|---|---|
| "What if the hotel just doesn't forge?" | `hotel` | Secure NXDOMAIN travels through the hotel intact; rejected `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: the hotel can deny service, not redirect. Switch the client to `private-dns` on the same hotel: `curl http://www.banka.lab` prints "REAL www.banka.lab" via quad9.lab. |
| "What if IT changes the claim first?" | `stale-salt` | `TOKEN_MISMATCH`. RFC 9704 §11: publish the new record before changing the claim. |
| "Expired signatures?" | `expired-signature` | `DNSSEC_BOGUS: signature expired`. Monitor your signer. |
| "Why is `ds` there at all?" | `wrong-ds` and `legit` claim 1 | §7 lets the owner bind the local resolver's key without giving it the public zone's keys; a wrong value is `DS_MISMATCH`; with the right one, local answers validate (`resolve … host.internal.corp.lab`). Token-only authority (`legit` claim 2) cannot validate local answers: `LOCAL_DNSSEC_NOT_ESTABLISHED`. |
| "Can the hotel replay the company's claim?" | `replay` | It can announce `dns.corp.lab`, but it cannot present a certificate for it: `TLS_IDENTITY_FAILED` before a single DNS query (RFC 9704 §8 steps 3–5). |
| "What if the hotel blocks Quad9?" | `hotel-blocks-external` | §6.1: no response ⇒ verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only denial of service. |
| "home.arpa?" | `special-use` | §3: MUST NOT be validated; rejected with zero network traffic. |
| "Is this the global DNS?" | `real-zivkovic` | The lab is a private root (`trust_context: lab`). But: `docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic` verifies a record we published in the real `zivkovic.me` zone, validated under the IANA root (`trust_context: global`); with `--device private-dns` it goes through the real dns.quad9.net. |
| "Do I have to run a CLI?" | proxy | No: `splittrust proxy` is a DNS server; point any stub at it (in the lab, the `client` container). On a laptop it is the dnscrypt-proxy pattern (127.0.0.1); the product version would drive systemd-resolved/NRPT per-domain rules instead. |
| "Why Go?" | (none) | The tooling most likely to adopt this is Go (CoreDNS, AdGuard Home, Tailscale); one static binary; the validator is unbound itself via libunbound. |
| "Did you touch anything real?" | (none) | No. Isolated Docker network, no egress, synthetic zones and throwaway keys. The only Internet traffic is image pulls at build time. |

## Recovery

- Console shows "Cannot reach the API": `docker compose -f lab/compose.yaml ps`: all twelve services must be `running`; `docker compose -f lab/compose.yaml logs app proxy`.
- Step 4 says the proxy is unreachable: `docker compose -f lab/compose.yaml restart proxy`; the Demo page re-joins the client on the next network change.
- A scenario says `DNS_LOOKUP_FAILED`/`RESOLVER_UNREACHABLE`: a resolver container restarted with a new generation. `down -v && up --build -d`.
- Browser cannot reach 127.0.0.1:8000: `docker compose -f lab/compose.yaml port app 8000`.
- Everything else: play the backup video.
