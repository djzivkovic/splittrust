/* Introduction and closing slides: who we are, the problem, how RFC 9704 answers it, the two companies. */

import { ALFA, BETA } from "../lib/deck";
import { BLUE, Cloud, Doc, GREEN, INK, Laptop, Lock, Mark, Mask, MUTED, RED, Resolver, Router, Server, Shield } from "./Art";
import { Canvas, Slide } from "./Slide";

const Bubble = ({ x, y, w, text, tone = INK, tail = 0 }: { x: number; y: number; w: number; text: string; tone?: string; tail?: number }) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect x={-w / 2} y={-18} width={w} height={36} rx={18} fill="#fff" stroke={tone} strokeWidth={2.5} />
    <path d={`M ${tail - 10} 18 L ${tail - 4} 30 L ${tail + 6} 18 Z`} fill="#fff" stroke={tone} strokeWidth={2.5} strokeLinejoin="round" />
    <line x1={tail - 9} y1={18} x2={tail + 5} y2={18} stroke="#fff" strokeWidth={4} />
    <text textAnchor="middle" y={5} fontSize={14} fontWeight={600} fill={tone}>{text}</text>
  </g>
);

export function TitleSlide() {
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col justify-center px-10">
      <div className="text-sm font-semibold uppercase tracking-widest text-blue-700">DNS SEC(urity) Hackathon 2026</div>
      <h1 className="mt-3 text-5xl font-bold tracking-tight lg:text-6xl xl:text-7xl">SplitTrust</h1>
      <p className="mt-4 text-2xl text-slate-700 lg:text-3xl">Who may answer for your domain inside a network?</p>
      <p className="mt-2 text-lg text-slate-500 lg:text-xl">An implementation of RFC 9704, a lab to attack it, and what we learned on the way.</p>
      <div className="mt-12 text-base font-semibold text-slate-800">Team NXDOMAIN</div>
      <svg viewBox="-40 -50 520 130" className="mt-10 h-28 w-[520px] max-w-full">
        <g transform="translate(40,10)"><Laptop tone={BLUE} /></g>
        <g transform="translate(92,-24)"><Shield /></g>
        <line x1={130} y1={10} x2={210} y2={10} stroke="#cbd5e1" strokeWidth={2.5} />
        <g transform="translate(260,12)"><Router tone={INK} /></g>
        <line x1={320} y1={10} x2={390} y2={10} stroke="#cbd5e1" strokeWidth={2.5} />
        <g transform="translate(430,10)"><Lock tone={GREEN} /></g>
      </svg>
    </div>
  );
}

