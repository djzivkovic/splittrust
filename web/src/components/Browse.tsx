import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { api, type BrowseResult, type Lookup } from "../lib/api";
import { suggestions } from "../lib/networks";

function Result({ title, l, accent }: { title: string; l: Lookup; accent: string }) {
  const failed = !!l.error || l.answers.length === 0;
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`card border-2 ${accent}`}>
      <div className="flex items-center justify-between text-xs text-slate-400"><span className="font-semibold text-slate-200">{title}</span><span>{l.millis} ms</span></div>
      <div className="mt-1 text-xs text-slate-500">{l.via}</div>
      {failed ? (
        <div className="mt-3">
          <div className="text-2xl font-black text-rose-300">cannot resolve</div>
          <div className="mt-1 font-mono text-sm text-slate-300">{l.error ?? `${l.rcode}${l.ad ? " ad" : ""}`}</div>
          {l.ede && <div className="mt-1 text-sm text-amber-200">{l.ede}</div>}
        </div>
      ) : (
        <div className="mt-3">
          <div className={`text-xl font-black leading-snug ${l.page?.startsWith("FAKE") ? "text-rose-300" : "text-emerald-200"}`}>{l.page ?? l.page_error ?? "(no page)"}</div>
          <div className="mt-2 font-mono text-xs text-slate-400">{l.answers.join(", ")} · {l.rcode}{l.ad ? " · AD (validated)" : ""}</div>
          {l.ede && <div className="mt-1 text-xs text-slate-400">{l.ede}</div>}
        </div>
      )}
    </motion.div>
  );
}

export function Browse({ scenarioId, hotel, disabled }: { scenarioId: string; hotel: boolean; disabled?: boolean }) {
  const [name, setName] = useState(suggestions(scenarioId)[0]);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<BrowseResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { setName(suggestions(scenarioId)[0]); setRes(null); setErr(null); }, [scenarioId]);

  const go = async (n = name) => {
    setBusy(true); setErr(null); setRes(null);
    try { setRes(await api.browse(n, hotel)); } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); go(); }}>
        <span className="font-mono text-slate-400">http://</span>
        <input className="input max-w-md flex-1" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} disabled={disabled} />
        <button className="btn btn-primary" disabled={busy || disabled}>{busy ? "resolving…" : "Go"}</button>
        <span className="text-xs text-slate-500">try:</span>
        {suggestions(scenarioId).map((s) => (
          <button type="button" key={s} className="btn btn-ghost px-2 py-1 text-xs" disabled={disabled} onClick={() => { setName(s); go(s); }}>{s}</button>
        ))}
      </form>
      {disabled && <p className="mt-3 text-sm text-amber-200">The real-Internet network cannot be browsed from the console (the lab app has no Internet access). Use the terminal command on the About page.</p>}
      {err && <p className="mt-3 text-sm text-rose-300">{err}</p>}
      <AnimatePresence>
        {res && (
          <div className={`mt-4 grid gap-4 ${res.naive ? "md:grid-cols-2" : ""}`}>
            <Result title="Your device — through SplitTrust" l={res.device} accent={res.device.answers.length ? "border-emerald-500/40" : "border-rose-500/40"} />
            {res.naive && <Result title="A naive device on the same Wi-Fi — the hotel's DNS" l={res.naive} accent={res.naive.page?.startsWith("FAKE") ? "border-rose-500/40" : "border-slate-700"} />}
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
