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
    <Slide section="What we built" title="One Go binary, a lab that attacks it, a real zone"
      takeaway="Every verdict in this deck came out of that binary, against that lab and that zone, while you watched.">
      <Canvas viewBox="0 0 1200 540" label="Architecture">
        {/* the binary */}
        <rect x={20} y={20} width={580} height={400} rx={20} fill="#eff6ff" stroke={BLUE} strokeWidth={2.5} />
        <text x={44} y={54} fontSize={18} fontWeight={800} fill={BLUE}>splittrust</text>
        <text x={150} y={54} fontSize={13} fill={MUTED}>one Go binary, about 5,400 lines, libunbound in-process</text>
        {tile(120, 140, <Doc tone={BLUE} />, "Claim and token", "RFC 9704 s.5", BLUE)}
        {tile(310, 140, <Router tone={BLUE} />, "Discovery", "PvD, DHCP 90/11, DNR", BLUE)}
        {tile(500, 140, <Lock tone={BLUE} />, "Resolver identity", "DoT, RFC 9525", BLUE)}
        {tile(120, 280, <Shield tone={GREEN} />, "DNSSEC validation", "Secure, Bogus, Insecure", BLUE)}
        {tile(310, 280, <Doc tone={BLUE} />, "Record and ds", "token per RR, s.7 key", BLUE)}
        {tile(500, 280, <Mark ok size={22} />, "Grants", "scoped, bounded expiry", BLUE)}
        {/* outputs */}
        <line x1={60} y1={352} x2={560} y2={352} stroke="#bfdbfe" strokeWidth={2} />
        {[["CLI", "verify, resolve, build-record", 120], ["HTTP API", "this deck", 310], ["DNS proxy", "Do53 + EDE, any client", 500]].map(([t, s, x]) => (
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
        <text x={730} y={54} fontSize={13} fill={MUTED}>Docker Compose: 8 containers for the demo, 5 as test bed</text>
        {tile(722, 140, <Server />, "BIND", "private root, 7 zones")}
        {tile(905, 140, <Resolver tone={BLUE} />, "Office resolver", "CoreDNS, DoT, split zones")}
        {tile(1088, 140, <Resolver hostile />, "Hotel resolver", "honest, forging, plain")}
        {tile(722, 280, <Router />, "quad9.lab", "unbound, validating")}
        {tile(905, 280, <Server />, "PvD and pages", "nginx, 5 servers")}
        {tile(1088, 280, <Laptop />, "Plain clients", "no SplitTrust code")}
        <text x={905} y={395} textAnchor="middle" fontSize={13} fill={INK}>13 scenarios, 3 device profiles, 46 generated checks and 5 end-to-end tests</text>

        {/* the real world */}
        <g transform="translate(180, 480)"><Cloud /></g>
        <text x={174} y={478} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>zivkovic.me</text>
        <text x={174} y={496} textAnchor="middle" fontSize={11} fill={MUTED}>real zone, DNSSEC, record live</text>
        <g transform="translate(238, 452)"><Lock tone={GREEN} /></g>
        {[["20 test vectors", 480], ["draft erratum, RFC 9704 s.5.1", 700], ["8 implementer decisions", 920], ["architecture, demo, lab docs", 1110]].map(([t, x]) => (
          <g key={t as string} transform={`translate(${x as number}, 480)`}>
            <rect x={-105} y={-18} width={210} height={36} rx={18} fill="#fff" stroke="#e2e8f0" strokeWidth={2} />
            <text y={5} textAnchor="middle" fontSize={12} fontWeight={600} fill={INK}>{t}</text>
          </g>
        ))}
        <text x={360} y={485} textAnchor="middle" fontSize={11} fontWeight={700} fill={MUTED}>published:</text>
      </Canvas>
    </Slide>
  );
}
