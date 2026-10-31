import { motion } from "framer-motion";
import { useState } from "react";
import type { ClaimReport, Device, Stage } from "../lib/api";
import { consequence, REASON_TITLES, STEPS, stageSentence, stepStatus, toneFor, type Tone } from "../lib/story";

export const toneChip: Record<Tone, string> = { green: "chip chip-green", yellow: "chip chip-yellow", red: "chip chip-red", grey: "chip chip-grey" };
const toneBorder: Record<Tone, string> = { green: "border-emerald-500/60 bg-emerald-500/10", yellow: "border-amber-400/60 bg-amber-400/10", red: "border-rose-500/60 bg-rose-500/10", grey: "border-slate-500/60 bg-slate-500/10" };

/* The six human steps, revealed as the animation plays. */
export function Checklist({ claim, playedStageIndex }: { claim: ClaimReport; playedStageIndex: number }) {
  return (
    <ol className="space-y-2">
      {STEPS.map((step) => {
        const st = stepStatus(step, claim.stages, playedStageIndex);
        const mine = claim.stages.filter((s) => step.stages.includes(s.id) && s.status !== "skipped");
        const lines = mine.filter((s) => claim.stages.indexOf(s) <= playedStageIndex).map((s) => stageSentence(s, claim));
        const skippedLines = st === "skipped" ? claim.stages.filter((s) => step.stages.includes(s.id) && s.code && s.code !== "NOT_REACHED").map((s) => stageSentence(s, claim)).filter(Boolean) : [];
        const icon = st === "pass" ? "✓" : st === "fail" ? "✕" : st === "skipped" ? "–" : "·";
        const color = st === "pass" ? "text-emerald-400 border-emerald-500/50" : st === "fail" ? "text-rose-400 border-rose-500/50" : st === "skipped" ? "text-slate-500 border-slate-700" : "text-slate-600 border-slate-800";
        return (
          <motion.li key={step.key} layout className={`flex gap-3 rounded-xl border p-3 ${color} ${st === "pending" ? "opacity-50" : ""}`}>
            <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-black ${color}`}>{icon}</span>
            <div className="min-w-0">
              <div className="font-semibold text-slate-100">{step.title}</div>
              {(lines.length ? lines : skippedLines).map((l, i) => <p key={i} className="text-sm text-slate-300">{l}</p>)}
              {st === "skipped" && lines.length === 0 && skippedLines.length === 0 && <p className="text-sm text-slate-500">not reached</p>}
            </div>
          </motion.li>
        );
      })}
    </ol>
  );
}

export function VerdictCard({ claim, device, visible }: { claim: ClaimReport; device: Device; visible: boolean }) {
  const tone = toneFor(claim.decision, claim.reason, claim.grant);
  if (!visible) return <div className="h-24 rounded-2xl border border-dashed border-slate-800" />;
  return (
    <motion.div initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: "spring", stiffness: 200, damping: 20 }}
      className={`rounded-2xl border-2 p-5 ${toneBorder[tone]}`}>
      <div className="flex flex-wrap items-center gap-3">
        <span className={toneChip[tone] + " text-sm"}>{claim.decision}</span>
        <span className="text-xl font-black">{REASON_TITLES[claim.reason] ?? claim.reason}</span>
        <code className="ml-auto text-xs text-slate-400">{claim.reason}</code>
      </div>
      <p className="mt-3 text-lg leading-snug text-slate-100">{consequence(claim, device)}</p>
      {claim.grant && (
        <p className="mt-2 text-sm text-slate-300">
          Grant: <code>{claim.grant.resolver}</code> for <code>{claim.grant.scopes.join(", ")}</code> · path {claim.grant.path} · local DNSSEC {claim.grant.local_dnssec_mode}
          {claim.grant.path === "external" && <> · external AD={String(claim.grant.external_ad)}</>} · until {new Date(claim.grant.expires_at).toLocaleTimeString()}
        </p>
      )}
    </motion.div>
  );
}

/* The raw machine trace, collapsed by default. */
export function RawTrace({ stages, title = "technical trace" }: { stages: Stage[]; title?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mt-3">
      <button className="text-xs text-slate-400 underline-offset-2 hover:underline" onClick={() => setOpen(!open)}>{open ? "▾" : "▸"} {title}</button>
      {open && (
        <div className="mt-2 space-y-1 font-mono text-xs">
          {stages.map((s) => (
            <details key={s.id} className="rounded-lg border border-slate-800 bg-slate-950 p-2">
              <summary className="cursor-pointer">
                <span className={`mr-2 inline-block w-14 font-bold uppercase ${s.status === "pass" ? "text-emerald-400" : s.status === "fail" ? "text-rose-400" : s.status === "error" ? "text-amber-400" : "text-slate-500"}`}>{s.status}</span>
                <span className="text-sky-300">{s.id}</span> <span className="text-slate-400">{s.code}</span> <span className="text-slate-300">{s.message}</span>
              </summary>
              {s.evidence !== undefined && <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-300">{JSON.stringify(s.evidence, null, 2)}</pre>}
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
