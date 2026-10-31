const Code = ({ children }: { children: string }) => <pre className="overflow-auto rounded-xl bg-slate-950 p-3 text-sm text-emerald-200">{children}</pre>;

export function About() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 pb-24 pt-8 leading-relaxed">
      <section>
        <h1 className="text-3xl font-black">What is the point?</h1>
        <p className="mt-4 text-lg text-slate-200">
          A hotel Wi-Fi can tell your device “my resolver answers for <code>banka.rs</code>”. Nothing today lets the device check whether the bank agreed —
          and encrypting DNS does not help when you are talking to the wrong server, encrypted. Split-horizon DNS is legitimate and common (a company
          resolver answers for <code>internal.corp.example</code>); the abuse has exactly the same shape.
        </p>
        <p className="mt-3 text-lg text-slate-200">
          <b>RFC 9704</b> (January 2025) gives the <b>domain owner</b> a way to publish, in its own DNSSEC-signed zone, <i>which resolver may answer for which names</i>,
          and gives the <b>device</b> a way to check that statement through a path the local network cannot forge. It had no public implementation, no test vectors,
          and a worked example that cannot be reproduced. <b>SplitTrust</b> is the device side (plus the owner's publishing tool), and a laboratory in which every actor is ours.
        </p>
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">Three roles, one question: “may this resolver answer for these names?”</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div><div className="font-bold text-sky-300">Domain owner</div><p className="mt-1 text-sm text-slate-300">Publishes a <i>Verification Record</i> — <code>TXT resolver._splitdns-challenge.parent</code> — carrying a token (a salted hash of the exact claim) and optionally a <code>ds</code> that delegates a DNSSEC key to that resolver. The zone must be signed for this to prove anything.</p></div>
          <div><div className="font-bold text-amber-300">Network</div><p className="mt-1 text-sm text-slate-300">Announces its encrypted resolver (DNR) and a <i>claim</i>: “resolver R answers for subdomains S of parent P, salt X”, via a DHCP option or the PvD JSON document.</p></div>
          <div><div className="font-bold text-emerald-300">Device</div><p className="mt-1 text-sm text-slate-300">Computes the token, makes the resolver prove its name over TLS, fetches the owner's record with DNSSEC validation (or via an external resolver it already trusts), compares tokens, checks the delegated key — and only then routes exactly those names to that resolver.</p></div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold">Why a lab?</h2>
        <p className="mt-2 text-slate-200">You cannot demonstrate this on the public Internet without owning the network <i>and</i> the domain <i>and</i> an attacker. The lab is a miniature Internet in Docker where we own all three — and the cryptography is real:</p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-300">
          <li>a private DNS root with a genuine DNSSEC chain (BIND): <code>. → lab → corp.lab, banka.lab, unsigned.lab, expired.lab, …</code></li>
          <li>the company's resolver <code>dns.corp.lab</code> (CoreDNS over DNS-over-TLS) serving the split-horizon zones it was authorised for</li>
          <li>the hotel's resolver <code>dns.hotel.lab</code> with an honest view, a <i>forging</i> view, and plain DNS for naive guests</li>
          <li>a PvD server with each network's claims, and <code>quad9.lab</code> — the external validating resolver a privacy-minded phone uses</li>
          <li>three web servers that say who they are: the company intranet, the real bank, the hotel's fake bank</li>
          <li>a <b>plain client</b> container (curl, no SplitTrust code) whose DNS server is the SplitTrust proxy, and its <b>naive twin</b> that uses the hotel's DNS</li>
        </ul>
        <p className="mt-3 text-slate-200">Each <b>network</b> on the Stage page is one of these worlds. Each <b>device</b> is a way the RFC lets a client behave. Verdicts are produced by the Go engine (libunbound does the DNSSEC validation); the console only tells the story.</p>
        <p className="mt-3 text-slate-200">One scenario leaves the lab: <code>zivkovic.me</code>, our real Cloudflare-hosted, DNSSEC-signed zone, verified under the IANA root from the lab's only Internet-connected container.</p>
      </section>

      <section className="card">
        <h2 className="text-xl font-bold">How to present</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-6 text-slate-200">
          <li><b>Pick who you are</b> (<span className="kbd">1</span> laptop that validates, <span className="kbd">2</span> phone with Private DNS, <span className="kbd">3</span> hybrid).</li>
          <li><b>Join a network</b> (<span className="kbd">←</span> <span className="kbd">→</span>). The card says what the network claims and what is true in the world.</li>
          <li><b>Watch the device check</b>: the packets travel, the checks light up, and the map breaks exactly where the scenario breaks. <span className="kbd">space</span> replays; the speed selector is for Q&amp;A.</li>
          <li><b>Browse</b>: type a name as a plain client on that network would. Left: your device through SplitTrust. Right (hotel networks): a naive device on the same Wi-Fi.</li>
        </ol>
        <p className="mt-4 text-sm text-slate-400">Suggested five minutes: Hotel Guest → <i>forges the record</i> (correct token, no signature chain → rejected) · Corp Wi-Fi (green, then browse the intranet) · Hotel Guest → browse <code>www.banka.lab</code> as laptop (cannot resolve) vs naive (fake bank) vs phone (real bank) · Startup Café as laptop (red) then as phone (yellow): sign your zone.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold">Colours</h2>
        <p className="mt-2 text-slate-300"><span className="chip chip-green">green</span> authority established and answers validated · <span className="chip chip-yellow">yellow</span> authority rests on someone else (Quad9) or no key was delegated · <span className="chip chip-red">red</span> rejected · <span className="chip chip-grey">grey</span> could not decide (network error) — grey never pretends to be red or green.</p>
      </section>

      <section>
        <h2 className="text-xl font-bold">Running it</h2>
        <Code>{`docker compose -f lab/compose.yaml up --build -d        # Docker only; first build a few minutes
open http://127.0.0.1:8000                              # this console
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.corp.lab
docker compose -f lab/compose.yaml exec naive  curl -s http://www.banka.lab
docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic
docker compose -f lab/compose.yaml --profile tools run --rm test   # the integration suite
docker compose -f lab/compose.yaml down -v`}</Code>
      </section>

      <section>
        <h2 className="text-xl font-bold">Honest limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-slate-300">
          <li>Nothing intercepts the host's DNS; protection applies to clients that use the SplitTrust proxy (or the CLI) as their resolver. A product would drive the OS's own split-DNS machinery (systemd-resolved, Windows NRPT).</li>
          <li>Discovery is pre-configured per network; the DHCP option is encoded and decoded, not sent on a wire.</li>
          <li>The lab is a private root: real verdicts about a simulated Internet. Rejecting a claim does not make an untrusted default resolver safe; publishing a record protects only clients that check.</li>
          <li>Unsigned zones can only be verified through an external resolver the device already trusts — the RFC's §6.1 — and that is yellow for a reason.</li>
        </ul>
        <p className="mt-4 text-sm text-slate-500">Team NXDOMAIN · DNS SEC(urity) Hackathon 2026 · Go engine, libunbound, CoreDNS, BIND, nginx, unbound; console in React. Built with AI assistance under the team's direction, as the rules allow. Repository docs: README, docs/demo.md, docs/rfc9704-example-erratum.md, docs/concept-and-ui-flow.md.</p>
      </section>
    </div>
  );
}
