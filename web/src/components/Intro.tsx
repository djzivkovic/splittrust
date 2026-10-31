/* Introduction and closing slides: who we are, the problem, how RFC 9704 answers it, the two companies. */

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
      <p className="mt-2 text-lg text-slate-500 lg:text-xl">RFC 9704 verification, tested against a hostile resolver.</p>
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
    <Slide section="The problem" title="Any network can say: my resolver answers for your domain" sub="The device has no way to check that the domain owner agreed."
      takeaway={<span className="text-base text-slate-600">DNS interception was found in 259 of 3,047 networks measured (Liu et al., USENIX Security 2018). Hotel networks rewriting DNS are documented since 2013.</span>}>
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
    <Slide section="RFC 9704" title="How it works, in three steps"
      takeaway="Copying the record is not enough: the resolver must also prove the claimed name over TLS.">
      <Canvas viewBox="0 0 1240 440" label="The three steps of RFC 9704">
        <line x1={300} y1={300} x2={470} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        <line x1={700} y1={300} x2={840} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        {col(200, 1, "The domain owner publishes", "one TXT record in its own zone")}
        {col(600, 2, "The network announces a claim", "DHCP option or PvD document")}
        {col(1010, 3, "The device checks before trusting", "SplitTrust does this part")}

        {/* 1: zone with lock and the TXT record */}
        <g transform="translate(200, 230)"><Cloud /></g>
        <text x={194} y={226} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>alfa.example zone</text>
        <text x={194} y={246} textAnchor="middle" fontSize={12} fill={MUTED}>DNSSEC-signed</text>
        <g transform="translate(262, 190)"><Lock tone={GREEN} /></g>
        <g transform="translate(200, 350)"><Doc tone={BLUE} /></g>
        <text x={200} y={404} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={INK}>dns.alfa.example._splitdns-challenge.alfa.example</text>
        <text x={200} y={422} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={BLUE}>TXT "token=&lt;hash(salt, subdomains)&gt;"</text>

        {/* 2: router announcing */}
        <g transform="translate(600, 330)"><Router tone={BLUE} /></g>
        <Bubble x={600} y={230} w={400} text="dns.alfa.example answers for internal.alfa.example" tone={BLUE} />
        <text x={600} y={404} textAnchor="middle" fontSize={13} fill={MUTED}>plus the salt</text>

        {/* 3: laptop with shield and three checks */}
        <g transform="translate(880, 340)"><Laptop tone={BLUE} /></g>
        <g transform="translate(924, 300)"><Shield /></g>
        {[
          ["TLS: the certificate matches the name", ""],
          ["DNSSEC: the owner's record validates", ""],
          ["the token matches the claim", "only then are those names routed there"],
        ].map(([t, s], i) => (
          <g key={t} transform={`translate(975, ${190 + i * 62})`}>
            <Mark ok size={11} />
            <text x={20} y={4} fontSize={16} fontWeight={600} fill={INK}>{t}</text>
            {s && <text x={20} y={24} fontSize={13} fill={MUTED}>{s}</text>}
          </g>
        ))}

      </Canvas>
    </Slide>
  );
}

export function ClosingSlide() {
  const row = (label: string, text: string, tone: string) => (
    <div className="flex items-baseline gap-6 rounded-2xl border-2 border-slate-200 bg-white px-8 py-5 shadow-sm">
      <span className={`w-28 shrink-0 text-xl font-bold ${tone}`}>{label}</span>
      <span className="text-xl text-slate-800">{text}</span>
    </div>
  );
  return (
    <Slide section="Closing" title="What this is, what it is not, what we ask" takeaway="github.com/djzivkovic/splittrust">
      <div className="flex flex-1 flex-col justify-center gap-4">
        {row("Built", "the RFC 9704 check, a DNS proxy that enforces it, the owner's record tool; tested against our own signed zone", "text-green-800")}
        {row("Not yet", "OS integration, and claims arriving over DHCP or PvD on the wire. Unsigned zones depend on a resolver the device already trusts (RFC 9704 §6.1)", "text-slate-600")}
        {row("Ask", "one OS or resolver vendor to try it, one company with split-horizon DNS for a managed-device pilot", "text-blue-800")}
      </div>
    </Slide>
  );
}
