import { motion } from "framer-motion";
import { useState } from "react";
import type { ClaimReport, Device, Stage } from "../lib/api";
import { consequence, REASON_TITLES, STEPS, stageSentence, stepStatus, toneFor, type Tone } from "../lib/story";

export const toneChip: Record<Tone, string> = { green: "chip chip-green", yellow: "chip chip-yellow", red: "chip chip-red", grey: "chip chip-grey" };
const toneBox: Record<Tone, string> = {
  green: "border-green-300 bg-green-50", yellow: "border-amber-300 bg-amber-50", red: "border-red-300 bg-red-50", grey: "border-slate-300 bg-slate-50",
};

/* The six human steps, revealed as the animation plays. */
export function Checklist({ claim, playedStageIndex }: { claim: ClaimReport; playedStageIndex: number }) {
  return (
    <ol className="space-y-2">
      {STEPS.map((step) => {
        const st = stepStatus(step, claim.stages, playedStageIndex);
        const ran = claim.stages.filter((s) => step.stages.includes(s.id) && s.status !== "skipped");
        const lines = ran.filter((s) => claim.stages.indexOf(s) <= playedStageIndex).map((s) => stageSentence(s, claim));
        const skippedLines = st === "skipped"
          ? claim.stages.filter((s) => step.stages.includes(s.id) && s.code && s.code !== "NOT_REACHED").map((s) => stageSentence(s, claim)).filter(Boolean)
          : [];
        const icon = st === "pass" ? "✓" : st === "fail" ? "✕" : st === "skipped" ? "-" : "";
        const color = st === "pass" ? "border-green-300 text-green-700" : st === "fail" ? "border-red-300 text-red-700" : st === "skipped" ? "border-slate-200 text-slate-400" : "border-slate-200 text-slate-300";
        return (
          <motion.li key={step.key} layout className={`flex gap-3 rounded-lg border bg-white p-3 ${color} ${st === "pending" ? "opacity-60" : ""}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-sm font-bold ${color}`}>{icon}</span>
            <div className="min-w-0">
              <div className="font-semibold text-slate-900">{step.title}</div>
              {(lines.length ? lines : skippedLines).map((l, i) => <p key={i} className="text-sm text-slate-700">{l}</p>)}
              {st === "skipped" && lines.length === 0 && skippedLines.length === 0 && <p className="text-sm text-slate-400">not reached</p>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function VerdictCard({ claim, device, visible }: { claim: ClaimReport; device: Device; visible: boolean }) {
  const tone = toneFor(claim.decision, claim.reason, claim.grant);
  if (!visible) return <div className="h-24 rounded-xl border border-dashed border-slate-300" />;
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ type: "spring", stiffness: 220, damping: 22 }}
      className={`rounded-xl border-2 p-5 ${toneBox[tone]}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={toneChip[tone] + " text-sm"}>{claim.decision}</span>
        <span className="text-xl font-bold text-slate-900">{REASON_TITLES[claim.reason] ?? claim.reason}</span>
        <code className="ml-auto text-xs text-slate-500">{claim.reason}</code>
      </div>
      <p className="mt-3 text-lg leading-snug text-slate-800">{consequence(claim, device)}</p>
      {claim.grant && (
        <p className="mt-2 text-sm text-slate-600">
          Grant: <code>{claim.grant.resolver}</code> for <code>{claim.grant.scopes.join(", ")}</code>; path {claim.grant.path}; local DNSSEC {claim.grant.local_dnssec_mode}
          {claim.grant.path === "external" && <>; external AD={String(claim.grant.external_ad)}</>}; until {new Date(claim.grant.expires_at).toLocaleTimeString()}
        </p>
      )}
    </motion.div>
  );
}

/* The raw machine trace, collapsed by default. */
export function RawTrace({ stages, title = "Technical trace" }: { stages: Stage[]; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button className="text-xs font-medium text-slate-600 hover:underline" onClick={() => setOpen(!open)}>{open ? "Hide" : "Show"} {title.toLowerCase()}</button>
      {open && (
        <div className="mt-2 space-y-1 font-mono text-xs">
          {stages.map((s) => (
            <details key={s.id} className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <summary className="cursor-pointer">
                <span className={`mr-2 inline-block w-14 font-bold uppercase ${s.status === "pass" ? "text-green-700" : s.status === "fail" ? "text-red-700" : s.status === "error" ? "text-amber-700" : "text-slate-400"}`}>{s.status}</span>
                <span className="text-blue-700">{s.id}</span> <span className="text-slate-500">{s.code}</span> <span className="text-slate-700">{s.message}</span>
              </summary>
              {s.evidence !== undefined && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all rounded bg-white p-2 text-[11px] text-slate-700">{JSON.stringify(s.evidence, null, 2)}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
