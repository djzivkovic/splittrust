/* What we built: the architecture as icons with short labels. */

import { BLUE, Cloud, Doc, GREEN, INK, Laptop, Lock, Mark, MUTED, Resolver, Router, Server, Shield } from "./Art";
import { Canvas, Slide } from "./Slide";

/* A tile: icon on top, one or two short lines below. */
const tile = (x: number, y: number, icon: React.ReactNode, l1: string, l2?: string, tone = INK) => (
  <g transform={`translate(${x}, ${y})`}>
    <rect x={-78} y={-54} width={156} height={118} rx={14} fill="#fff" stroke="#e2e8f0" strokeWidth={2} />
    <g transform="translate(0,-14) scale(0.85)">{icon}</g>
    <text y={34} textAnchor="middle" fontSize={13} fontWeight={700} fill={tone}>{l1}</text>
    {l2 && <text y={52} textAnchor="middle" fontSize={11} fill={MUTED}>{l2}</text>}
  </g>
);

export function BuiltSlide() {
  return (
    <Slide section="Architecture" title="Architecture and test environment"
      takeaway="The proxy makes the trust decision. Ordinary applications keep using DNS.">
      <Canvas viewBox="0 0 1200 620" label="Architecture">
        {/* the binary */}
        <rect x={20} y={20} width={580} height={400} rx={20} fill="#eff6ff" stroke={BLUE} strokeWidth={2.5} />
        <text x={44} y={54} fontSize={18} fontWeight={800} fill={BLUE}>splittrust</text>
        <text x={150} y={54} fontSize={13} fill={MUTED}>one Go binary, libunbound in-process</text>
        {tile(120, 140, <Doc tone={BLUE} />, "Claim and token", "RFC 9704 §5", BLUE)}
        {tile(310, 140, <Router tone={BLUE} />, "Configured input", "PvD fetch + DHCP codec", BLUE)}
        {tile(500, 140, <Lock tone={BLUE} />, "Resolver identity", "DoT, RFC 9525", BLUE)}
        {tile(120, 280, <Shield tone={GREEN} />, "DNSSEC validation", "Secure, Bogus, Insecure", BLUE)}
        {tile(310, 280, <Doc tone={BLUE} />, "Record and ds", "TXT token, §7 key", BLUE)}
        {tile(500, 280, <Mark ok size={22} />, "Grants", "scoped, bounded expiry", BLUE)}
        {/* outputs */}
        <line x1={60} y1={352} x2={560} y2={352} stroke="#bfdbfe" strokeWidth={2} />
        {[["CLI", "verify, resolve, build-record", 120], ["HTTP API", "playground and tools", 310], ["DNS proxy", "Do53 + EDE, any client", 500]].map(([t, s, x]) => (
          <g key={t as string} transform={`translate(${x as number}, 352)`}>
            <line x1={0} y1={0} x2={0} y2={14} stroke="#bfdbfe" strokeWidth={2} />
            <rect x={-80} y={14} width={160} height={44} rx={10} fill={t === "DNS proxy" ? "#f0fdf4" : "#fff"} stroke={t === "DNS proxy" ? GREEN : INK} strokeWidth={2} />
            <text y={32} textAnchor="middle" fontSize={13} fontWeight={700} fill={INK}>{t}</text>
            <text y={48} textAnchor="middle" fontSize={10} fill={MUTED}>{s}</text>
          </g>
        ))}

        {/* the lab */}
        <rect x={630} y={20} width={550} height={400} rx={20} fill="#fafaf9" stroke={INK} strokeWidth={2.5} />
        <text x={654} y={54} fontSize={18} fontWeight={800} fill={INK}>the lab</text>
        <text x={730} y={54} fontSize={13} fill={MUTED}>Docker Compose, the two networks and their attackers</text>
        {tile(722, 140, <Server />, "BIND", "private root, 7 zones")}
        {tile(905, 140, <Resolver tone={BLUE} />, "Office resolver", "CoreDNS, DoT, split zones")}
        {tile(1088, 140, <Resolver hostile />, "Hotel resolver", "honest, forging, plain")}
        {tile(722, 280, <Router />, "quad9.lab", "unbound, validating")}
        {tile(905, 280, <Server />, "PvD and pages", "nginx, 5 servers")}
        {tile(1088, 280, <Laptop />, "Plain clients", "no SplitTrust code")}
        <text x={905} y={395} textAnchor="middle" fontSize={13} fill={MUTED}>15 scenarios, including the GitLab story; 3 device profiles</text>

        {/* the real world */}
        <line x1={310} y1={420} x2={540} y2={515} stroke="#cbd5e1" strokeWidth={2} strokeDasharray="6 6" />
        <line x1={905} y1={420} x2={660} y2={515} stroke="#cbd5e1" strokeWidth={2} strokeDasharray="6 6" />
        <g transform="translate(600, 535)">
          <Cloud />
          <text x={-6} y={-4} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>zivkovic.me</text>
          <text x={-6} y={16} textAnchor="middle" fontSize={12} fill={MUTED}>Public-DNS test zone</text>
          <g transform="translate(84,-42) scale(0.9)"><Lock tone={GREEN} /></g>
        </g>
      </Canvas>
    </Slide>
  );
}