export function ProblemSlide() {
  return (
    <Slide section="The problem" title="Any network can say: my resolver answers for your domain" sub="Nothing lets a device check that the domain owner agreed."
      takeaway="Split-horizon DNS is normal and useful. The lie has exactly the same shape as the truth.">
      <Canvas viewBox="0 -10 1200 480" label="A hotel network claims a bank's domain">
        <rect x={60} y={300} width={1080} height={140} rx={24} fill="#fff7ed" />
        <text x={600} y={428} textAnchor="middle" fontSize={14} fontWeight={600} fill="#9a3412">Hotel Wi-Fi</text>
        {/* connections first, so nothing is drawn over the actors */}
        <line x1={200} y1={340} x2={600} y2={340} stroke="#cbd5e1" strokeWidth={2.5} />
        <line x1={600} y1={340} x2={600} y2={166} stroke="#cbd5e1" strokeWidth={2.5} />
        <line x1={654} y1={140} x2={926} y2={100} stroke="#cbd5e1" strokeWidth={2.5} />
        <g transform="translate(200, 370)"><Laptop /></g>
        <text x={200} y={436} textAnchor="middle" fontSize={15} fontWeight={600} fill={INK}>your laptop</text>
        <g transform="translate(600, 380)"><Router tone="#9a3412" /></g>
        <Bubble x={820} y={250} w={360} text="my resolver answers for banka.rs" tone="#9a3412" tail={-150} />
        <g transform="translate(600, 140)"><Resolver hostile /></g>
        <text x={600} y={196} textAnchor="middle" fontSize={13} fill={MUTED}>the hotel's resolver</text>
        <g transform="translate(960, 100)"><Server tone={RED} fill="#fef2f2" /><Mask x={0} y={-50} /></g>
        <text x={960} y={160} textAnchor="middle" fontSize={15} fontWeight={600} fill={RED}>a copy of the bank's login page</text>
        <g transform="translate(300, 310)"><Lock tone={MUTED} /></g>
        <text x={330} y={316} fontSize={13} fill={MUTED}>encrypted, to the wrong server</text>
        <text x={200} y={296} textAnchor="middle" fontSize={40} fontWeight={800} fill={INK}>?</text>
        <g transform="translate(1040, 54)"><Mark ok={false} size={16} /></g>
      </Canvas>
      <div className="grid grid-cols-3 gap-5 pb-2 text-base text-slate-700 lg:text-lg">
        <div className="rounded-xl bg-white p-4 shadow-sm"><b>Today:</b> the device takes the network's word for it. DHCP says "use this resolver", and it does. Encrypting the queries to that resolver is a private conversation with the attacker.</div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><b>Not hypothetical:</b> DNS interception was measured in 259 of 3,047 networks probed (USENIX Security 2018); a hotel in Amsterdam was documented rewriting DNS answers and stripping DNSSEC signatures (2013); DarkHotel delivered malware over hotel networks (Kaspersky, 2014).</div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><b>RFC 9704 (January 2025)</b> gives the domain owner a way to say who may answer for which names, and the device a way to check. Its authors reported no known implementation in February 2025.</div>
      </div>
    </Slide>
  );
}

export function HowSlide() {
  const col = (x: number, n: number, title: string, who: string) => (
    <g>
      <circle cx={x} cy={40} r={18} fill={INK} /><text x={x} y={46} textAnchor="middle" fontSize={16} fontWeight={800} fill="#fff">{n}</text>
      <text x={x} y={90} textAnchor="middle" fontSize={18} fontWeight={700} fill={INK}>{title}</text>
      <text x={x} y={112} textAnchor="middle" fontSize={13} fill={MUTED}>{who}</text>
    </g>
  );
  return (
    <Slide section="RFC 9704" title="How it works, in three steps" sub="The owner publishes, the network claims, the device checks."
      takeaway="The token can be copied by anyone. The owner's signature (or a trusted resolver's word) and the resolver's certificate cannot.">
      <Canvas viewBox="0 0 1240 440" label="The three steps of RFC 9704">
        <line x1={300} y1={300} x2={470} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        <line x1={700} y1={300} x2={840} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        {col(200, 1, "The domain owner publishes", "one TXT record in its own zone")}
        {col(600, 2, "The network announces a claim", "DHCP option or PvD document")}
        {col(1010, 3, "The device checks before trusting", "SplitTrust does this part")}

        {/* 1: zone with lock and the TXT record */}
        <g transform="translate(200, 230)"><Cloud /></g>
        <text x={194} y={226} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>alfa.example zone</text>
        <text x={194} y={246} textAnchor="middle" fontSize={11} fill={MUTED}>DNSSEC-signed, or reached via a trusted resolver</text>
        <g transform="translate(262, 190)"><Lock tone={GREEN} /></g>
        <g transform="translate(200, 350)"><Doc tone={BLUE} /></g>
        <text x={200} y={404} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={INK}>dns.alfa.example._splitdns-challenge.alfa.example</text>
        <text x={200} y={422} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={BLUE}>TXT "token=&lt;hash(salt, claim)&gt;"</text>

        {/* 2: router announcing */}
        <g transform="translate(600, 330)"><Router tone={BLUE} /></g>
        <Bubble x={600} y={230} w={400} text="dns.alfa.example answers for internal.alfa.example" tone={BLUE} />
        <text x={600} y={404} textAnchor="middle" fontSize={12} fill={MUTED}>plus the salt the owner used</text>

        {/* 3: laptop with shield and three checks */}
        <g transform="translate(880, 340)"><Laptop tone={BLUE} /></g>
        <g transform="translate(924, 300)"><Shield /></g>
        {[
          ["the resolver proves its name", "DNS over TLS, certificate (RFC 9525)"],
          ["the owner's record validates", "DNSSEC locally, or via a resolver the device trusts"],
          ["the token matches the claim", "only then route those names there"],
        ].map(([t, s], i) => (
          <g key={t} transform={`translate(975, ${190 + i * 62})`}>
            <Mark ok size={11} />
            <text x={20} y={-2} fontSize={14} fontWeight={600} fill={INK}>{t}</text>
            <text x={20} y={16} fontSize={12} fill={MUTED}>{s}</text>
          </g>
        ))}

      </Canvas>
    </Slide>
  );
}

