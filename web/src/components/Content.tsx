/* Content slides about the solution: why existing tools fall short, what SplitTrust brings, an
   interactive owner tool, why a company adopts it, and what comes next. */

import { useEffect, useState } from "react";
import { api, type LiveRecord } from "../lib/api";
import { BLUE, Doc, GREEN, INK, Laptop, Lock, Mark, RED, Resolver, Server, Shield } from "./Art";
import { Slide } from "./Slide";

/* ---------- Why existing tools do not solve it (interactive tabs) ---------- */

const CRITERIA = ["stops the hotel's hijack", "the office intranet still works", "uses the local resolver, no hairpin", "no new infrastructure or app changes"];

const OPTIONS: { name: string; short: string; marks: boolean[]; text: string; detail: string }[] = [
  { name: "Encrypted DNS", short: "DoT / DoH to the network's resolver", marks: [false, true, true, true],
    text: "The hotel hands out its resolver; the laptop encrypts its queries to it. The conversation is private, and it is with the attacker. At the office the same setup works fine, because the office resolver is honest.",
    detail: "Encryption protects the path, not the choice of resolver. RFC 9704 is what makes the choice checkable." },
  { name: "Always-on VPN", short: "tunnel everything to the office", marks: [true, true, false, false],
    text: "Works for the company's own names: DNS goes through the tunnel to the office resolver, so the hotel never sees those queries. The cost: the tunnel must be up before the first query, every packet hairpins through the office, and local names at partner sites, branches and home are invisible.",
    detail: "A VPN avoids the local resolver instead of making it safe. RFC 9704 is for the case where you do want to use the network you are on." },
  { name: "DNSSEC alone", short: "validate every answer", marks: [true, false, true, true],
    text: "A forged copy of a signed zone fails validation, so the hotel's attack is caught. But the office intranet fails too: internal names do not exist in the public zone, so a validating laptop gets a signed proof that they do not exist and rejects the office resolver's answer.",
    detail: "DNSSEC can say 'this is not the owner's answer'. It cannot say 'the owner allows this resolver to answer for these names'. That is the missing sentence." },
  { name: "RFC 9704 with SplitTrust", short: "the owner authorises, the device checks", marks: [true, true, true, true],
    text: "The owner publishes one signed TXT record under the resolver's name: a salted hash of the exact claim (resolver, zone, subdomains). The device recomputes the hash from the network's claim, validates the record with DNSSEC, checks the resolver's certificate, then routes only those names there. Everything else keeps its normal path.",
    detail: "One record in a zone you already run, DNSSEC you should already have (or a resolver the device already trusts), and a resolver on the device that checks. No application notices." },
];

