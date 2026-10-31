/* Slides 5 and 6: what we built (architecture drawing) and what we found in the RFC (the broken
   example, recomputed live by our engine). */

import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { BLUE, Cloud, GREEN, INK, Laptop, Lock, MUTED, RED, Resolver, Router, Server, Shield } from "./Art";
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

          {/* the lab */}
          <rect x={620} y={30} width={550} height={300} rx={18} fill="#fafaf9" stroke={INK} strokeWidth={2.5} />
          <text x={640} y={60} fontSize={18} fontWeight={800} fill={INK}>the lab</text>
          <text x={716} y={60} fontSize={13} fill={MUTED}>Docker Compose: 9 containers run the demo, 5 more are the test bed</text>
          <g transform="translate(700, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>BIND: private root</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>lab TLD, 7 signed zones</text></g>
          <g transform="translate(830, 130)"><Resolver tone={BLUE} /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: office</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>DoT, split zones</text></g>
          <g transform="translate(960, 130)"><Resolver hostile /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>CoreDNS: hotel</text><text y={72} textAnchor="middle" fontSize={11} fill={MUTED}>honest, forging, plain</text></g>
          <g transform="translate(1085, 130)"><Server /><text y={66} textAnchor="middle" fontSize={12} fill={INK}>nginx: PvD</text><text y={82} textAnchor="middle" fontSize={11} fill={MUTED}>and 4 web servers</text></g>
          <g transform="translate(700, 262)"><Router /><text y={56} textAnchor="middle" fontSize={12} fill={INK}>unbound: quad9.lab</text></g>
          <g transform="translate(850, 258)"><Laptop /><text y={58} textAnchor="middle" fontSize={12} fill={INK}>plain clients</text></g>
          <g transform="translate(1000, 262)"><Shield /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>integration suite</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>46 checks in the lab</text></g>
          <g transform="translate(1100, 262)"><Lock tone={GREEN} /><text y={50} textAnchor="middle" fontSize={12} fill={INK}>bootstrap</text><text y={66} textAnchor="middle" fontSize={11} fill={MUTED}>keys, zones, certs</text></g>

          {/* the real world */}
          <g transform="translate(740, 420)"><Cloud /></g>
          <text x={734} y={416} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>zivkovic.me</text>
          <text x={734} y={434} textAnchor="middle" fontSize={11} fill={MUTED}>DNSSEC at Cloudflare, DS at .me</text>
          <text x={734} y={450} textAnchor="middle" fontSize={11} fill={MUTED}>record published, verified live</text>
          {box(900, 370, 270, 110, "published", ["5 vector files, 20 test vectors", "erratum report for RFC 9704 s.5.1", "8 implementer decisions", "docs: architecture, demo, lab"], INK)}
      </Canvas>
    </Slide>
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
    <Slide section="What we found" title="The RFC's worked example does not add up" sub="and we can show exactly why"
      takeaway="A worked example is the one thing an implementer can test against. This one would have told a correct implementation it was wrong.">
      <div className="grid flex-1 gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-base text-slate-700">RFC 9704 shows one complete example: a claim, a salt, and the token the owner should publish. The names are <code>parent.example</code> on purpose, so nobody can use the example in production. The token printed next to it should still be the result of the procedure in the RFC. It is not.</p>
          <Row label="1. The token printed in the RFC" value={PRINTED} note="63 characters, which is 47 bytes. SHA-384 always produces 48 bytes. So this cannot be the output of the procedure for any input." tone={RED} />
          <Row label="2. Our engine, following the RFC literally, with the printed salt" value={printedSalt} note="64 characters, 48 bytes. A valid token, but a different one." tone={INK} />
          <Row label='3. Our engine with the salt from an earlier draft ("bytes" instead of "octets")' value={draftSalt} highlight={common} note={`the first ${common} characters are identical to the printed token`} tone={GREEN} />
          <p className="mt-4 text-base text-slate-700">The digest in row 3 contains one zero byte, at position 30. Remove it and re-encode: the result is the printed token, character for character. So the example was computed for the earlier salt by a program that stopped at the zero byte (a C-string bug), and when the salt text was later changed from "bytes" to "octets", the token was not recomputed. Two independent implementations, our Go engine and a stand-alone Python script, agree on every byte.</p>
        </div>
        <div className="flex flex-col gap-5">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-bold">What we did with it</div>
            <ul className="mt-2 space-y-1.5 text-base text-slate-700">
              <li>Wrote the erratum with both consistent fixes (new token, or old salt) and every intermediate value.</li>
              <li>Published 20 test vectors, including the example under both salts, so the next implementer has something that adds up.</li>
              <li>Per the hackathon rules it goes to the organisers first, then to the RFC Editor.</li>
            </ul>
          </div>
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-lg font-bold">Eight more things the RFC leaves open</div>
            <p className="mt-1 text-sm text-slate-500">each decided, documented, and covered by a vector and a lab scenario</p>
            <ul className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-slate-700">
              <li>how '*' is encoded in the hash</li>
              <li>record syntax (token and ds in one RR)</li>
              <li>one claim per DHCP message</li>
              <li>the replay-detection counter</li>
              <li>the owner name for the ds digest</li>
              <li>IDNA: U-labels become A-labels</li>
              <li>canonical order is re-sorted by the device</li>
              <li>unsigned zones and the external resolver</li>
            </ul>
          </div>
        </div>
      </div>
    </Slide>
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
