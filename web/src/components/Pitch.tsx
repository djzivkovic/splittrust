/* Pitch slides grounded in sourced research: why now (the building blocks and their dates), and
   who buys and who ships. Sources are kept with each fact so a judge can check them. */

import { useState } from "react";
import { BLUE, GREEN, INK, MUTED } from "./Art";
import { Slide } from "./Slide";

/* ---------- Why now: the building blocks exist, the check did not ---------- */

const MILESTONES: { year: string; what: string; detail: string; source: string; kind: "block" | "rfc" | "gap" }[] = [
  { year: "2016", what: "DoT standardised", detail: "RFC 7858. Encrypted transport to a resolver, with a certificate to check.", source: "rfc-editor.org/rfc/rfc7858", kind: "block" },
  { year: "2018", what: "Android Private DNS", detail: "Android 9 ships system-wide DoT: off, automatic, or a named provider.", source: "support.google.com/android/answer/9654714", kind: "block" },
  { year: "2020", what: "Apple encrypted DNS", detail: "iOS 14 and macOS 11: DoH/DoT via profiles and NetworkExtension, per-domain match rules.", source: "developer.apple.com, WWDC 2020 session 10047", kind: "block" },
  { year: "2022", what: "DDR default at Apple", detail: "iOS 16 and macOS Ventura discover a resolver's encrypted endpoint via _dns.resolver.arpa.", source: "developer.apple.com, WWDC 2022 session 10079", kind: "block" },
  { year: "2023", what: "DDR and DNR RFCs", detail: "RFC 9462 (designated resolvers) and RFC 9463 (DHCP/RA options for encrypted resolvers). Windows 11 ships DoH; DNR in Insider builds.", source: "rfc-editor.org/rfc/rfc9463", kind: "block" },
  { year: "2024", what: "systemd 257: DNR", detail: "DHCPv4, DHCPv6 and RA options accepted by systemd-networkd; DoT still needs DNSOverTLS=.", source: "github.com/systemd/systemd/pull/30952", kind: "block" },
  { year: "Jan 2025", what: "RFC 9704 published", detail: "Proposed Standard from the ADD working group: the owner publishes a token, the device checks before trusting a local resolver.", source: "rfc-editor.org/rfc/rfc9704", kind: "rfc" },
  { year: "Feb 2025", what: "0 implementations", detail: "Co-author Benjamin Schwartz at DNS-OARC 44: '0 number of known implementations'.", source: "indico.dns-oarc.net/event/52/contributions/1168", kind: "gap" },
];

