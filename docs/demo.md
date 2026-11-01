# SplitTrust: the 5-minute presentation

One company, one employee, one private GitLab bookmark: **`git.dev.corp.lab`**. Compare trusting network
DNS directly with checking the company's authorization through the client-side SplitTrust proxy. These are
clearly labeled illustrations, not live results. The presentation performs no API calls, DNS lookups,
Docker commands or proxy network changes. Our separate playground runs the actual checks.

The presentation is at `http://127.0.0.1:8000`. The main pitch has ten slides: 1 title, 2 split-horizon
DNS (background), 3 the private-DNS problem, 4 how RFC 9704 works, 5 at the office, 6 at the hotel,
7 what the company configures, 8 working deliverables, 9 demonstrated evidence, 10 closing. The full
spoken text is in `docs/speech.md`; the table below is the compressed version.
The appendix is numbered separately: A1 historical context, A2 detailed architecture, A3 proxy rules,
A4 implementation inventory, A5 beneficiaries/deployers, A6 complementary protections, A7 deployment,
A8 owner-record format, A9 one managed-device pilot. Left/right arrows
navigate. The office and hotel examples animate packets and reveal checks in order; the setup example
reveals its configuration steps. **Replay illustration** or **space** restarts these browser-only
animations. Each step takes about 2.1 seconds; the active route is highlighted and the packet pauses
before the next step. Reduced-motion preferences show the completed diagrams. There are no device switches,
live evidence panels or embedded record-building forms. No animation makes a backend request.

## Before you go on stage

```bash
cd web
npm ci
npm run dev   # use the URL printed by Vite; no Docker or API needed for the slides
```

If you will also show the live playground, start the Docker lab separately with
`docker compose -f lab/compose.yaml up --build -d` from the repository root and open
`http://127.0.0.1:8000`. Only the **Try it yourself** link leaves the presentation for `/demo`.

## Script

| Time | Say | Show |
|---|---|---|
| 0:00-0:15 | Team NXDOMAIN, SplitTrust: when a network says "my resolver answers for your company's names", can the laptop check that the company agreed? | Slide 1. |
| 0:15-0:45 | Split-horizon DNS: internal names, private addresses, only on the company network or VPN. Public DNS proves they do not exist. Chaining the internal zone into the public one or installing trust anchors is rarely done, so the laptop trusts whatever resolver the network hands it. | Slide 2. |
| 0:45-1:10 | The same bookmark at a hotel: the hotel's resolver can claim the same names. An announcement is not proof of authorization, and requiring DNSSEC would break the real intranet too. | Slide 3. |
| 1:10-1:40 | RFC 9704: the owner publishes a Verification Record, the network supplies a claim, the client authenticates the resolver and the owner's permission before granting a scoped exception. | Slide 4. |
| 1:40-2:15 | At the office the private view is legitimate: the signed record validates, the private 10.20.0.10 answer is accepted, normal DNS policy for everything else. | Slide 5: narrate over the animation. |
| 2:15-2:55 | At the hotel, VPN off: network DNS hands out an attacker IP. The company's signed denial says the hotel has no authorization; the proxy rejects the invented answer. HTTPS remains a separate safeguard. | Slide 6. |
| 2:55-3:15 | Copying the public claim is insufficient: the hotel's certificate cannot prove dns.corp.lab's identity. | Slide 7. |
| 3:15-3:45 | We built the verifier, a DNS proxy ordinary clients can use, and the owner's record builder. Network profiles are configured in this prototype. | Slide 8. |
| 3:45-4:20 | Demonstrated: private GitLab access, rejected hotel authority, refusal of a wrong delegated key; scenario profiles, reproducible vectors, a documented RFC example discrepancy. | Slide 9. |
| 4:20-5:00 | Legitimate private DNS without granting every network authority over company names. Inspect it in the playground; the next step is one managed-device pilot. | Slide 10. |

## Optional live playground

At `/demo`, use the same bookmark, `git.dev.corp.lab`, through three steps: office (public NXDOMAIN,
validated private answer and repository stand-in), unprotected hotel (fake login stand-in), protected
hotel (unauthorized claim and bogus answer rejected). These run actual `dig`/`curl` commands inside
Docker and show their evidence. The pages are HTTP stand-ins, collect no credentials, and do not
demonstrate bypassing HTTPS. The owner builder is a separate tab on that page.
The playground header has **Back to presentation** and **Go to appendix** links. The latter opens
`/#appendix` at A1, so questions can go straight to the supporting material without replaying the pitch.

