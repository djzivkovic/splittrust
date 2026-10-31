const Code = ({ children }: { children: string }) => <pre className="overflow-auto rounded-lg bg-slate-900 p-3 text-sm text-slate-100">{children}</pre>;

export function HowItWorks() {
  return (
    <div className="mx-auto max-w-4xl space-y-10 px-6 pb-24 pt-8 leading-relaxed">
      <section>
        <h1 className="text-3xl font-bold">What this project does</h1>
        <p className="mt-4 text-lg text-slate-800">
          A hotel Wi-Fi can tell your device "my resolver answers for <code>banka.rs</code>". Nothing today lets the device check whether the bank agreed.
          Encrypting DNS does not help when you are talking to the wrong server, encrypted. Split-horizon DNS is legitimate and common (a company
          resolver answers for <code>internal.corp.example</code>); the abuse has exactly the same shape.
        </p>
        <p className="mt-3 text-lg text-slate-800">
          <b>RFC 9704</b> (January 2025) gives the <b>domain owner</b> a way to publish, in its own DNSSEC-signed zone, which resolver may answer for which names,
          and gives the <b>device</b> a way to check that statement through a path the local network cannot forge. When we started, it had no public implementation,
          no test vectors, and a worked example that cannot be reproduced. <b>SplitTrust</b> is an implementation of the device side (plus the owner's publishing tool)
          and a laboratory in which every actor is ours.
        </p>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">Three roles, one question: may this resolver answer for these names?</h2>
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <div><div className="font-semibold text-blue-800">Domain owner</div><p className="mt-1 text-sm text-slate-700">Publishes a Verification Record, <code>TXT resolver._splitdns-challenge.parent</code>, carrying a token (a salted hash of the exact claim) and optionally a <code>ds</code> value that delegates a DNSSEC key to that resolver. The zone must be signed for this to prove anything.</p></div>
          <div><div className="font-semibold text-blue-800">Network</div><p className="mt-1 text-sm text-slate-700">Announces its encrypted resolver (DNR) and a claim: "resolver R answers for subdomains S of parent P, salt X", via a DHCP option or the PvD JSON document.</p></div>
          <div><div className="font-semibold text-blue-800">Device</div><p className="mt-1 text-sm text-slate-700">Computes the token, makes the resolver prove its name over TLS, fetches the owner's record with DNSSEC validation (or through an external resolver it already trusts), compares tokens, checks the delegated key, and only then routes exactly those names to that resolver.</p></div>
        </div>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Why a lab</h2>
        <p className="mt-2 text-slate-800">You cannot demonstrate this on the public Internet without owning the network, the domain and an attacker at the same time. The lab is a small Internet in Docker where we own all three, and the cryptography is real:</p>
        <ul className="mt-3 list-disc space-y-1 pl-6 text-slate-700">
          <li>a private DNS root with a genuine DNSSEC chain (BIND): <code>. &gt; lab &gt; corp.lab, banka.lab, unsigned.lab, expired.lab, ...</code></li>
          <li>the company's resolver <code>dns.corp.lab</code> (CoreDNS over DNS-over-TLS), serving the split-horizon zones it was authorised for</li>
          <li>the hotel's resolver <code>dns.hotel.lab</code> with an honest view, a forging view, and plain DNS for guests without SplitTrust</li>
          <li>a PvD server with each network's claims, and <code>quad9.lab</code>, the external validating resolver a phone with Private DNS uses</li>
          <li>web servers that say who they are: Alfa's intranet, Beta's intranet, the lab's bank, and the hotel's fake page</li>
          <li>a plain client container (curl, no SplitTrust code) whose DNS server is the SplitTrust proxy, and a twin that uses the network's resolver directly, as Beta's devices do</li>
        </ul>
        <p className="mt-3 text-slate-800">The Demo page compares two companies. <b>Alfa</b> adopted RFC 9704: its zone is <code>zivkovic.me</code>, our Cloudflare-hosted, DNSSEC-signed zone with the Verification Record published and the DS record at the .me registry; its devices verify. <b>Beta</b> (<code>beta.example</code>) did not; its devices use whatever resolver the network hands them. The office and hotel resolvers, the devices and the proxy have Internet access, like their real counterparts, so every Alfa verdict is computed against the real root, the real .me zone and the real dns.quad9.net. The lab's own private root and the .lab zones remain for the RFC's corner cases (unsigned zone, expired signatures, stale record, wrong key, Special-Use names), which you can run from the Tools page.</p>
        <p className="mt-3 text-slate-800">Verdicts are produced by the Go engine (libunbound does the DNSSEC validation); this console only presents them.</p>
      </section>

      <section className="card">
        <h2 className="text-xl font-semibold">How to present</h2>
        <ol className="mt-3 list-decimal space-y-2 pl-6 text-slate-800">
          <li><b>The story</b>: the situation, what Beta's device does, what Alfa's device does, why it matters, and one command anyone in the room can run to check the real records.</li>
          <li><b>Alfa's device checks</b> (<span className="kbd">→</span>): the query travels across the map of real actors, checks light up, and the map breaks where the scene breaks. <span className="kbd">space</span> replays; <span className="kbd">e</span> shows the evidence: the announcement verbatim, the query as dig would print it, the resolver's certificate next to the announced name. Keys <span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span> switch Alfa's device (laptop that validates, phone with Private DNS, hybrid).</li>
          <li><b>Both devices open the intranet</b>: real lookups and fetches, now. Beta's laptop on the left through the network's resolver, Alfa's on the right through SplitTrust. On the hotel scenes press <span className="kbd">2</span>: Alfa's phone reaches the real site through dns.quad9.net.</li>
        </ol>
        <p className="mt-4 text-sm text-slate-600">Order for the talk: Monday at the office (both work; only Alfa verified), Tuesday at the hotel (Beta gets the hotel's page, Alfa fails safely, the phone reaches the real site), What Alfa's IT did (sign the zone, publish one record, run a resolver that checks; a copied claim dies on the certificate; the real zone's records right now).</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Colours</h2>
        <p className="mt-2 text-slate-700"><span className="chip chip-green">green</span> authority established and answers validated. <span className="chip chip-yellow">yellow</span> authority rests on someone else (Quad9) or no key was delegated. <span className="chip chip-red">red</span> rejected. <span className="chip chip-grey">grey</span> could not decide (network error); grey never pretends to be red or green.</p>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Running it</h2>
        <Code>{`docker compose -f lab/compose.yaml up --build -d        # Docker only; the first build takes a few minutes
open http://127.0.0.1:8000                              # this console
docker compose -f lab/compose.yaml exec client curl -s http://host.internal.splittrust.zivkovic.me
docker compose -f lab/compose.yaml exec naive  curl -s http://www.zivkovic.me
docker compose -f lab/compose.yaml exec app splittrust verify --scenario real-hotel-forged
docker compose -f lab/compose.yaml --profile tools run --rm test   # the integration suite
docker compose -f lab/compose.yaml down -v`}</Code>
      </section>

      <section>
        <h2 className="text-xl font-semibold">Limits</h2>
        <ul className="mt-2 list-disc space-y-1 pl-6 text-slate-700">
          <li>Nothing intercepts the host's DNS. Protection applies to clients that use the SplitTrust proxy (or the CLI) as their resolver. A product would drive the operating system's own split-DNS machinery (systemd-resolved, Windows NRPT).</li>
          <li>Discovery is pre-configured per network. The DHCP option is encoded and decoded, not sent on a wire.</li>
          <li>The demo depends on the venue's Internet: the three scenes validate against the real DNS. The lab's own scenarios (Tools page) run without it.</li>
          <li>Rejecting a claim does not make an untrusted default resolver safe, and publishing a record protects only clients that check.</li>
          <li>Unsigned zones can only be verified through an external resolver the device already trusts (RFC 9704 section 6.1). That is yellow for a reason.</li>
        </ul>
        <p className="mt-4 text-sm text-slate-500">Team NXDOMAIN, DNS SEC(urity) Hackathon 2026. Go engine with libunbound; lab on CoreDNS, BIND, nginx and unbound; console in React. Built with AI assistance under the team's direction, as the rules allow. Repository docs: README, docs/demo.md, docs/architecture.md, docs/rfc9704-example-erratum.md.</p>
      </section>
    </div>
  );
}
