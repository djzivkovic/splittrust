/* What we built: the architecture drawing. */

import { BLUE, Cloud, GREEN, INK, Laptop, Lock, MUTED, Resolver, Router, Server, Shield } from "./Art";
import { Canvas, Slide } from "./Slide";

const LINE2 = "#93c5fd";

const box = (x: number, y: number, w: number, h: number, title: string, lines: string[], tone = INK, fill = "#fff") => (
  <g transform={`translate(${x}, ${y})`}>
    <rect width={w} height={h} rx={10} fill={fill} stroke={tone} strokeWidth={2.5} />
    <text x={12} y={22} fontSize={14} fontWeight={700} fill={tone}>{title}</text>
    {lines.map((l, i) => <text key={i} x={12} y={42 + i * 16} fontSize={12} fill={MUTED} fontFamily="ui-monospace, Menlo, monospace">{l}</text>)}
  </g>
);

export function BuiltSlide() {
  return (
    <Slide section="What we built" title="An RFC 9704 verifier, a DNS front door, and a lab to attack it"
      takeaway="Every verdict in this deck came out of that binary, against that lab and that zone, while you watched.">
      <Canvas viewBox="0 0 1200 520" label="Architecture">
          {/* the binary */}
          <rect x={30} y={30} width={560} height={460} rx={18} fill="#eff6ff" stroke={BLUE} strokeWidth={2.5} />
          <line x1={310} y1={360} x2={310} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={130} y1={360} x2={130} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={490} y1={360} x2={490} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={50} y1={360} x2={570} y2={360} stroke={LINE2} strokeWidth={2} />
          <text x={50} y={60} fontSize={18} fontWeight={800} fill={BLUE}>splittrust</text>
          <text x={150} y={60} fontSize={13} fill={MUTED}>one Go binary, about 5,400 lines, libunbound in-process</text>
          {box(50, 80, 250, 80, "claim and token (RFC 9704 s.5)", ["canonical order, $X, SHA-384/512", "IDNA, Special-Use names, '*'"], BLUE)}
          {box(320, 80, 250, 80, "discovery", ["PvD (RFC 8801) over HTTPS", "DHCP option 90/11 codec, DNR"], BLUE)}
          {box(50, 176, 250, 80, "resolver identity", ["DNS over TLS, RFC 9525 matching", "certificate kept as evidence"], BLUE)}
          {box(320, 176, 250, 80, "DNSSEC validation", ["libunbound: Secure/Bogus/Insecure", "via the network's resolver (Fig. 4)"], BLUE)}
          {box(50, 272, 250, 80, "record and ds (s.7)", ["token per RR, DS over resolver.arpa.", "no downgrade on DS mismatch"], BLUE)}
          {box(320, 272, 250, 80, "grants", ["scope, TTL/RRSIG/PvD expiry", "external path (s.6.1) for phones"], BLUE)}
          {box(50, 380, 160, 90, "CLI", ["verify, resolve, inspect", "build-record, vectors"], INK)}
          {box(230, 380, 160, 90, "HTTP API", ["/api/verify, /api/browse", "this deck"], INK)}
          {box(410, 380, 160, 90, "DNS proxy", ["Do53 front door for any stub", "verdict cache, EDE codes"], GREEN, "#f0fdf4")}

          {/* the lab */}
          <rect x={620} y={30} width={550} height={300} rx={18} fill="#fafaf9" stroke={INK} strokeWidth={2.5} />
          <text x={640} y={60} fontSize={18} fontWeight={800} fill={INK}>the lab</text>
          <text x={716} y={60} fontSize={13} fill={MUTED}>Docker Compose: 8 containers run the demo, 5 are the test bed, plus bootstrap</text>
          <g transform="translate(700, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>BIND: private root</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>lab TLD, 7 zones (1 unsigned)</text></g>
          <g transform="translate(830, 130)"><Resolver tone={BLUE} /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: office</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>DoT, split zones</text></g>
          <g transform="translate(960, 130)"><Resolver hostile /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: hotel</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>honest, forging, plain</text></g>
          <g transform="translate(1085, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>nginx: PvD</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>and 4 web servers</text></g>
          <g transform="translate(700, 262)"><Router /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>unbound: quad9.lab</text></g>
          <g transform="translate(850, 258)"><Laptop /><text y={58} textAnchor="middle" fontSize={12} fill={INK}>plain clients</text></g>
          <g transform="translate(1000, 262)"><Shield /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>integration suite</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>46 + 5 checks in the lab</text></g>
          <g transform="translate(1100, 262)"><Lock tone={GREEN} /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>bootstrap</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>keys, zones, certs</text></g>

          {/* the real world */}
          <g transform="translate(740, 420)"><Cloud /></g>
          <text x={734} y={416} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>zivkovic.me</text>
          <text x={734} y={434} textAnchor="middle" fontSize={11} fill={MUTED}>DNSSEC at Cloudflare, DS at .me</text>
          <text x={734} y={450} textAnchor="middle" fontSize={11} fill={MUTED}>record published, verified live</text>
          {box(900, 370, 270, 110, "published", ["5 vector files, 20 test vectors", "draft erratum for RFC 9704 s.5.1", "8 implementer decisions", "docs: architecture, demo, lab"], INK)}
      </Canvas>
    </Slide>
  );
}