export function DeliverySlide() {
  const parts = [
    { title: "Verifier", icon: <Shield tone={BLUE} />, text: "Authenticate the owner's permission and the resolver's identity. Bind a local DNSSEC key when one is delegated.", detail: "RFC 9704 checks / libunbound" },
    { title: "Enforcing DNS proxy", icon: <Laptop tone={BLUE} />, text: "Put the decision on the DNS path used by ordinary applications. Scope local answers and refuse DNSSEC-bogus data.", detail: "Ordinary DNS clients / no app changes" },
    { title: "Owner-record builder", icon: <Doc tone={BLUE} />, text: "Turn the intended claim into a Verification Record and inspect its canonical names, token and publishing location.", detail: "Claim in / TXT record out" },
  ];
  return (
    <Slide section="What we built" title="From RFC to a working DNS path"
      takeaway="Not just a protocol illustration: working code, an enforcing resolver, and reproducible test material.">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="grid gap-5 md:grid-cols-3">
          {parts.map((part) => <div key={part.title} className="rounded-2xl border-2 border-blue-200 bg-white p-6 shadow-sm">
            <svg viewBox="-65 -50 130 100" className="h-24 w-32">{part.icon}</svg>
            <h3 className="mt-3 text-2xl font-bold">{part.title}</h3>
            <p className="mt-3 text-lg leading-relaxed text-slate-700">{part.text}</p>
            <p className="mt-4 text-sm font-semibold text-blue-800">{part.detail}</p>
          </div>)}
        </div>
        <div className="rounded-xl bg-white p-4 text-center text-base text-slate-600">
          One Go binary, CLI and HTTP interfaces, plus the isolated Docker lab. Network profiles are configured in this prototype.
        </div>
      </div>
    </Slide>
  );
}

export function EvidenceSlide() {
  const checks = [
    ["Authorized office", "Private GitLab resolves under the delegated key and its page is reachable."],
    ["Unauthorized hotel", "The claim has no authorization record; the forged GitLab answer is refused."],
    ["Wrong delegated key", "DS_MISMATCH rejects the claim rather than downgrading to token-only trust."],
  ];
  return (
    <Slide section="Evidence" title="What we built and demonstrated" sub="Reproducible checks, not live telemetry."
      takeaway="The implementation is inspectable: command output, explicit reasons, test vectors and documented limits.">
      <div className="flex flex-1 flex-col justify-center gap-5">
        <div className="grid gap-4 md:grid-cols-3">
          {checks.map(([title, text]) => <div key={title} className="rounded-2xl border-2 border-green-200 bg-green-50 p-5">
            <h3 className="text-xl font-bold text-green-900">{title}</h3>
            <p className="mt-3 text-base leading-relaxed text-green-950">{text}</p>
          </div>)}
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-bold">Two trust contexts</h3>
            <p className="mt-2 text-base text-slate-600">Private DNSSEC lab for controlled cases; our own signed zivkovic.me zone for public-DNS validation.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-bold">Reusable test material</h3>
            <p className="mt-2 text-base text-slate-600">15 scenario profiles, 3 device profiles, and reproducible token, TXT, DHCP and PvD vectors.</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-5">
            <h3 className="text-lg font-bold">RFC example analysis</h3>
            <p className="mt-2 text-base text-slate-600">A documented worked-example discrepancy with a reproducer. This is not a claim of an accepted erratum.</p>
          </div>
        </div>
      </div>
    </Slide>
  );
}
