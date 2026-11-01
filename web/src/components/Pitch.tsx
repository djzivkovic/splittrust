/* Pitch slides grounded in sourced research: why now (the building blocks and their dates), and
   who buys and who ships. Sources are kept with each fact so a judge can check them. */

import { useState } from "react";
import { BLUE, GREEN, INK, MUTED } from "./Art";
import { Slide } from "./Slide";

/* ---------- Why now: the building blocks exist, the check did not ---------- */

const MILESTONES: { year: string; what: string; detail: string; source: string; kind: "block" | "rfc" | "gap" }[] = [
  { year: "2016", what: "DNS over TLS", detail: "RFC 7858: encrypted transport to a resolver, with a certificate to check.", source: "rfc-editor.org/rfc/rfc7858", kind: "block" },
  { year: "2018 to 2020", what: "Encrypted DNS in the OS", detail: "Android 9 Private DNS (2018); iOS 14 and macOS 11 system DoH/DoT with per-domain rules (2020); Windows 11 DoH.", source: "support.google.com/android/answer/9654714; WWDC 2020 session 10047", kind: "block" },
  { year: "2022 to 2024", what: "Resolver discovery", detail: "DDR on by default at Apple (2022); DDR and DNR published as RFC 9462 and 9463 (2023); systemd 257 parses DNR (2024).", source: "WWDC 2022 session 10079; rfc-editor.org/rfc/rfc9463; systemd PR 30952", kind: "block" },
  { year: "Jan 2025", what: "RFC 9704", detail: "Proposed Standard from the ADD working group: the owner publishes a token, the device checks before trusting a local resolver.", source: "rfc-editor.org/rfc/rfc9704", kind: "rfc" },
  { year: "Feb 2025", what: "Authors: none known", detail: "At DNS-OARC 44 in February 2025, co-author Benjamin Schwartz reported no known implementations. This is a dated report, not a claim that none exist today.", source: "indico.dns-oarc.net/event/52/contributions/1168", kind: "gap" },
];

export function WhyNowSlide() {
  const [i, setI] = useState(3);
  const m = MILESTONES[i];
  return (
    <Slide section="Background" title="Why this standard is worth implementing">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <svg viewBox="0 0 1200 150" className="h-36 w-full min-w-0 max-w-full">
          <line x1={60} y1={70} x2={1140} y2={70} stroke="#cbd5e1" strokeWidth={4} />
          {MILESTONES.map((ms, k) => {
            const x = 90 + k * (1020 / (MILESTONES.length - 1));
            const fill = ms.kind === "rfc" ? BLUE : ms.kind === "gap" ? "#b91c1c" : GREEN;
            return (
              <g key={ms.year} transform={`translate(${x}, 70)`} className="cursor-pointer" onClick={() => setI(k)}>
                <circle r={k === i ? 20 : 14} fill={fill} stroke="#fff" strokeWidth={3} />
                <text y={-34} textAnchor="middle" fontSize={15} fontWeight={700} fill={INK}>{ms.year}</text>
                <text y={54} textAnchor="middle" fontSize={15} fill={k === i ? INK : MUTED} fontWeight={k === i ? 700 : 500}>{ms.what}</text>
              </g>
            );
          })}
        </svg>
        <div className="mx-auto w-full max-w-4xl rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-baseline gap-3"><span className="text-sm font-semibold text-slate-500">{m.year}</span><span className="text-2xl font-bold">{m.what}</span></div>
          <p className="mt-2 text-lg text-slate-800">{m.detail}</p>
          <p className="mt-2 font-mono text-xs text-slate-400">{m.source}</p>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- Who buys, who ships ---------- */

export function AudienceSlide() {
  return (
    <Slide section="Who it is for" title="Who benefits, and who deploys it"
      takeaway="First pilot: one organization that controls the domain, resolver, certificates and managed clients.">
      <div className="grid flex-1 content-center gap-5 md:grid-cols-2">
        <div className="rounded-2xl border-2 border-blue-200 bg-white p-6 shadow-sm">
          <h3 className="text-2xl font-bold">People using private services</h3>
          <p className="mt-4 text-lg text-slate-700">Developers, staff and researchers whose devices move between company networks, home and third-party Wi-Fi.</p>
          <p className="mt-3 text-base text-slate-600">They need legitimate private DNS views without accepting every network's claims. Existing VPN and managed-DNS policies remain valid options.</p>
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-2xl font-bold">DNS and endpoint teams</h3>
          <p className="mt-4 text-lg text-slate-700">The domain team publishes authorization; the resolver team provides authenticated encrypted DNS; the endpoint team configures the checking client.</p>
          <p className="mt-3 text-base text-slate-600">Resolver, OS and device-management vendors are possible integration partners, not assumed to ship this check already.</p>
        </div>
      </div>
      <div className="grid gap-4 pb-2 md:grid-cols-2 text-sm text-slate-600">
        <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Not a replacement for:</b> VPN connectivity, application authentication or HTTPS.</div>
        <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Scope:</b> owner-authorized private DNS views, not DNS filtering or Special-Use names (RFC 9704 §3).</div>
      </div>
    </Slide>
  );
}
