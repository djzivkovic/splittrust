/* SplitTrust demo deck. Title, Monday, Tuesday, what Alfa did. Arrow keys move; space replays;
   1 and 2 switch Alfa's device; e shows the raw evidence. Every verdict and page on screen is live. */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api, type BrowseResult, type Device, type LiveRecord, type Run, type Summary } from "./lib/api";
import { ALFA, BETA, REASONS, SCENES, type Scene } from "./lib/deck";
import { SceneArt, stepsFor } from "./components/SceneArt";
import { BrowserFrame } from "./components/Browser";
import { BLUE, Doc, GREEN, INK, Laptop, Lock, Mark, RED, Resolver, Shield } from "./components/Art";

const BEAT_MS = 950;

export default function App() {
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [err, setErr] = useState("");
  const [slide, setSlide] = useState(0);
  const [device, setDevice] = useState<Device>("validating-stub");
  const [evidence, setEvidence] = useState(false);
  useEffect(() => { api.scenarios().then(setSummaries).catch((e) => setErr((e as Error).message)); }, []);

  const total = SCENES.length + 1;
  const go = useCallback((n: number) => { setSlide(Math.max(0, Math.min(total - 1, n))); setDevice("validating-stub"); }, [total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown") go(slide + 1);
      if (e.key === "ArrowLeft" || e.key === "PageUp") go(slide - 1);
      if (e.key === "Home") go(0);
      if (e.key === "1") setDevice("validating-stub");
      if (e.key === "2") setDevice("private-dns");
      if (e.key === "e") setEvidence((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [slide, go]);

  if (err) return <Center><div className="text-red-700">Cannot reach the API: {err}</div></Center>;
  if (!summaries) return <Center><div className="text-slate-400">Loading...</div></Center>;

  const scene = slide > 0 ? SCENES[slide - 1] : null;
  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-900">
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          <motion.div key={slide} initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={{ duration: 0.25 }} className="h-full">
            {scene ? <SceneSlide scene={scene} device={device} evidence={evidence} /> : <TitleSlide />}
          </motion.div>
        </AnimatePresence>
      </div>
      <footer className="flex items-center gap-4 border-t border-slate-200 bg-white px-6 py-2 text-xs text-slate-500">
        <span className="font-semibold text-slate-700">SplitTrust</span>
        <span className="flex gap-1.5">{Array.from({ length: total }, (_, i) => <button key={i} onClick={() => go(i)} className={`h-2.5 w-2.5 rounded-full ${i === slide ? "bg-slate-900" : "bg-slate-300"}`} aria-label={`slide ${i + 1}`} />)}</span>
        {scene && scene.id !== "real-replay" && (
          <span className="ml-4 inline-flex items-center gap-1">Alfa's device
            {(["validating-stub", "private-dns"] as Device[]).map((d, i) => (
              <button key={d} onClick={() => setDevice(d)} className={`rounded px-2 py-0.5 font-semibold ${device === d ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-600"}`}><span className="kbd mr-1">{i + 1}</span>{d === "private-dns" ? "phone" : "laptop"}</button>
            ))}
          </span>
        )}
        <span className="ml-auto"><span className="kbd">←</span> <span className="kbd">→</span> slides <span className="kbd ml-2">space</span> replay <span className="kbd ml-2">e</span> evidence</span>
      </footer>
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) { return <div className="flex h-screen items-center justify-center bg-slate-100 text-lg">{children}</div>; }

function TitleSlide() {
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col justify-center px-10">
      <div className="text-sm font-semibold uppercase tracking-widest text-blue-700">RFC 9704, implemented</div>
      <h1 className="mt-3 text-6xl font-bold tracking-tight">Who may answer for your domain<br />inside a network?</h1>
      <p className="mt-5 text-2xl text-slate-600">Two companies, one week.</p>
      <div className="mt-12 grid grid-cols-2 gap-8">
        <Company name={BETA.name} domain={BETA.domain} adopted={false} line="Trusts whatever resolver the network hands out." />
        <Company name={ALFA.name} domain={ALFA.domain} adopted line="Checks, against the real DNS, that the resolver is allowed to answer." />
      </div>
    </div>
  );
}

function Company({ name, domain, adopted, line }: { name: string; domain: string; adopted: boolean; line: string }) {
  return (
    <div className={`flex items-center gap-6 rounded-2xl border-2 bg-white p-6 shadow-sm ${adopted ? "border-blue-300" : "border-slate-200"}`}>
      <svg viewBox="-70 -60 140 120" className="h-28 w-32 shrink-0">
        <g transform="translate(0,6)"><Laptop tone={adopted ? BLUE : INK} /></g>
        {adopted && <g transform="translate(44,-30)"><Shield /></g>}
      </svg>
      <div>
        <div className="flex items-baseline gap-3"><span className="text-3xl font-bold">{name}</span><code className="text-sm text-slate-500">{domain}</code></div>
        <div className={`mt-1 text-sm font-semibold ${adopted ? "text-blue-700" : "text-slate-500"}`}>{adopted ? "uses SplitTrust" : "no SplitTrust"}</div>
        <p className="mt-2 text-lg text-slate-700">{line}</p>
      </div>
    </div>
  );
}

/* A scene: headline, the drawing animating the real checks, then what each employee sees. */
function SceneSlide({ scene, device, evidence }: { scene: Scene; device: Device; evidence: boolean }) {
  const [run, setRun] = useState<Run | null>(null);
  const [alfa, setAlfa] = useState<BrowseResult | null>(null);
  const [beta, setBeta] = useState<BrowseResult | null>(null);
  const [live, setLive] = useState<LiveRecord | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [at, setAt] = useState(-1);
  const timer = useRef<number | null>(null);
  const recipe = scene.id === "real-replay";
  const phoneOff = device === "private-dns" && scene.place === "hotel";
  const alfaName = phoneOff ? ALFA.site : scene.alfaName;

  useEffect(() => {
    let cancelled = false;
    setRun(null); setAlfa(null); setBeta(null); setError(null); setAt(-1);
    api.clientJoin(scene.id, device).catch(() => undefined).then(() => Promise.all([
      api.verify(scene.id, device),
      api.browse(alfaName, false),
      api.browse(scene.betaName, true, scene.betaDNS),
      recipe ? api.live("real-office") : Promise.resolve(null),
    ])).then(([r, a, b, l]) => { if (!cancelled) { setRun(r); setAlfa(a); setBeta(b); setLive(l); } })
      .catch((e) => { if (!cancelled) setError((e as Error).message); });
    return () => { cancelled = true; };
  }, [scene, device, alfaName, recipe]);

  const alfaReached = alfa ? !alfa.device.error && alfa.device.answers.length > 0 : null;
  const steps = useMemo(() => (run ? stepsFor(scene.place, run, alfaReached, phoneOff) : []), [run, scene.place, alfaReached, phoneOff]);

  const play = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    setAt(-1);
    let i = -1;
    const tick = () => { i += 1; setAt(i); if (i < steps.length - 1) timer.current = window.setTimeout(tick, BEAT_MS); };
    timer.current = window.setTimeout(tick, 400);
  }, [steps.length]);

  useEffect(() => { if (steps.length && !recipe) play(); return () => { if (timer.current) window.clearTimeout(timer.current); }; }, [steps.length, play, recipe]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === " " && steps.length) { e.preventDefault(); play(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [steps.length, play]);

  const done = steps.length > 0 && at >= steps.length - 1;
  const claim = run?.claims[0];

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col px-8 pt-5">
      <div className="flex items-baseline gap-4">
        <span className="rounded-md bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">{scene.day}</span>
        <h2 className="text-3xl font-bold tracking-tight">{scene.headline}</h2>
        <span className="text-lg text-slate-500">{scene.sub}</span>
        {claim && <span className={`ml-auto rounded-md px-2.5 py-1 text-sm font-semibold ${claim.decision === "accepted" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>Alfa: {REASONS[claim.reason] ?? claim.reason}</span>}
      </div>

      {error && <div className="mt-6 rounded-xl border border-red-300 bg-red-50 p-4 text-red-800">{error}</div>}

      {recipe ? (
        <Recipe live={live} claim={claim ?? null} />
      ) : (
        <>
          <div className="mt-2 flex-1">
            <SceneArt place={scene.place} device={device} steps={steps} at={at} resolverName="dns.splittrust.zivkovic.me" />
          </div>
          <div className="grid grid-cols-2 gap-6 pb-4">
            <div className={`transition-opacity ${done ? "opacity-100" : "opacity-0"}`}>
              <BrowserFrame who={`${BETA.name}'s laptop`} url={`http://${scene.betaName}/`} l={beta?.naive ?? null} tone="beta" />
            </div>
            <div className={`transition-opacity ${done ? "opacity-100" : "opacity-0"}`}>
              <BrowserFrame who={`${ALFA.name}'s ${device === "private-dns" ? "phone" : "laptop"}`} url={`${phoneOff ? "https" : "http"}://${alfaName}/`} l={alfa?.device ?? null} tone="alfa" />
            </div>
          </div>
          <AnimatePresence>
            {done && <motion.p initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="pb-4 text-center text-xl font-medium text-slate-800">{scene.takeaway}</motion.p>}
          </AnimatePresence>
        </>
      )}

      {evidence && claim && <Evidence claim={claim} />}
    </div>
  );
}