## Q&A

| Question | Where | Answer |
|---|---|---|
| "Are the slides showing actual results?" | Closing link to `/demo` | No: the slides are illustrations and make no backend requests. The separate playground shows actual command output using the private lab trust anchor. The CLI also supports the real-zone scenarios under the public DNSSEC chain. |
| "What if the hotel does not forge, just hijacks?" | CLI: `verify --scenario hotel` | Secure denial from the real zone travels through the hotel intact: `RECORD_MISSING`. The hijacked answer is Bogus for a validating device: denial of service, not redirection. |
| "What if the zone is not signed?" | CLI: `verify --scenario unsigned` (and `--device private-dns`) | A validating device has no proof and no fallback: rejected. A phone with Private DNS verifies through Quad9: accepted, yellow, because its security now rests on Quad9. Sign your zone. |
| "What if IT changes the claim first, or lets signatures expire, or delegates the wrong key?" | CLI: `stale-salt`, `expired-signature`, `wrong-ds` | `TOKEN_MISMATCH` (publish the record first, RFC 9704 section 11), `DNSSEC_BOGUS`, `DS_MISMATCH` (no downgrade to token-only). |
| "What if the hotel blocks Quad9?" | CLI: `hotel-blocks-external` | Section 6.1: no response means verification failed, `EXTERNAL_TIMEOUT`. The hotel gains only a denial of service. |
| "home.arpa?" | CLI: `special-use` | Section 3: never verified this way; rejected with zero network traffic. |
| "Do users have to run a CLI?" | Main 7, appendix A4 | No. Ordinary DNS clients can use the proxy. Endpoint configuration is required; native OS implementation is future work. |
| "Why not just HTTPS / VPN / DoH / DNSSEC?" | Appendix A6 | They answer different questions. HTTPS authenticates the application; a VPN provides private connectivity and can supply trusted DNS policy; encrypted DNS protects a resolver connection; DNSSEC authenticates DNS data. Correctly configured private DNS can use DNSSEC. RFC 9704 adds its owner-authorized local-view mechanism alongside these protections. |
| "What does a company actually have to do?" | Appendix A7-A8 | Authenticate the parent zone, publish authorization, provide a supported encrypted resolver with a matching certificate, and configure checking clients. Existing resolver software may need additional support; this is not zero deployment. |
| "Does changing the resolver change the token?" | Appendix A8 | Not when the salt, algorithm and canonical relative subdomains stay the same. The resolver is bound by the Verification Record owner name. Changing only the resolver changes that DNS name, not the token hash. |
| "Does presenting require Docker?" | Presentation versus `/demo` | No. The slides work from a static frontend or Vite without the API. Docker is needed only for the separate command playground and laboratory checks. |
| "Who benefits?" | Appendix A5 | Organizations with private services and roaming managed devices. DNS, resolver and endpoint teams deploy the pieces; OS and management vendors are potential integration partners, not assumed current implementers. |
| "What about unsigned parent zones?" | Appendix A4/A7 | RFC 9704 section 6.1 can authenticate the record through an external resolver the device already trusts. That path depends on the external resolver; it is not local DNSSEC validation of an unsigned record. |
| "How does this prototype learn claims?" | Appendix A2/A9 | Network profiles are preconfigured. The prototype has PvD fetching and DHCP codec support, not complete automatic network discovery. A first pilot can distribute explicit configuration through existing management tools. |
| "Is it the first implementation?" | Appendix A1 | The authors reported none known in February 2025. That historical report is not a current implementation census; our claim is working code and reproducible evidence. |
| "Why Go?" | (none) | One Go executable and a useful resolver-tooling ecosystem; DNSSEC validation uses libunbound rather than a new cryptographic implementation. |
| "Did you touch anything you do not own?" | (none) | No. Our own domain, our own containers; only ordinary DNS queries leave the machine. |

## Recovery

- If the slides do not load, check the static frontend server and rebuild `web`; they have no API dependency.
- If `/demo` is unavailable, continue presenting. Inspect the Docker lab separately; there is no reason to restart DNS to show the slides.
- An inconclusive playground run is not a successful attack or a successful block. Show its actual error rather than replacing it with the expected result.
