import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type Device, type Run, type Summary } from "../lib/api";
import { findVariant } from "../lib/networks";
import { runTone } from "../lib/story";
import { DevicePicker, NetworkPicker } from "../components/Pickers";
import { FlowDiagram, beatsFor } from "../components/FlowDiagram";
import { Checklist, VerdictCard, RawTrace, toneChip } from "../components/Verdict";
import { Browse } from "../components/Browse";

const BEAT_MS = 1000;

function StepHeader({ no, title, hint, right }: { no: number; title: string; hint?: string; right?: React.ReactNode }) {
  return (
    <div className="step">
      <span className="step-no">Step {no}</span>
      <span className="step-title">{title}</span>
      {hint && <span className="step-hint hidden md:inline">{hint}</span>}
      {right && <span className="ml-auto flex items-center gap-2">{right}</span>}
    </div>
  );
}

export function Demo({ summaries }: { summaries: Summary[] }) {
  const [device, setDevice] = useState<Device>("validating-stub");
  const [scenario, setScenario] = useState("legit");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState(-1);
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
    timer.current = window.setTimeout(tick, 200);
  }, [speed]);

  const verify = useCallback(async (id: string, dev: Device) => {
    stop(); setRun(null); setError(null); setPlayed(-1);
    if (summaries.find((s) => s.id === id)?.requires_internet) return;
    setBusy(true);
    api.clientJoin(id, dev).catch(() => undefined); // keep the lab's plain client on the same network
    try {
      setRun(await api.verify(id, dev));
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [summaries]);

  useEffect(() => { verify(scenario, device); }, [scenario, device, verify]);
  useEffect(() => { if (run && beats.length) play(beats.length); return stop; }, [run, beats.length, play]);

  useEffect(() => {
    const ids = summaries.filter((s) => !s.requires_internet).map((s) => s.id);
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
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
        <StepHeader no={1} title="Choose the device" hint="How the client resolves names decides which checks the RFC asks for." right={<span className="text-xs text-slate-500">keys <span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span></span>} />
        <DevicePicker value={device} onChange={setDevice} />
      </section>

      <section>
        <StepHeader no={2} title="Join a network" hint="Each network announces a resolver and a claim. The card says what it claims and what is actually true." right={<span className="text-xs text-slate-500">keys <span className="kbd">←</span> <span className="kbd">→</span></span>} />
        <NetworkPicker value={scenario} onChange={setScenario} summaries={summaries} />
        {meta && (
          <div className="card mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">The network announces</div>
              <p className="mt-1 text-slate-800">{meta.variant.announces}</p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">What is actually true</div>
              <p className="mt-1 text-slate-700">{meta.variant.world}</p>
            </div>
          </div>
        )}
      </section>

      <section>
        <StepHeader no={3} title="Verification" hint="What the device does before it trusts the resolver with those names."
          right={<>
            {run && <span className={toneChip[tone]}>{run.decision}</span>}
            {expected && <span className="text-xs text-slate-500">expected: {expected.decision} ({expected.reason})</span>}
            <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => beats.length && play(beats.length)} disabled={!beats.length}>Replay <span className="kbd ml-1">space</span></button>
            <select className="input w-auto py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Animation speed">
              <option value={0.6}>slow</option><option value={1}>normal</option><option value={2}>fast</option>
            </select>
          </>} />
        {isReal ? (
          <div className="card">
            <p className="text-slate-800">This network is the real Internet. The console's container has no Internet access by design, so this verification runs from a terminal in the lab's only Internet-connected container:</p>
            <pre className="mt-3 overflow-auto rounded-lg bg-slate-900 p-3 text-sm text-slate-100">docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic{"\n"}docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic --device private-dns</pre>
            <p className="mt-3 text-sm text-slate-700">The record is live in <code>zivkovic.me</code> (<code>dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me TXT "token=BiwP_K0b..."</code>), the DS record is at the <code>.me</code> registry, and the result under the IANA root is <span className="chip chip-green">accepted, AUTHORIZED</span>. Through the real dns.quad9.net: <span className="chip chip-green">accepted, EXTERNAL_TOKEN_MATCH (AD=1)</span>.</p>
          </div>
        ) : error ? (
          <div className="card border-red-300 text-red-800">{error}</div>
        ) : busy || !run || !claim ? (
          <div className="card animate-pulse text-slate-500">Verifying...</div>
        ) : (
          <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
            <div className="card">
              <FlowDiagram claim={claim} device={run.device} resolution={run.resolution} beats={beats} playedUpTo={played}
                parent={claim.inspection?.parent?.replace(/\.$/, "") ?? scenario} announced={claim.resolver} external="quad9.lab" />
              <p className="mt-2 text-xs text-slate-500">Resolution path: {run.resolution === "via-network" ? "the device validates DNSSEC itself but sends its queries through the network's resolver (RFC 9704, Figure 4)" : "the device resolves iteratively from the root"}.</p>
            </div>
            <div className="space-y-4">
              <Checklist claim={claim} playedStageIndex={playedStage} />
              <VerdictCard claim={claim} device={run.device} visible={done} />
              {run.claims.length > 1 && done && (
                <div className="card">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other claims on this network</div>
                  {run.claims.slice(1).map((c) => (
                    <div key={c.index} className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className={toneChip[runTone([c], c.decision)]}>{c.decision}</span> <code>{c.resolver}</code> for <code>{c.inspection?.scopes.join(", ")}</code>: {c.reason}</div>
                  ))}
                </div>
              )}
              <RawTrace stages={claim.stages} />
            </div>
          </div>
        )}
      </section>

      <section>
        <StepHeader no={4} title="Resolve a name as a plain client" hint="A client container with no SplitTrust code; its DNS server is the SplitTrust proxy on this network." />
        <div className="card">
          <Browse scenarioId={scenario} hotel={meta?.group.key === "hotel"} disabled={isReal} />
        </div>
      </section>
    </div>
  );
}