export function WhyNowSlide() {
  const [i, setI] = useState(6);
  const m = MILESTONES[i];
  return (
    <Slide section="Why now" title="Every building block ships. The check that ties them together did not." sub="Click a milestone."
      takeaway="Encrypted transport, resolver discovery and per-domain routing exist in the major OSes. RFC 9704 adds the authorisation; SplitTrust is the running code.">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <svg viewBox="0 0 1200 170" className="h-40 w-full min-w-0 max-w-full">
          <line x1={60} y1={70} x2={1140} y2={70} stroke="#cbd5e1" strokeWidth={4} />
          {MILESTONES.map((ms, k) => {
            const x = 90 + k * (1020 / (MILESTONES.length - 1));
            const fill = ms.kind === "rfc" ? BLUE : ms.kind === "gap" ? "#b91c1c" : GREEN;
            const row = k % 2 === 0 ? 50 : 76; // alternate rows so neighbouring labels never touch
            return (
              <g key={ms.year} transform={`translate(${x}, 70)`} className="cursor-pointer" onClick={() => setI(k)}>
                <line x1={0} y1={14} x2={0} y2={row - 16} stroke="#cbd5e1" strokeWidth={1.5} />
                <circle r={k === i ? 18 : 12} fill={fill} stroke="#fff" strokeWidth={3} />
                <text y={-30} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>{ms.year}</text>
                <text y={row} textAnchor="middle" fontSize={13} fill={k === i ? INK : MUTED} fontWeight={k === i ? 700 : 500}>{ms.what}</text>
              </g>
            );
          })}
        </svg>
        <div className="mx-auto w-full max-w-4xl rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline gap-3"><span className="text-sm font-semibold text-slate-500">{m.year}</span><span className="text-2xl font-bold">{m.what}</span></div>
          <p className="mt-2 text-lg text-slate-800">{m.detail}</p>
          <p className="mt-2 font-mono text-xs text-slate-400">{m.source}</p>
        </div>
        <div className="grid gap-4 md:grid-cols-3 text-sm text-slate-700">
          <div className="rounded-xl bg-white p-4 shadow-sm"><b>What is mature:</b> DoT/DoH on every major OS, DDR at Apple and Microsoft, per-domain resolver routing (systemd-resolved, Windows NRPT, Apple NetworkExtension).</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b>What is uneven:</b> DNR acceptance (systemd 257, Windows opt-in), PvD Additional Information (Apple only, partially), network-side emission of either. A pilot carries the claim via MDM or VPN config instead.</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b>What was missing:</b> any code that performs the RFC 9704 check. That is the gap this project fills, with test vectors and a corrected example for whoever comes next.</div>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- Who buys, who ships ---------- */

export function AudienceSlide() {
  const col = (rank: string, title: string, who: string[], deploys: string[], tone: string) => (
    <div className={`flex flex-col rounded-2xl border-2 bg-white p-5 shadow-sm ${tone}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{rank}</div>
      <div className="mt-1 text-xl font-bold leading-tight">{title}</div>
      <ul className="mt-3 space-y-1 text-sm text-slate-700">{who.map((d) => <li key={d}>{d}</li>)}</ul>
      <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-500">They deploy</div>
      <ul className="mt-1 space-y-1 text-sm text-slate-800">{deploys.map((d) => <li key={d} className="flex gap-2"><span className="text-blue-600">+</span><span>{d}</span></li>)}</ul>
    </div>
  );
  return (
    <Slide section="Who it is for" title="Who buys, who ships"
      takeaway="First pilots: managed laptops and phones where one organisation controls the domain, the certificate, the office resolver and the client.">
      <div className="grid flex-1 content-center gap-4 lg:grid-cols-3">
        {col("1. Buys", "Companies with split-horizon DNS and roaming staff",
          ["banks, hospitals, agencies, universities", "run Windows DNS, BIND, Infoblox, BlueCat", "today: trust the local resolver, or VPN everything"],
          ["a signed zone (or a trusted resolver, s.6.1)", "one TXT record per claim", "DoT and a certificate on the office resolver", "a client that checks"], "border-blue-300")}
        {col("2. Ships", "OS and device-management vendors",
          ["already discover resolvers: DDR, DNR", "already route per domain: resolved, NRPT, NetworkExtension", "missing: the authorisation check"],
          ["the RFC 9704 check in the system resolver", "fail closed, Extended DNS Errors to apps", "policy through MDM or GPO"], "border-slate-200")}
        {col("3. Enables", "Resolver, DDI and ZTNA vendors",
          ["BIND, Unbound, Knot, CoreDNS: inbound DoT, views", "Infoblox, BlueCat: inbound DoT shipped", "Cloudflare Gateway, Umbrella, Tailscale: endpoint routing"],
          ["a certificate for the announced name", "claim and TXT automation, salt rotation", "DHCP, RA or PvD emission (none yet)"], "border-slate-200")}
      </div>
      <div className="grid gap-4 pb-2 md:grid-cols-2 text-sm text-slate-600">
        <div className="rounded-xl bg-white p-3 shadow-sm"><b className="text-slate-900">Not for:</b> consumers directly, hotels and cafes, content filtering (RFC 9704 s.3).</div>
        <div className="rounded-xl bg-white p-3 shadow-sm"><b className="text-slate-900">Constraint:</b> about 5 percent of .com is DNSSEC-signed (Verisign, 2023). The s.6.1 path, also implemented, widens the reach.</div>
      </div>
    </Slide>
  );
}