export function CompaniesSlide() {
  return (
    <Slide section="The demo" title="Two companies, one week" sub="Same employees, same habits, different outcomes."
      takeaway="Every verdict and every page that follows is computed live: SecureCompany's zone is our real, DNSSEC-signed zivkovic.me.">
      <div className="grid flex-1 content-center gap-8 md:grid-cols-2">
        <Company name={BETA.name} domain={BETA.domain} adopted={false} line="Trusts whatever resolver the network hands out. Most companies today." />
        <Company name={ALFA.name} domain={ALFA.domain} adopted line="Signed its zone, published one record, and its devices check before trusting a resolver." />
      </div>
    </Slide>
  );
}

function Company({ name, domain, adopted, line }: { name: string; domain: string; adopted: boolean; line: string }) {
  return (
    <div className={`flex items-center gap-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${adopted ? "border-blue-300" : "border-slate-200"}`}>
      <svg viewBox="-70 -60 140 120" className="h-28 w-32 shrink-0">
        <g transform="translate(0,6)"><Laptop tone={adopted ? BLUE : INK} /></g>
        {adopted && <g transform="translate(44,-30)"><Shield /></g>}
      </svg>
      <div>
        <div className="flex flex-wrap items-baseline gap-x-3"><span className="text-3xl font-bold">{name}</span><code className="text-sm text-slate-500">{domain}</code></div>
        <div className={`mt-1 text-sm font-semibold ${adopted ? "text-blue-700" : "text-slate-500"}`}>{adopted ? "uses SplitTrust" : "no SplitTrust"}</div>
        <p className="mt-2 text-lg text-slate-700">{line}</p>
      </div>
    </div>
  );
}

export function ClosingSlide() {
  return (
    <Slide section="Closing" title="What this is, what it is not, and what we ask" takeaway="github.com/djzivkovic/splittrust">
      <div className="grid flex-1 content-center gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border-2 border-green-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-bold text-green-800">Real</div>
          <ul className="mt-3 space-y-2 text-base text-slate-700">
            <li>The RFC 9704 device-side pipeline, verification and enforcement, plus the owner's tool</li>
            <li>A DNS proxy any ordinary client can use today</li>
            <li>Tested live against the public DNS with our own signed zone</li>
            <li>Published test vectors and a draft erratum</li>
          </ul>
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-bold text-slate-700">Not yet</div>
          <ul className="mt-3 space-y-2 text-base text-slate-700">
            <li>Not an OS integration: protection applies to clients that use the proxy; a product would drive systemd-resolved or Windows NRPT</li>
            <li>Discovery is pre-configured; the DHCP option is encoded, not sent</li>
            <li>Unsigned zones are verified only through an external resolver the device already trusts (s.6.1); that trust is then the whole story</li>
          </ul>
        </div>
        <div className="rounded-2xl border-2 border-blue-200 bg-white p-6 shadow-sm">
          <div className="text-xl font-bold text-blue-800">Ask</div>
          <ul className="mt-3 space-y-2 text-base text-slate-700">
            <li>File the erratum for section 5.1</li>
            <li>Publish the vectors to the ADD working group</li>
            <li>Get one resolver vendor to try it</li>
            <li>Sign your zone</li>
          </ul>
        </div>
      </div>
    </Slide>
  );
}
