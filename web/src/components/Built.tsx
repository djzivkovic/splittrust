/* Slides 5 and 6: what we built (architecture drawing) and what we found in the RFC (the broken
   example, recomputed live by our engine). */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BLUE, Cloud, GREEN, INK, Laptop, Lock, MUTED, RED, Resolver, Router, Server, Shield } from "./Art";

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
    <div className="mx-auto flex h-full max-w-7xl flex-col px-6 pt-4 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">What we built</span>
        <h2 className="text-2xl font-bold tracking-tight lg:text-3xl">An RFC 9704 verifier, a DNS front door, and a lab to attack it</h2>
      </div>
      <div className="mt-1 flex min-h-0 flex-1 items-center justify-center">
        <svg viewBox="0 0 1200 520" className="h-full w-full select-none" role="img" aria-label="Architecture">
          {/* the binary */}
          <rect x={30} y={30} width={560} height={460} rx={18} fill="#eff6ff" stroke={BLUE} strokeWidth={2.5} />
          <text x={50} y={60} fontSize={18} fontWeight={800} fill={BLUE}>splittrust</text>
          <text x={150} y={60} fontSize={13} fill={MUTED}>one Go binary, 5,200 lines, libunbound in-process</text>
          {box(50, 80, 250, 80, "claim and token (RFC 9704 s.5)", ["canonical order, $X, SHA-384/512", "IDNA, Special-Use names, '*'"], BLUE)}
          {box(320, 80, 250, 80, "discovery", ["PvD (RFC 8801) over HTTPS", "DHCP option 90/11 codec, DNR"], BLUE)}
          {box(50, 176, 250, 80, "resolver identity", ["DNS over TLS, RFC 9525 matching", "certificate kept as evidence"], BLUE)}
          {box(320, 176, 250, 80, "DNSSEC validation", ["libunbound: Secure/Bogus/Insecure", "via the network's resolver (Fig. 4)"], BLUE)}
          {box(50, 272, 250, 80, "record and ds (s.7)", ["token per RR, DS over resolver.arpa.", "no downgrade on DS mismatch"], BLUE)}
          {box(320, 272, 250, 80, "grants", ["scope, TTL/RRSIG/PvD expiry", "external path (s.6.1) for phones"], BLUE)}
          {box(50, 380, 160, 90, "CLI", ["verify, resolve, inspect", "build-record, vectors"], INK)}
          {box(230, 380, 160, 90, "HTTP API", ["/api/verify, /api/browse", "this deck"], INK)}
          {box(410, 380, 160, 90, "DNS proxy", ["Do53 front door for any stub", "verdict cache, EDE codes"], GREEN, "#f0fdf4")}
          <line x1={310} y1={360} x2={310} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={130} y1={360} x2={130} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={490} y1={360} x2={490} y2={380} stroke={LINE2} strokeWidth={2} />
          <line x1={50} y1={360} x2={570} y2={360} stroke={LINE2} strokeWidth={2} />

          {/* the lab */}
          <rect x={620} y={30} width={550} height={300} rx={18} fill="#fafaf9" stroke={INK} strokeWidth={2.5} />
          <text x={640} y={60} fontSize={18} fontWeight={800} fill={INK}>the lab</text>
          <text x={720} y={60} fontSize={13} fill={MUTED}>Docker Compose, 14 containers, 13 scenarios x 3 device profiles</text>
          <g transform="translate(690, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>BIND: private root</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>lab TLD + 7 signed zones</text></g>
          <g transform="translate(830, 130)"><Resolver tone={BLUE} /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: office</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>DoT, split zones</text></g>
          <g transform="translate(960, 130)"><Resolver hostile /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: hotel</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>honest, forging, plain</text></g>
          <g transform="translate(1090, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>nginx: PvD</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>+ 4 web servers</text></g>
          <g transform="translate(700, 262)"><Router /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>unbound: quad9.lab</text></g>
          <g transform="translate(850, 258)"><Laptop /><text y={58} textAnchor="middle" fontSize={12} fill={INK}>plain clients</text></g>
          <g transform="translate(1000, 262)"><Shield /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>integration suite</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>46 checks in the lab</text></g>
          <g transform="translate(1110, 262)"><Lock tone={GREEN} /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>bootstrap</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>keys, zones, certs</text></g>

          {/* the real world */}
          <g transform="translate(740, 420)"><Cloud /></g>
          <text x={734} y={416} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>zivkovic.me</text>
          <text x={734} y={434} textAnchor="middle" fontSize={11} fill={MUTED}>DNSSEC at Cloudflare, DS at .me</text>
          <text x={734} y={450} textAnchor="middle" fontSize={11} fill={MUTED}>record published, verified live</text>
          {box(900, 370, 270, 110, "published", ["5 vector files, 20 test vectors", "erratum report for RFC 9704 s.5.1", "8 implementer decisions", "docs: architecture, demo, lab"], INK)}
        </svg>
      </div>
      <p className="pb-3 text-center text-lg font-medium text-slate-800 lg:text-xl">Every verdict in this deck came out of that binary, against that lab and that zone, while you watched.</p>
    </div>
  );
}