export function WhyNotSlide() {
  const [i, setI] = useState(0);
  const o = OPTIONS[i];
  return (
    <Slide section="Today's options" title="Why the usual tools do not close this gap" sub="Click through the options."
      takeaway="Nothing today lets a device ask the domain owner: may this network's resolver answer for your names?">
      <div className="grid flex-1 gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt, k) => (
            <button key={opt.name} onClick={() => setI(k)}
              className={`rounded-xl border-2 px-4 py-3 text-left transition ${k === i ? "border-blue-600 bg-white shadow-sm" : "border-slate-200 bg-white/60 hover:border-slate-400"}`}>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{opt.name}</span>
                <span className="ml-auto flex gap-1">{opt.marks.map((m, j) => <span key={j} className={`h-2.5 w-2.5 rounded-full ${m ? "bg-green-500" : "bg-red-400"}`} />)}</span>
              </div>
              <div className="text-sm text-slate-500">{opt.short}</div>
            </button>
          ))}
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-2xl font-bold">{o.name}</div>
          <p className="mt-3 text-lg text-slate-800">{o.text}</p>
          <p className="mt-2 text-base text-slate-500">{o.detail}</p>
          <div className="mt-6 grid gap-2 sm:grid-cols-2">
            {CRITERIA.map((c, j) => (
              <div key={c} className={`flex items-center gap-3 rounded-lg px-3 py-2 ${o.marks[j] ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}>
                <svg viewBox="-14 -14 28 28" className="h-6 w-6 shrink-0"><Mark ok={o.marks[j]} size={12} /></svg>
                <span className="text-sm font-medium">{c}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- What SplitTrust brings ---------- */

const FEATURES: { icon: React.ReactNode; title: string; lines: string[] }[] = [
  { icon: <g transform="scale(1.1)"><Shield /></g>, title: "The RFC 9704 device side: verify, then enforce",
    lines: ["claim canonicalisation and token (s.5)", "resolver identity over DoT (RFC 9525)", "DNSSEC validation in-process (libunbound)", "ds key binding (s.7), scoped grants with expiry", "discovery simulated: PvD served, DHCP codec only"] },
  { icon: <g transform="translate(0,4) scale(0.9)"><Laptop tone={BLUE} /></g>, title: "Works for any client, today",
    lines: ["a plain DNS proxy: point a stub at it", "verdicts enforced per query, cached, re-verified", "Extended DNS Errors say why (EDE 6 Bogus, ...)", "no change to browsers or applications"] },
  { icon: <g transform="scale(1.3)"><Lock tone={RED} /></g>, title: "Fails safe and explains itself",
    lines: ["rejected claims never route a query", "SERVFAIL instead of a wrong address", "nine-stage trace with evidence per verdict", "grey (cannot decide) is never red or green"] },
  { icon: <g transform="scale(1.1)"><Doc tone={BLUE} /></g>, title: "The owner's side too",
    lines: ["build-record: claim in, TXT record out", "DHCP option 90/11 codec, PvD documents", "test vectors for the next implementer", "an erratum for the RFC's worked example"] },
  { icon: <g transform="scale(0.9)"><Resolver tone={GREEN} /></g>, title: "Tested live against the public DNS",
    lines: ["a real zone: zivkovic.me, DNSSEC at Cloudflare", "validated under the IANA root, live", "phone profile through the real dns.quad9.net", "the hotel's forgery fails exactly as the RFC says"] },
  { icon: <g transform="scale(0.9)"><Server /></g>, title: "A lab that attacks it",
    lines: ["13 scenarios, 3 device profiles, 20 expected verdicts", "forged records, replayed claims, stale salts,", "expired signatures, wrong keys, blocked Quad9", "46 generated checks plus 5 end-to-end tests, green"] },
];

export function SolutionSlide() {
  return (
    <Slide section="Our solution" title="SplitTrust: one Go binary that checks, enforces and explains" sub="Verifier, DNS proxy, owner tool, lab."
      takeaway="We found no public implementation of RFC 9704; its authors reported none known in February 2025. This one runs, fails safe, and shows its work.">
      <div className="grid flex-1 content-center gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <svg viewBox="-40 -40 80 80" className="h-12 w-12 shrink-0">{f.icon}</svg>
              <div className="text-lg font-bold leading-tight">{f.title}</div>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">{f.lines.map((l) => <li key={l} className="flex gap-2"><span className="text-blue-600">+</span><span>{l}</span></li>)}</ul>
          </div>
        ))}
      </div>
    </Slide>
  );
}

/* ---------- Try it: the owner tool, live ---------- */

export function TryItSlide() {
  const [resolver, setResolver] = useState("dns.splittrust.zivkovic.me");
  const [parent, setParent] = useState("zivkovic.me");
  const [subs, setSubs] = useState("internal.splittrust");
  const [salt, setSalt] = useState("ef3XgSkZTxuXMH18506K5Q");
  const [out, setOut] = useState<{ zone_line?: string; token?: string; record_owner?: string; error?: string; detail?: string } | null>(null);
  const [live, setLive] = useState<LiveRecord | null>(null);
  useEffect(() => { api.live("real-office").then(setLive).catch(() => undefined); }, []);
  useEffect(() => {
    const t = window.setTimeout(() => {
      api.build({ resolver, parent, subdomains: subs.split(",").map((s) => s.trim()).filter(Boolean), algorithm: "SHA384", salt, ds: [] })
        .then(setOut).catch((e) => setOut({ error: (e as Error).message }));
    }, 250);
    return () => window.clearTimeout(t);
  }, [resolver, parent, subs, salt]);
  const published = live?.txt.answer?.[0]?.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  const matches = !!out?.token && out.token === published;
  const field = (label: string, v: string, set: (s: string) => void) => (
    <label className="block text-sm">
      <span className="text-slate-500">{label}</span>
      <input className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm outline-none focus:border-blue-600" value={v} onChange={(e) => set(e.target.value)} spellCheck={false} />
    </label>
  );
  return (
    <Slide section="Try it" title="What SecureCompany's IT typed" sub="The owner tool, live. Change anything and watch the token change."
      takeaway="One record, computed from the exact claim. Change a letter of the claim and the record no longer fits.">
      <div className="grid flex-1 gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="space-y-3 rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <div className="text-lg font-bold">splittrust build-record</div>
          {field("resolver (the office DoT resolver, as announced)", resolver, setResolver)}
          {field("parent zone (must be DNSSEC-signed)", parent, setParent)}
          {field("subdomains it may answer for (comma-separated)", subs, setSubs)}
          {field("salt (random, also given to the network)", salt, setSalt)}
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">Publish this in the zone</div>
            {out?.error ? <div className="mt-2 text-red-700">{out.error}{out.detail ? `: ${out.detail}` : ""}</div>
              : <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-sm text-slate-800">{out?.zone_line ?? "..."}</pre>}
            <div className="mt-2 text-sm text-slate-500">token = SHA-384(len(salt), salt, canonical names), base64url. Anyone can read it; only the owner can sign it.</div>
          </div>
          <div className={`rounded-2xl border-2 p-5 shadow-sm ${matches ? "border-green-300 bg-green-50" : "border-slate-200 bg-white"}`}>
            <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">What the real zone says right now</div>
            <pre className="mt-2 whitespace-pre-wrap break-all font-mono text-sm text-slate-800">{live?.txt.answer?.[0] ?? "looking up the real zivkovic.me..."}</pre>
            <div className="mt-2 flex items-center gap-2 text-sm">
              {live && <span className={`rounded px-2 py-0.5 font-semibold ${live.txt.security === "secure" ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>DNSSEC {live.txt.security}</span>}
              {out?.token && live && <span className={`font-semibold ${matches ? "text-green-800" : "text-slate-500"}`}>{matches ? "identical to what you just built" : "differs from what you built (as it should, if you changed the claim)"}</span>}
            </div>
          </div>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- Why a company adopts it ---------- */

export function ImpactSlide() {
  const col = (title: string, tone: string, items: [string, string][]) => (
    <div className={`rounded-2xl border-2 bg-white p-5 shadow-sm ${tone}`}>
      <div className="text-xl font-bold">{title}</div>
      <ul className="mt-3 space-y-3">
        {items.map(([h, d]) => <li key={h}><div className="font-semibold text-slate-900">{h}</div><div className="text-sm text-slate-600">{d}</div></li>)}
      </ul>
    </div>
  );
  return (
    <Slide section="Why adopt it" title="What changes for a company like SecureCompany" sub="Security outcome, operational cost, user experience."
      takeaway="The attack that works on UnsecureCompany does not work on SecureCompany. SecureCompany changed its DNS and its devices' resolver, not a single application.">
      <div className="grid flex-1 content-center gap-5 lg:grid-cols-3">
        {col("Security", "border-green-200", [
          ["Hostile networks cannot impersonate internal services", "A forged record or a hijacked name fails DNSSEC validation; the resolver is never used for the company's names."],
          ["Fails safe, not open", "The laptop gets SERVFAIL with an Extended DNS Error, not a login page on the attacker's server."],
          ["A copied claim is worthless", "The resolver must present a certificate for the announced name over TLS before the first query."],
          ["Evidence for the SOC", "Every verdict carries its stages, codes and the raw responses."],
        ])}
        {col("Operations", "border-blue-200", [
          ["One TXT record", "Built with the owner tool from the exact claim; published once; rotate the salt to revoke."],
          ["DNSSEC on the zone (recommended)", "Cloudflare and most registrars offer it; without it, RFC 9704 s.6.1 lets devices verify through an external resolver they already trust."],
          ["DoT on the office resolver", "A certificate for its own name. The resolver software does not change."],
          ["No agents in applications", "The proxy is the device's DNS server; a product would use the OS split-DNS hooks."],
        ])}
        {col("People", "border-slate-200", [
          ["Nothing to learn", "Employees connect to Wi-Fi and open the intranet as before."],
          ["Phones too", "Private DNS users are covered through the external-resolver path (RFC 9704 s.6.1)."],
          ["Works on every network", "Office, home, partner sites: the check happens wherever a network makes a claim."],
          ["Clear failure", "'This site can't be reached' on a hostile network is the intended outcome, and it says why."],
        ])}
      </div>
    </Slide>
  );
}

/* ---------- Roadmap ---------- */

export function RoadmapSlide() {
  const steps: [string, string, string][] = [
    ["Now", "Verifier, proxy, owner tool, lab, vectors, erratum draft", "done"],
    ["Next", "Pilot on managed devices: the proxy as a local service, claims delivered by MDM or VPN config (no DNR or PvD needed); a CoreDNS plugin for the office side", "planned"],
    ["Then", "OS integration: systemd-resolved (DNR parsed since 257), Windows DNS client and NRPT, Apple NetworkExtension; DHCP option 90 and RA on the wire", "planned"],
    ["Standards", "Erratum drafted, to be filed; vectors and implementer notes to the ADD working group; one resolver vendor trying it", "ask"],
  ];
  return (
    <Slide section="What's next" title="From a working verifier to something your laptop ships with"
      takeaway="The protocol is published. What it lacked was running code, test vectors and a reproducible example. This repository has all three; the erratum is drafted.">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <svg viewBox="0 0 1200 120" className="h-28 w-full">
          <line x1={80} y1={60} x2={1120} y2={60} stroke="#cbd5e1" strokeWidth={4} />
          {steps.map((s, i) => {
            const x = 150 + i * 300;
            const done = s[2] === "done";
            return (
              <g key={s[0]} transform={`translate(${x}, 60)`}>
                <circle r={22} fill={done ? GREEN : s[2] === "ask" ? BLUE : "#fff"} stroke={done ? GREEN : s[2] === "ask" ? BLUE : INK} strokeWidth={3} />
                {done && <path d="M -9 0 L -3 7 L 10 -8" fill="none" stroke="#fff" strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" />}
                {!done && <text y={6} textAnchor="middle" fontSize={16} fontWeight={800} fill={s[2] === "ask" ? "#fff" : INK}>{i + 1}</text>}
                <text y={-36} textAnchor="middle" fontSize={16} fontWeight={700} fill={INK}>{s[0]}</text>
              </g>
            );
          })}
        </svg>
        <div className="grid gap-4 md:grid-cols-4">
          {steps.map((s) => (
            <div key={s[0]} className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm">
              <div className={`text-xs font-semibold uppercase tracking-wide ${s[2] === "done" ? "text-green-700" : s[2] === "ask" ? "text-blue-700" : "text-slate-500"}`}>{s[2]}</div>
              <div className="mt-1 text-base text-slate-800">{s[1]}</div>
            </div>
          ))}
        </div>
        <div className="grid gap-4 md:grid-cols-3 text-sm text-slate-600">
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> protection applies to clients that use the proxy or the CLI; nothing intercepts the host's DNS yet.</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> unsigned zones can only be verified through an external resolver the device already trusts (s.6.1).</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> discovery is pre-configured per network; the DHCP option is encoded and decoded, not yet sent.</div>
        </div>
      </div>
    </Slide>
  );
}

