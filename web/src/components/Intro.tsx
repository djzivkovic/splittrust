/* Introduction, the owner-permission mechanism, and the pitch closing. */

import { BLUE, Cloud, Doc, GREEN, INK, Laptop, Lock, Mark, MUTED, RED, Resolver, Router, Shield } from "./Art";
import { Canvas, Slide } from "./Slide";
import { STORY } from "../lib/deck";

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
      <p className="mt-4 text-2xl text-slate-700 lg:text-3xl">Private DNS, with the owner's permission.</p>
      <p className="mt-2 max-w-3xl text-lg text-slate-500 lg:text-xl">Reach company services without blindly trusting every network's DNS. A working RFC 9704 verifier and enforcing proxy.</p>
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
    <Slide section="The problem" title="Private DNS needs proof of permission"
      sub="The same GitLab bookmark follows an employee from office to hotel."
      takeaway="A network announcing a resolver does not prove the domain owner authorized it.">
      <div className="mt-3 grid gap-3 text-base md:grid-cols-2">
        <p className="rounded-xl border border-blue-200 bg-blue-50 p-4"><b>The legitimate need:</b> company GitLab has a private DNS view that public DNS does not provide.</p>
        <p className="rounded-xl border border-slate-200 bg-white p-4"><b>The trust gap:</b> accepting every network's claimed private view also accepts an attacker's claim.</p>
      </div>
      <Canvas viewBox="0 0 1200 390" label="Office and hotel make the same GitLab DNS claim">
        <line x1={284} y1={190} x2={550} y2={250} stroke="#cbd5e1" strokeWidth={3} />
        <line x1={916} y1={190} x2={650} y2={250} stroke="#cbd5e1" strokeWidth={3} />
        <Bubble x={230} y={80} w={360} text="I can answer for dev.corp.lab" tone={BLUE} />
        <Bubble x={970} y={80} w={360} text="I can answer for dev.corp.lab" tone={RED} />
        <g transform="translate(230,190)"><Resolver tone={BLUE} /></g>
        <text x={230} y={245} textAnchor="middle" fontSize={18} fontWeight={700} fill={BLUE}>Company resolver</text>
        <text x={230} y={273} textAnchor="middle" fontSize={15} fill={MUTED}>{STORY.officeResolver}</text>
        <g transform="translate(970,190)"><Resolver hostile /></g>
        <text x={970} y={245} textAnchor="middle" fontSize={18} fontWeight={700} fill={RED}>Hotel resolver</text>
        <text x={970} y={273} textAnchor="middle" fontSize={15} fill={MUTED}>{STORY.hotelResolver}</text>
        <g transform="translate(600,260)"><Laptop tone={BLUE} /></g>
        <text x={600} y={330} textAnchor="middle" fontSize={18} fontWeight={700} fill={INK}>{STORY.name}</text>
        <text x={600} y={200} textAnchor="middle" fontSize={40} fontWeight={800} fill={INK}>?</text>
        <text x={600} y={365} textAnchor="middle" fontSize={17} fill={MUTED}>Who did the company authorize?</text>
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
      takeaway="Authenticated permission creates a scoped local DNS exception, not blanket trust in the network.">
      <Canvas viewBox="0 0 1240 440" label="The three steps of RFC 9704">
        <line x1={300} y1={300} x2={470} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        <line x1={700} y1={300} x2={840} y2={300} stroke="#cbd5e1" strokeWidth={2.5} strokeDasharray="6 6" />
        {col(200, 1, "The domain owner publishes", "one TXT record in its own zone")}
        {col(600, 2, "The network announces a claim", "DHCP option or PvD document")}
        {col(1010, 3, "The device checks before trusting", "SplitTrust does this part")}

        {/* 1: zone with lock and the TXT record */}
        <g transform="translate(200, 230)"><Cloud /></g>
        <text x={194} y={226} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>{STORY.parent} zone</text>
        <text x={194} y={246} textAnchor="middle" fontSize={12} fill={MUTED}>DNSSEC-signed</text>
        <g transform="translate(262, 190)"><Lock tone={GREEN} /></g>
        <g transform="translate(200, 350)"><Doc tone={BLUE} /></g>
        <text x={200} y={404} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={INK}>{STORY.officeResolver}._splitdns-challenge.{STORY.parent}</text>
        <text x={200} y={422} textAnchor="middle" fontSize={12} fontFamily="ui-monospace, Menlo, monospace" fill={BLUE}>TXT "token=&lt;hash(salt, subdomains)&gt;"</text>

        {/* 2: router announcing */}
        <g transform="translate(600, 330)"><Router tone={BLUE} /></g>
        <Bubble x={600} y={230} w={400} text={`${STORY.officeResolver} answers for ${STORY.scope}`} tone={BLUE} />
        <text x={600} y={404} textAnchor="middle" fontSize={13} fill={MUTED}>plus the salt</text>

        {/* 3: laptop with shield and three checks */}
        <g transform="translate(880, 340)"><Laptop tone={BLUE} /></g>
        <g transform="translate(924, 300)"><Shield /></g>
        {[
          ["TLS: certificate matches", "the resolver's name"],
          ["DNSSEC: record validates", "against the owner's signed zone"],
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
    <Slide section="Closing" title="Private DNS, with the owner's permission" takeaway="github.com/djzivkovic/splittrust">
      <div className="flex flex-1 flex-col justify-center gap-4">
        <p className="mb-2 text-2xl leading-relaxed text-slate-700">Keep company services reachable without granting every network authority over company names.</p>
        {row("Built", "a working verifier, an enforcing DNS proxy, and an owner-record builder", "text-blue-800")}
        {row("Shown", "authorized private access, rejected hotel claims, and refusal of bogus answers", "text-green-800")}
        <p className="text-base text-slate-600">Prototype: network profiles are configured. Next: one managed-device pilot; automatic discovery and native OS integration come later.</p>
        <div className="pt-3 text-center">
          <a href="/demo" className="inline-flex items-center gap-3 rounded-xl bg-blue-700 px-7 py-3 text-xl font-semibold text-white shadow-sm hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-700">
            Try it yourself <span aria-hidden="true">→</span>
          </a>
          <p className="mt-2 text-sm text-slate-500">Open the separate GitLab playground for real commands and the owner tool.</p>
        </div>
      </div>
    </Slide>
  );
}