/* The RFC's worked example, recomputed by our engine on the fly. */
const RFC = { resolver: "resolver17.parent.example", parent: "parent.example", subdomains: ["payroll.parent.example", "secret.project.parent.example"], algorithm: "SHA384" };
const SALT_PRINTED = "ZXhhbXBsZSBzYWx0IG9jdGV0cyAoc2hvdWxkIGJlIHJhbmRvbSk"; // "example salt octets (should be random)"
const SALT_DRAFT07 = "ZXhhbXBsZSBzYWx0IGJ5dGVzIChzaG91bGQgYmUgcmFuZG9tKQ"; // "example salt bytes (should be random)"
const PRINTED = "z1qyK7QWwQPkT-ZmVW-tAQbsNyYenTNBPp5ogYB8S1wesVCR-KJDv2eFwfJcWQM";

export function FoundSlide() {
  const [printedSalt, setPrintedSalt] = useState<string | null>(null);
  const [draftSalt, setDraftSalt] = useState<string | null>(null);
  useEffect(() => {
    api.inspect({ ...RFC, salt: SALT_PRINTED }).then((r) => setPrintedSalt(r.token)).catch(() => setPrintedSalt("?"));
    api.inspect({ ...RFC, salt: SALT_DRAFT07 }).then((r) => setDraftSalt(r.token)).catch(() => setDraftSalt("?"));
  }, []);
  const common = draftSalt ? commonPrefix(draftSalt, PRINTED) : 0;
  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col px-6 pt-4 lg:px-8">
      <div className="flex flex-wrap items-baseline gap-x-4">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">What we found</span>
        <h2 className="text-2xl font-bold tracking-tight lg:text-3xl">The RFC's only worked example cannot be reproduced</h2>
      </div>
      <div className="mt-5 grid flex-1 gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-sm text-slate-500">RFC 9704 section 5.1, salt <code>"example salt octets (should be random)"</code>, SHA-384</div>
          <Row label="printed in the RFC" value={PRINTED} note={`${PRINTED.length} chars = 47 octets. SHA-384 produces 48.`} tone={RED} />
          <Row label="our engine, printed salt" value={printedSalt} note="64 chars, 48 octets. Does not match." tone={INK} />
          <Row label='our engine, draft-07 salt ("bytes")' value={draftSalt} highlight={common} note={`first ${common} characters match the printed token`} tone={GREEN} />
          <p className="mt-4 text-base text-slate-700">The digest for the draft-07 salt contains a single <code>0x00</code> octet at offset 30. Drop it, re-encode, and the result is exactly the printed token: the example was produced by code that treated the digest as a C string, and the salt was reworded afterwards without recomputing. Two independent implementations (Go here, Python in the repo) agree to the bit.</p>
          <p className="mt-2 text-sm text-slate-500">Draft erratum in <code>docs/rfc9704-example-erratum.md</code>, going to the organisers first, then the RFC Editor.</p>
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-lg font-bold">Eight decisions the RFC leaves to implementers</div>
          <ul className="mt-3 space-y-1.5 text-sm text-slate-700">
            <li><b>'*' in $X</b>: encoded as the label <code>\x01*\x00</code>, not expanded.</li>
            <li><b>Record syntax</b>: <code>token=...</code> and <code>ds=...</code> only ever from the same RR.</li>
            <li><b>DHCP</b>: one claim per message (RFC 8415 s.20.2, RFC 3396 concatenation).</li>
            <li><b>RDM field</b>: a strictly increasing counter, as RFC 3118 requires for RDM 0.</li>
            <li><b>ds owner name</b>: the DS digest is computed over <code>resolver.arpa.</code></li>
            <li><b>IDNA</b>: U-labels in PvD are converted to A-labels before hashing.</li>
            <li><b>Canonical order</b>: the device re-sorts; a network's order never changes the token.</li>
            <li><b>Insecure zones</b>: the external path is a property of the device, not of the run.</li>
          </ul>
          <p className="mt-3 text-sm text-slate-500">Each one is a test vector in <code>vectors/</code> and a scenario in the lab.</p>
        </div>
      </div>
      <p className="py-3 text-center text-lg font-medium text-slate-800 lg:text-xl">Ask: file the erratum, publish the vectors to the ADD working group, get one resolver vendor to try it.</p>
    </div>
  );
}

function commonPrefix(a: string, b: string): number {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}

function Row({ label, value, note, tone, highlight = 0 }: { label: string; value: string | null; note: string; tone: string; highlight?: number }) {
  return (
    <div className="mt-3">
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 break-all font-mono text-[15px] leading-snug" style={{ color: tone }}>
        {value === null ? <span className="animate-pulse text-slate-400">computing...</span> : highlight > 0 ? <><span className="rounded bg-green-100 px-0.5">{value.slice(0, highlight)}</span><span className="text-slate-500">{value.slice(highlight)}</span></> : value}
      </div>
      <div className="mt-0.5 text-xs text-slate-500">{note}</div>
    </div>
  );
}
