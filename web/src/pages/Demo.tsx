/* The demo as guided scenes: one real situation at a time, five screens per scene, nothing off-screen.
   Arrow keys move through steps and scenes; 1/2/3 switch the device; space replays the animation; n toggles notes. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BrowseResult, type Device, type Run, type Summary } from "../lib/api";
import { SCENES, STEP_NAMES, type Scene } from "../lib/scenes";
import { DEVICES } from "../lib/networks";
import { runTone } from "../lib/story";
import { FlowDiagram, beatsFor } from "../components/FlowDiagram";
import { Checklist, VerdictCard, RawTrace, toneChip } from "../components/Verdict";
import { ClaimView, CertView, DigView } from "../components/Evidence";
import { DevicePicker } from "../components/Pickers";
import { Result } from "../components/Browse";

const BEAT_MS = 1000;

export function Demo({ summaries }: { summaries: Summary[] }) {
  const scenes = useMemo(() => SCENES.filter((s) => summaries.some((x) => x.id === s.id)), [summaries]);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<Device>(scenes[0]?.device ?? "validating-stub");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [notes, setNotes] = useState(false);
  const [browse, setBrowse] = useState<BrowseResult | null>(null);
  const [browseErr, setBrowseErr] = useState<string | null>(null);
  const timer = useRef<number | null>(null);

  const scene: Scene = scenes[sceneIdx];
  const summary = summaries.find((s) => s.id === scene.id);
  const isReal = !!summary?.requires_internet;
  const hotel = scene.id.startsWith("hotel") || scene.id === "replay";
  const claim = run?.claims[0];
  const beats = useMemo(() => (run && claim ? beatsFor(claim, run.device, run.resolution) : []), [run, claim]);
  const playedStage = claim && played >= 0 ? claim.stages.indexOf(beats[Math.min(played, beats.length - 1)]?.stage) : -1;

  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const play = useCallback((n: number) => {
    stop(); setPlayed(-1);
    let i = -1;
    const tick = () => { i += 1; setPlayed(i); if (i < n - 1) timer.current = window.setTimeout(tick, BEAT_MS / speed); };
    timer.current = window.setTimeout(tick, 250);
  }, [speed]);
  const finish = useCallback(() => { stop(); setPlayed(beats.length - 1); }, [beats.length]);

  // Selecting a scene resets the device to the scene's starting device.
  const goScene = useCallback((i: number, s = 0) => { setSceneIdx(i); setStep(s); setDevice(scenes[i].device); setBrowse(null); setBrowseErr(null); }, [scenes]);

  const verify = useCallback(async (id: string, dev: Device) => {
    stop(); setRun(null); setError(null); setPlayed(-1); setBrowse(null);
    if (summaries.find((s) => s.id === id)?.requires_internet) return;
    setBusy(true);
    api.clientJoin(id, dev).catch(() => undefined);
    try { setRun(await api.verify(id, dev)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, [summaries]);

  useEffect(() => { verify(scene.id, device); }, [scene.id, device, verify]);

  // Step 2 plays the animation; other steps show the finished state.
  useEffect(() => {
    if (!run || !beats.length) return;
    if (step === 2) play(beats.length); else finish();
    return stop;
  }, [run, beats.length, step, play, finish]);

  // Step 4 fetches the page as both devices.
  useEffect(() => {
    if (step !== 4 || isReal || !run) return;
    let cancelled = false;
    setBrowse(null); setBrowseErr(null);
    api.browse(scene.name, hotel).then((r) => { if (!cancelled) setBrowse(r); }).catch((e) => { if (!cancelled) setBrowseErr((e as Error).message); });
    return () => { cancelled = true; };
  }, [step, scene.name, hotel, isReal, run]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") { if (step < 4) setStep(step + 1); else goScene((sceneIdx + 1) % scenes.length); }
      if (e.key === "ArrowLeft") { if (step > 0) setStep(step - 1); else goScene((sceneIdx + scenes.length - 1) % scenes.length, 4); }
      if (e.key === "Home") setStep(0);
      if (e.key === "1") setDevice("validating-stub");
      if (e.key === "2") setDevice("private-dns");
      if (e.key === "3") setDevice("hybrid");
      if (e.key === "n") setNotes((v) => !v);
      if (e.key === " " && step === 2 && beats.length) { e.preventDefault(); play(beats.length); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, sceneIdx, scenes.length, beats.length, play, goScene]);

  const tone = run ? runTone(run.claims, run.decision) : "grey";
  const deviceCard = DEVICES.find((d) => d.id === device)!;

  return (
    <div className="flex min-h-[calc(100vh-61px)] flex-col">
      {/* scene strip */}
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-6 py-2">
          {scenes.map((s, i) => (
            <button key={s.id} onClick={() => goScene(i)}
              className={`rounded-md px-3 py-1.5 text-sm transition ${i === sceneIdx ? "bg-slate-900 font-semibold text-white" : s.talk ? "font-medium text-slate-800 hover:bg-slate-100" : "text-slate-500 hover:bg-slate-100"}`}>
              {s.title}
            </button>
          ))}
        </div>
      </div>

      {/* step header */}
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-6 pt-5">
        <div className="flex items-center gap-1">
          {STEP_NAMES.map((n, i) => (
            <button key={n} onClick={() => setStep(i)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${i === step ? "bg-blue-700 text-white" : i < step ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {n}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {run && <span className={toneChip[tone]}>{run.decision}</span>}
          <span>device: <b className="text-slate-700">{deviceCard.name}</b> <span className="kbd">1</span> <span className="kbd">2</span> <span className="kbd">3</span></span>
          <span><span className="kbd">←</span> <span className="kbd">→</span> steps</span>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setNotes(!notes)}>Notes <span className="kbd ml-1">n</span></button>
        </div>
      </div>

      {/* screen */}
      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-5">
        {step === 0 && (
          <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
            <div>
              <h1 className="text-3xl font-semibold leading-tight text-slate-900">{scene.title}</h1>
              <p className="mt-4 text-2xl leading-snug text-slate-800">{scene.situation}</p>
              <div className="mt-6 grid gap-4 md:grid-cols-2">
                <div className="card"><div className="text-xs font-semibold uppercase tracking-wide text-blue-700">The network announces</div><p className="mt-1 text-lg text-slate-800">{scene.announces}</p></div>
                <div className="card"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">What is actually true</div><p className="mt-1 text-lg text-slate-700">{scene.world}</p></div>
              </div>
            </div>
            <div>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">The device</div>
              <DevicePicker value={device} onChange={setDevice} />
              <p className="mt-3 text-sm text-slate-500">The person opens <code className="text-slate-800">http://{scene.name}</code>.</p>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">What the network sent</h2>
            <p className="mt-1 text-slate-600">The announcement, verbatim, and what the device derives from it. The token is what the domain owner would have had to publish.</p>
            <div className="mt-4">
              {isReal ? <RealNote scene={scene} /> : error ? <Err text={error} /> : !claim ? <Loading /> : <ClaimView claim={claim} />}
            </div>
            {run && run.claims.length > 1 && <p className="mt-3 text-sm text-slate-500">This network made {run.claims.length} claims; each is verified on its own. The screens follow the first; the others are listed with the verdict.</p>}
          </div>
        )}

        {step === 2 && (
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">What the device checks</h2>
              <span className="text-sm text-slate-500">before it trusts the resolver with those names</span>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => beats.length && play(beats.length)} disabled={!beats.length}>Replay <span className="kbd ml-1">space</span></button>
                <select className="input w-auto py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Animation speed">
                  <option value={0.6}>slow</option><option value={1}>normal</option><option value={2}>fast</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              {isReal ? <RealNote scene={scene} /> : error ? <Err text={error} /> : busy || !run || !claim ? <Loading /> : (
                <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
                  <div className="card">
                    <FlowDiagram claim={claim} device={run.device} resolution={run.resolution} beats={beats} playedUpTo={played}
                      parent={claim.inspection?.parent?.replace(/\.$/, "") ?? scene.id} announced={claim.resolver} external="quad9.lab" />
                    <p className="mt-2 text-xs text-slate-500">{run.resolution === "via-network" ? "The device validates DNSSEC itself but sends its queries through the network's resolver (RFC 9704, Figure 4)." : "The device resolves iteratively from the root."}</p>
                  </div>
                  <Checklist claim={claim} playedStageIndex={playedStage} />
                </div>
              )}
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Verdict and evidence</h2>
            <div className="mt-4">
              {isReal ? <RealNote scene={scene} /> : error ? <Err text={error} /> : !run || !claim ? <Loading /> : (
                <div className="space-y-4">
                  <VerdictCard claim={claim} device={run.device} visible />
                  <div className="grid gap-4 lg:grid-cols-2">
                    <DigView claim={claim} />
                    <CertView claim={claim} />
                  </div>
                  {run.claims.length > 1 && (
                    <div className="card">
                      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Other claims on this network</div>
                      {run.claims.slice(1).map((c) => (
                        <div key={c.index} className="mt-2 flex flex-wrap items-center gap-2 text-sm"><span className={toneChip[runTone([c], c.decision)]}>{c.decision}</span> <code>{c.resolver}</code> for <code>{c.inspection?.scopes.join(", ")}</code>: {c.reason}</div>
                      ))}
                    </div>
                  )}
                  <RawTrace stages={claim.stages} />
                </div>
              )}
            </div>
          </div>
        )}

        {step === 4 && (
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Proof: two devices open <code>http://{scene.name}</code></h2>
            <p className="mt-1 text-slate-600">Real DNS lookups and real page fetches inside the lab. The protected device is a plain client container with no SplitTrust code; its DNS server is the SplitTrust proxy, which applies the verdict above.{hotel ? " The other device uses the hotel's DNS directly." : ""}</p>
            <div className="mt-4">
              {isReal ? <RealNote scene={scene} /> : browseErr ? <Err text={browseErr} /> : !browse ? <Loading text="Resolving and fetching..." /> : (
                <div className={`grid gap-4 ${browse.naive ? "md:grid-cols-2" : ""}`}>
                  {browse.naive && <Result title="Device without SplitTrust" l={browse.naive} />}
                  <Result title={`${deviceCard.name} with SplitTrust`} l={browse.device} />
                </div>
              )}
              {!isReal && browse && !browse.naive && <p className="mt-3 text-sm text-slate-500">On this network a device without SplitTrust would get the same answer from the same resolver. The difference is that this answer was verified first.</p>}
            </div>
          </div>
        )}
      </div>

      {/* notes drawer */}
      {notes && (
        <div className="border-t border-slate-200 bg-amber-50">
          <div className="mx-auto max-w-7xl px-6 py-3 text-sm text-slate-800"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Say</span>{scene.notes[step]}</div>
        </div>
      )}
    </div>
  );
}

function Loading({ text = "Verifying..." }: { text?: string }) { return <div className="card animate-pulse text-slate-500">{text}</div>; }
function Err({ text }: { text: string }) { return <div className="card border-red-300 text-red-800">{text}</div>; }

function RealNote({ scene }: { scene: Scene }) {
  return (
    <div className="card">
      <p className="text-slate-800">{scene.world} The console's container has no Internet access by design, so this one runs from a terminal:</p>
      <pre className="mt-3 overflow-auto rounded-lg bg-slate-900 p-3 text-sm text-slate-100">docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic{"\n"}docker compose -f lab/compose.yaml --profile real run --rm real verify --scenario real-zivkovic --device private-dns</pre>
      <p className="mt-3 text-sm text-slate-700">Record live in <code>zivkovic.me</code>: <code>dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me TXT "token=BiwP_K0b..."</code>; DS at the <code>.me</code> registry (key tag 2371). Result under the IANA root: <span className="chip chip-green">accepted, AUTHORIZED</span>. Through the real dns.quad9.net: <span className="chip chip-green">accepted, EXTERNAL_TOKEN_MATCH, AD=1</span>. Check it yourself: <code>dig +short TXT dns.splittrust.zivkovic.me._splitdns-challenge.zivkovic.me</code> and <code>dig +short zivkovic.me DS</code>.</p>
    </div>
  );
}
