import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { api, type Device, type Run, type Summary } from "../lib/api";
import { findVariant } from "../lib/networks";
import { runTone } from "../lib/story";
import { DevicePicker, NetworkPicker } from "../components/Pickers";
import { FlowDiagram, beatsFor } from "../components/FlowDiagram";
import { Checklist, VerdictCard, RawTrace, toneChip } from "../components/Verdict";
import { Browse } from "../components/Browse";

const BEAT_MS = 950;

export function Stage({ summaries }: { summaries: Summary[] }) {
  const [device, setDevice] = useState<Device>("validating-stub");
  const [scenario, setScenario] = useState("legit");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState(-1); // beat index of claim 0 being shown
  const [speed, setSpeed] = useState(1);
  const timer = useRef<number | null>(null);

  const summary = summaries.find((s) => s.id === scenario);
  const meta = findVariant(scenario);
  const isReal = !!summary?.requires_internet;
  const claim = run?.claims[0];
  const beats = useMemo(() => (run && claim ? beatsFor(claim, run.device, run.resolution) : []), [run, claim]);
  const playedStage = claim && played >= 0 ? claim.stages.indexOf(beats[Math.min(played, beats.length - 1)]?.stage) : -1;
  const done = beats.length > 0 && played >= beats.length - 1;

  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };

  const play = useCallback((n: number) => {
    stop();
    setPlayed(-1);
    let i = -1;
    const tick = () => {
      i += 1;
      setPlayed(i);
      if (i < n - 1) timer.current = window.setTimeout(tick, BEAT_MS / speed);
    };
    timer.current = window.setTimeout(tick, 150);
  }, [speed]);

  const verify = useCallback(async (id: string, dev: Device) => {
    stop(); setRun(null); setError(null); setPlayed(-1);
    if (summaries.find((s) => s.id === id)?.requires_internet) return;
    setBusy(true);
    api.clientJoin(id, dev).catch(() => undefined); // keep the lab client on the same network
    try {
      const r = await api.verify(id, dev);
      setRun(r);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [summaries]);

  useEffect(() => { verify(scenario, device); }, [scenario, device, verify]);
  useEffect(() => { if (run && beats.length) play(beats.length); return stop; }, [run, beats.length, play]);

  // keyboard: 1/2/3 device, ←/→ network, space replay
  useEffect(() => {
    const ids = summaries.filter((s) => !s.requires_internet).map((s) => s.id);
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.tagName === "INPUT") return;
      if (e.key === "1") setDevice("validating-stub");
      if (e.key === "2") setDevice("private-dns");
      if (e.key === "3") setDevice("hybrid");
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        const i = ids.indexOf(scenario);
        setScenario(ids[(i + (e.key === "ArrowRight" ? 1 : ids.length - 1)) % ids.length]);
      }
      if (e.key === " " && beats.length) { e.preventDefault(); play(beats.length); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [summaries, scenario, beats.length, play]);

  const expected = summary?.expected.find((x) => x.device === device);
  const tone = run ? runTone(run.claims, run.decision) : "grey";

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-6 pb-24 pt-6">
      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">1 · You are</h2>
        <DevicePicker value={device} onChange={setDevice} />
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">2 · Join a network <span className="ml-2 normal-case tracking-normal text-slate-500"><span className="kbd">←</span> <span className="kbd">→</span></span></h2>
        <NetworkPicker value={scenario} onChange={setScenario} summaries={summaries} />
        {meta && (
          <motion.div key={scenario} initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="card mt-3 grid gap-3 md:grid-cols-2">
            <div><div className="text-xs font-bold uppercase tracking-wide text-sky-300">This network says</div><p className="mt-1 text-slate-100">“{meta.variant.announces}”</p></div>
            <div><div className="text-xs font-bold uppercase tracking-wide text-amber-300">Meanwhile, in the world</div><p className="mt-1 text-slate-200">{meta.variant.world}</p></div>
          </motion.div>
        )}
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <h2 className="text-sm font-bold uppercase tracking-widest text-slate-400">3 · The device checks</h2>
          {run && <span className={toneChip[tone]}>{run.decision}</span>}
          {expected && <span className="text-xs text-slate-500">expected: {expected.decision} / {expected.reason}</span>}
          <span className="ml-auto flex items-center gap-2 text-xs text-slate-400">
            <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => beats.length && play(beats.length)} disabled={!beats.length}>▶ replay <span className="kbd">space</span></button>
            <select className="input w-auto py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))}>
              <option value={0.6}>slow</option><option value={1}>normal</option><option value={2}>fast</option>
            </select>
          </span>
        </div>
        {isReal ? (
          <div className="card border-amber-400/40">
            <p className="text-slate-100">This network is the real Internet. The console's container has no Internet access by design, so this one runs from the terminal, in the lab's only egress-enabled container:</p>
            <pre className="mt-3 overflow-auto rounded-xl bg-slate-950 p-3 text-sm text-emerald-200">docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic{"\n"}docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic --device private-dns</pre>
            <p className="mt-3 text-sm text-slate-300">Record live in <code>zivkovic.me</code>: <code>dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me TXT "token=BiwP_K0b…"</code>, DS at the <code>.me</code> registry, validated under the IANA root → <span className="chip chip-green">accepted · AUTHORIZED</span>; via the real dns.quad9.net → <span className="chip chip-green">accepted · EXTERNAL_TOKEN_MATCH (AD=1)</span>.</p>
          </div>
        ) : error ? (
          <div className="card border-rose-500/40 text-rose-200">{error}</div>
        ) : busy || !run || !claim ? (
          <div className="card animate-pulse text-slate-400">verifying…</div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <div className="card">
              <FlowDiagram claim={claim} device={run.device} resolution={run.resolution} beats={beats} playedUpTo={played}
                parent={claim.inspection?.parent?.replace(/\.$/, "") ?? scenario} announced={claim.resolver} external="quad9.lab" />
            </div>
            <div className="space-y-4">
              <Checklist claim={claim} playedStageIndex={playedStage} />
              <VerdictCard claim={claim} device={run.device} visible={done} />
              {run.claims.length > 1 && done && (
                <div className="card">
                  <div className="text-xs font-bold uppercase tracking-wide text-slate-400">Other claims on this network</div>
                  {run.claims.slice(1).map((c) => (
                    <div key={c.index} className="mt-2 flex items-center gap-2 text-sm"><span className={toneChip[runTone([c], c.decision)]}>{c.decision}</span> <code>{c.resolver}</code> for <code>{c.inspection?.scopes.join(", ")}</code> — {c.reason}</div>
                  ))}
                </div>
              )}
              <RawTrace stages={claim.stages} />
            </div>
          </div>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-slate-400">4 · Now browse — a plain client on this network, no SplitTrust code inside</h2>
        <div className="card">
          <Browse scenarioId={scenario} hotel={meta?.group.key === "hotel"} disabled={isReal} />
        </div>
      </section>
    </div>
  );
}
