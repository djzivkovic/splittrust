/* The demo: two companies in the same situations, three scenes, three screens each.
   Arrow keys move through screens and scenes; 1/2/3 switch Alfa's device; space replays; n toggles notes. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, type BrowseResult, type Device, type LiveRecord, type Run, type Summary } from "../lib/api";
import { SCENES, STEP_NAMES, type Scene } from "../lib/scenes";
import { DEVICES } from "../lib/networks";
import { runTone } from "../lib/story";
import { FlowDiagram, beatsFor } from "../components/FlowDiagram";
import { Checklist, VerdictCard, RawTrace, toneChip } from "../components/Verdict";
import { ClaimView, CertView, DigView } from "../components/Evidence";
import { Result } from "../components/Browse";

const BEAT_MS = 1000;

function CompanyCard({ name, adopted, domain, text }: { name: string; adopted: boolean; domain: string; text: string }) {
  return (
    <div className={`card border-2 ${adopted ? "border-blue-200" : "border-slate-200"}`}>
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold">{name}</span>
        <code className="text-xs text-slate-500">{domain}</code>
        <span className={`chip ml-auto ${adopted ? "chip-green" : "chip-grey"}`}>{adopted ? "uses SplitTrust" : "no SplitTrust"}</span>
      </div>
      <p className="mt-2 text-slate-700">{text}</p>
    </div>
  );
}

export function Demo({ summaries }: { summaries: Summary[] }) {
  const scenes = useMemo(() => SCENES.filter((s) => summaries.some((x) => x.id === s.id)), [summaries]);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [step, setStep] = useState(0);
  const [device, setDevice] = useState<Device>("validating-stub");
  const [run, setRun] = useState<Run | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [played, setPlayed] = useState(-1);
  const [speed, setSpeed] = useState(1);
  const [notes, setNotes] = useState(false);
  const [evidence, setEvidence] = useState(false);
  const [alfa, setAlfa] = useState<BrowseResult | null>(null);
  const [beta, setBeta] = useState<BrowseResult | null>(null);
  const [browseErr, setBrowseErr] = useState<string | null>(null);
  const [live, setLive] = useState<LiveRecord | null>(null);
  const timer = useRef<number | null>(null);

  const scene: Scene = scenes[sceneIdx];
  const claim = run?.claims[0];
  const beats = useMemo(() => (run && claim ? beatsFor(claim, run.device, run.resolution) : []), [run, claim]);
  const playedStage = claim && played >= 0 ? claim.stages.indexOf(beats[Math.min(played, beats.length - 1)]?.stage) : -1;
  const done = beats.length > 0 && played >= beats.length - 1;

  const stop = () => { if (timer.current) { window.clearTimeout(timer.current); timer.current = null; } };
  const play = useCallback((n: number) => {
    stop(); setPlayed(-1);
    let i = -1;
    const tick = () => { i += 1; setPlayed(i); if (i < n - 1) timer.current = window.setTimeout(tick, BEAT_MS / speed); };
    timer.current = window.setTimeout(tick, 250);
  }, [speed]);

  const goScene = useCallback((i: number, s = 0) => { setSceneIdx(i); setStep(s); setDevice("validating-stub"); setAlfa(null); setBeta(null); setBrowseErr(null); setEvidence(false); }, []);

  const verify = useCallback(async (id: string, dev: Device) => {
    stop(); setRun(null); setError(null); setPlayed(-1); setAlfa(null); setBeta(null);
    setBusy(true);
    api.clientJoin(id, dev).catch(() => undefined);
    try { setRun(await api.verify(id, dev)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }, []);

  useEffect(() => { verify(scene.id, device); }, [scene.id, device, verify]);

  useEffect(() => {
    if (!run || !beats.length) return;
    if (step === 1) play(beats.length); else { stop(); setPlayed(beats.length - 1); }
    return stop;
  }, [run, beats.length, step, play]);

  // Screen 3: both companies' employees open their intranet, now. On the hotel scenes
  // Alfa's phone (Private DNS) opens the company's public site instead: the intranet
  // host only exists inside the office, and the point is that the phone reaches the
  // real site through Quad9 while Beta's laptop reaches the hotel's copy.
  const alfaName = device === "private-dns" && scene.id !== "real-office" ? scene.alfa.publicSite : scene.alfa.intranet;
  useEffect(() => {
    if (step !== 2 || !run) return;
    let cancelled = false;
    setAlfa(null); setBeta(null); setBrowseErr(null);
    Promise.all([
      api.browse(alfaName, false),
      api.browse(scene.beta.intranet, true, scene.beta.naiveDNS),
    ]).then(([a, b]) => { if (!cancelled) { setAlfa(a); setBeta(b); } }).catch((e) => { if (!cancelled) setBrowseErr((e as Error).message); });
    return () => { cancelled = true; };
  }, [step, scene, run, alfaName]);

  // Scene 3 shows the live state of the real zone.
  useEffect(() => {
    if (scene.id !== "real-replay") { setLive(null); return; }
    let cancelled = false;
    api.live("real-office").then((l) => { if (!cancelled) setLive(l); }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [scene.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "ArrowRight") { if (step < 2) setStep(step + 1); else goScene((sceneIdx + 1) % scenes.length); }
      if (e.key === "ArrowLeft") { if (step > 0) setStep(step - 1); else goScene((sceneIdx + scenes.length - 1) % scenes.length, 2); }
      if (e.key === "1") setDevice("validating-stub");
      if (e.key === "2") setDevice("private-dns");
      if (e.key === "3") setDevice("hybrid");
      if (e.key === "n") setNotes((v) => !v);
      if (e.key === "e") setEvidence((v) => !v);
      if (e.key === " " && step === 1 && beats.length) { e.preventDefault(); play(beats.length); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, sceneIdx, scenes.length, beats.length, play, goScene]);

  const tone = run ? runTone(run.claims, run.decision) : "grey";
  const deviceCard = DEVICES.find((d) => d.id === device)!;

  return (
    <div className="flex min-h-[calc(100vh-61px)] flex-col">
      <div className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-1 px-6 py-2">
          {scenes.map((s, i) => (
            <button key={s.id} onClick={() => goScene(i)} className={`rounded-md px-3 py-1.5 text-sm transition ${i === sceneIdx ? "bg-slate-900 font-semibold text-white" : "font-medium text-slate-700 hover:bg-slate-100"}`}>{s.title}</button>
          ))}
          <span className="ml-auto text-xs text-slate-500">Alfa's zone is the real <code className="text-slate-700">zivkovic.me</code>; verdicts are computed live against the real DNS</span>
        </div>
      </div>

      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center gap-3 px-6 pt-5">
        <div className="flex items-center gap-1">
          {STEP_NAMES.map((n, i) => (
            <button key={n} onClick={() => setStep(i)} className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${i === step ? "bg-blue-700 text-white" : i < step ? "bg-slate-200 text-slate-700" : "bg-slate-100 text-slate-500"}`}>{i + 1}. {n}</button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          {run && <span className={toneChip[tone]}>Alfa: {run.decision}</span>}
          <span className="inline-flex items-center gap-1">Alfa's device:
            {DEVICES.map((d, i) => (
              <button key={d.id} onClick={() => setDevice(d.id)} title={d.blurb}
                className={`rounded-md px-2 py-1 text-xs font-semibold transition ${d.id === device ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                <span className="kbd mr-1">{i + 1}</span>{d.name}
              </button>
            ))}
          </span>
          <span><span className="kbd">←</span> <span className="kbd">→</span></span>
          <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setNotes(!notes)}>Notes <span className="kbd ml-1">n</span></button>
        </div>
      </div>

      <div className="mx-auto w-full max-w-7xl flex-1 px-6 py-5">
        {step === 0 && (
          <div>
            <h1 className="text-3xl font-semibold leading-tight text-slate-900">{scene.title.replace(/^\d+\.\s*/, "")}</h1>
            <p className="mt-1 text-slate-500">{scene.when}</p>
            <p className="mt-4 text-2xl leading-snug text-slate-800">{scene.situation}</p>
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <CompanyCard name="Beta" adopted={false} domain={scene.beta.domain} text={scene.withoutTool} />
              <CompanyCard name="Alfa" adopted domain={scene.alfa.domain} text={scene.withTool} />
            </div>
            <div className="mt-4 grid gap-4 lg:grid-cols-[3fr_2fr]">
              <div className="card border-amber-200 bg-amber-50"><div className="text-xs font-semibold uppercase tracking-wide text-amber-700">Why it matters</div><p className="mt-1 text-lg text-slate-800">{scene.lesson}</p></div>
              <div className="card"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Check it yourself</div><code className="mt-1 block break-all text-sm text-slate-800">{scene.check}</code></div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold text-slate-900">Alfa's device checks the network's claim</h2>
              <span className="text-sm text-slate-500">Beta's device has nothing to check: it simply uses the resolver it was given.</span>
              <div className="ml-auto flex items-center gap-2">
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => setEvidence(!evidence)}>{evidence ? "Hide" : "Show"} evidence <span className="kbd ml-1">e</span></button>
                <button className="btn btn-ghost px-3 py-1 text-xs" onClick={() => beats.length && play(beats.length)} disabled={!beats.length}>Replay <span className="kbd ml-1">space</span></button>
                <select className="input w-auto py-1 text-xs" value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Animation speed">
                  <option value={0.6}>slow</option><option value={1}>normal</option><option value={2}>fast</option>
                </select>
              </div>
            </div>
            <div className="mt-4">
              {error ? <Err text={error} /> : busy || !run || !claim ? <Loading /> : (
                <div className="space-y-4">
                  <div className="grid gap-5 xl:grid-cols-[3fr_2fr]">
                    <div className="card">
                      <FlowDiagram claim={claim} device={run.device} resolution={run.resolution} beats={beats} playedUpTo={played}
                        parent={claim.inspection?.canonical_parent?.replace(/\.$/, "") ?? scene.alfa.domain} announced={claim.resolver} external="dns.quad9.net" real={run.trust_context === "global"} />
                      <p className="mt-2 text-xs text-slate-500">Alfa's device: {deviceCard.blurb} Trust anchor: {run.trust_context === "global" ? "the IANA root key" : "the lab root key"}.</p>
                    </div>
                    <div className="space-y-4">
                      <Checklist claim={claim} playedStageIndex={playedStage} />
                      <VerdictCard claim={claim} device={run.device} visible={done} />
                    </div>
                  </div>
                  {evidence && (
                    <div className="grid gap-4 lg:grid-cols-3">
                      <ClaimView claim={claim} compact />
                      <DigView claim={claim} />
                      <CertView claim={claim} />
                    </div>
                  )}
                  {evidence && <RawTrace stages={claim.stages} />}
                </div>
              )}
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">Both employees open their intranet</h2>
            <p className="mt-1 text-slate-600">Real DNS lookups and real page fetches, now. Beta's laptop asks the network's resolver directly. Alfa's laptop is a plain client whose DNS server is the SplitTrust proxy, which applies the verdict from the previous screen.</p>
            <div className="mt-4">
              {browseErr ? <Err text={browseErr} /> : !alfa || !beta ? <Loading text="Resolving and fetching for both companies..." /> : (
                <div className="grid gap-4 md:grid-cols-2">
                  <div>
                    <div className="mb-2 flex items-center gap-2"><span className="font-bold">Beta</span><span className="chip chip-grey">no SplitTrust</span><code className="text-xs text-slate-500">http://{scene.beta.intranet}</code></div>
                    {beta.naive ? <Result title="Beta's laptop, network resolver" l={beta.naive} /> : <Err text="no result" />}
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-2"><span className="font-bold">Alfa</span><span className="chip chip-green">uses SplitTrust</span><code className="text-xs text-slate-500">{alfaName === scene.alfa.publicSite ? "https" : "http"}://{alfaName}</code></div>
                    <Result title={`Alfa's ${deviceCard.name.toLowerCase()}, through SplitTrust`} l={alfa.device} />
                  </div>
                </div>
              )}
              {scene.id !== "real-office" && <p className="mt-3 text-sm text-slate-500">Press <span className="kbd">2</span> for Alfa's phone with Private DNS: it asks dns.quad9.net instead of the hotel and opens the real {scene.alfa.publicSite} (the intranet host only exists inside Alfa's office). Press <span className="kbd">1</span> to return to the laptop.</p>}
            </div>
            {scene.id === "real-replay" && live && (
              <div className="card mt-6">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">The real zone, right now (checked {new Date(live.checked_at).toLocaleTimeString()}, validated under the IANA root)</div>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap break-all font-mono text-[13px] leading-relaxed text-slate-800">{[
                  `;; ${live.record_owner} TXT   DNSSEC: ${live.txt.security}${live.txt.why ? ` (${live.txt.why})` : ""}`,
                  ...(live.txt.answer ?? [";; (no answer)"]),
                  `;; expected token: ${live.expected_token}`,
                  ``,
                  `;; ${live.parent} DS   DNSSEC: ${live.ds.security}`,
                  ...(live.ds.answer ?? [";; (no DS record: the zone is not signed at the registry)"]),
                ].join("\n")}</pre>
                <p className="mt-2 text-sm text-slate-600">What Alfa's IT did: enabled DNSSEC at Cloudflare and placed the DS record at the .me registry; built this TXT record with <code>splittrust build-record</code> and published it; installed the SplitTrust resolver on its devices.</p>
              </div>
            )}
          </div>
        )}
      </div>

      {notes && (
        <div className="border-t border-slate-200 bg-amber-50">
          <div className="mx-auto max-w-7xl px-6 py-3 text-sm text-slate-800"><span className="mr-2 text-xs font-semibold uppercase tracking-wide text-amber-700">Say</span>{scene.notes[step]}</div>
        </div>
      )}
    </div>
  );
}

function Loading({ text = "Verifying against the real DNS..." }: { text?: string }) { return <div className="card animate-pulse text-slate-500">{text}</div>; }
function Err({ text }: { text: string }) { return <div className="card border-red-300 text-red-800">{text}</div>; }