/* Slide 4: the three things Alfa did, with the real zone's records as they are right now. */
function Recipe({ live, claim }: { live: LiveRecord | null; claim: Run["claims"][number] | null }) {
  const txt = live?.txt.answer?.[0]?.split(/\s+/).slice(-1)[0]?.replace(/"/g, "");
  const ds = live?.ds.answer?.[0]?.split(/\s+/).slice(3).join(" ");
  const tile = (icon: React.ReactNode, title: string, sub: React.ReactNode) => (
    <div className="flex flex-col items-center rounded-2xl border-2 border-slate-200 bg-white p-6 text-center shadow-sm">
      <svg viewBox="-50 -50 100 100" className="h-24 w-24">{icon}</svg>
      <div className="mt-3 text-2xl font-bold">{title}</div>
      <div className="mt-2 min-h-12 w-full break-all font-mono text-xs text-slate-500">{sub}</div>
    </div>
  );
  return (
    <div className="mt-8 flex flex-1 flex-col">
      <div className="grid grid-cols-3 gap-6">
        {tile(<><g transform="translate(0,4) scale(1.6)"><Lock tone={GREEN} /></g><g transform="translate(26,-22)"><Mark ok size={10} /></g></>, "Sign the zone",
          live ? <>DNSSEC at Cloudflare, DS at the .me registry<br />{live.ds.security}: {ds ?? "no DS"}</> : "checking the real zone...")}
        {tile(<g transform="scale(1.3)"><Doc tone={BLUE} /></g>, "Publish one record",
          live ? <>{live.record_owner}<br />TXT "token={txt ?? "?"}"<br />{live.txt.security}</> : "...")}
        {tile(<><g transform="translate(-6,8) scale(0.9)"><Laptop tone={BLUE} /></g><g transform="translate(30,-18)"><Shield /></g></>, "Devices that check",
          <>a resolver that verifies the network's claim<br />before trusting it with the company's names</>)}
      </div>
      <div className="mt-8 flex items-center gap-6 rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
        <svg viewBox="-80 -50 160 100" className="h-28 w-48 shrink-0">
          <g transform="translate(-20,0)"><Resolver hostile /></g>
          <text x={-20} y={-36} textAnchor="middle" fontSize={11} fontWeight={700} fill={INK}>"I am dns.splittrust.zivkovic.me"</text>
          <text x={-20} y={44} textAnchor="middle" fontSize={11} fill={RED} fontFamily="ui-monospace, Menlo, monospace">certificate: dns.hotel.lab</text>
          <g transform="translate(58,0)"><Mark ok={false} size={16} /></g>
        </svg>
        <div>
          <div className="text-2xl font-bold">The record is public. Can it be copied?</div>
          <p className="mt-1 text-lg text-slate-700">Yes. A hotel copied Alfa's claim word for word. Alfa's laptop asked the resolver to prove its name first: {claim ? <b className={claim.decision === "rejected" ? "text-red-700" : "text-green-700"}>{REASONS[claim.reason] ?? claim.reason}</b> : "..."}. No DNS query was ever sent to it.</p>
        </div>
      </div>
      <p className="mt-auto pb-6 text-center text-xl font-medium text-slate-800">{SCENES[2].takeaway}</p>
    </div>
  );
}

/* Raw evidence for the curious: the query as dig would print it, and the certificate. */
function Evidence({ claim }: { claim: Run["claims"][number] }) {
  const ev = (id: string) => (claim.stages.find((s) => s.id === id)?.evidence ?? {}) as Record<string, unknown>;
  const pub = ev("public_dnssec"), ext = ev("external_resolver"), tls = ev("resolver_tls");
  const cert = tls.certificate as { subject?: string; sans?: string[] } | undefined;
  const lines = [
    ...(pub.security ? [`;; ${pub.qname as string} TXT via ${(pub.forwarder as string) ?? "iterative"}`, `;; DNSSEC: ${pub.security as string}${pub.why ? `: ${pub.why as string}` : ""}`, ...((pub.answer as string[]) ?? [])] : []),
    ...(ext.rcode ? [`;; via dns.quad9.net: ${ext.rcode as string}, AD=${String(ext.ad)}`, ...((ext.answers as string[]) ?? [])] : []),
    tls.server_name ? `;; TLS: announced ${tls.server_name as string}, certificate ${cert?.subject ?? "n/a"} (SANs: ${cert?.sans?.join(", ") ?? "n/a"})` : "",
    `;; verdict: ${claim.decision} ${claim.reason}`,
  ].filter(Boolean);
  return <pre className="mb-3 max-h-40 overflow-auto rounded-lg bg-slate-900 p-3 font-mono text-[11px] leading-relaxed text-slate-100">{lines.join("\n")}</pre>;
}
