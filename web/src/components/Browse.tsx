import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { api, type BrowseResult, type Lookup } from "../lib/api";

export function Result({ title, l }: { title: string; l: Lookup }) {
  const failed = !!l.error || l.answers.length === 0;
  const fake = l.page?.startsWith("FAKE");
  const box = failed ? "border-slate-300" : fake ? "border-red-300 bg-red-50" : "border-green-300 bg-green-50";
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`rounded-xl border-2 bg-white p-4 ${box}`}>
      <div className="flex items-center justify-between text-xs text-slate-500"><span className="font-semibold text-slate-800">{title}</span><span>{l.millis} ms</span></div>
      <div className="mt-1 text-xs text-slate-500">resolver: {l.via}</div>
      {failed ? (
        <div className="mt-3">
          <div className="text-xl font-bold text-slate-800">Cannot resolve the name</div>
          <div className="mt-1 font-mono text-sm text-slate-600">{l.error ?? `${l.rcode}${l.ad ? " ad" : ""}`}</div>
          {l.ede && <div className="mt-1 text-sm text-slate-700">{l.ede}</div>}
          <div className="mt-2 text-sm text-slate-600">The page is never requested. A validating device fails safely instead of talking to an unverified server.</div>
        </div>
      ) : (
        <div className="mt-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{l.page_url ? `Fetched ${l.page_url}` : "Page returned"}</div>
          <div className={`mt-1 text-lg font-semibold leading-snug ${fake ? "text-red-800" : "text-green-800"}`}>{l.page ?? l.page_error ?? "(no page)"}</div>
          <div className="mt-2 font-mono text-xs text-slate-500">{l.answers.join(", ")}; {l.rcode}{l.ad ? "; AD set (validated)" : ""}</div>
          {l.ede && <div className="mt-1 text-xs text-slate-500">{l.ede}</div>}
        </div>
      )}
    </motion.div>
  );
}

function suggestions(scenarioId: string): string[] {
  if (scenarioId.startsWith("real-")) return ["host.internal.splittrust.zivkovic.me", "www.zivkovic.me", "intranet.beta.example"];
  if (scenarioId.startsWith("hotel")) return ["www.banka.lab", "host.internal.corp.lab"];
  return ["host.internal.corp.lab", "host.mail.corp.lab", "www.corp.lab"];
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
        <span className="font-mono text-sm text-slate-500">http://</span>
        <input className="input max-w-md flex-1" value={name} onChange={(e) => setName(e.target.value)} spellCheck={false} disabled={disabled} aria-label="Name to resolve" />
        <button className="btn btn-primary" disabled={busy || disabled}>{busy ? "Resolving..." : "Open"}</button>
        <span className="ml-2 text-xs text-slate-500">Suggestions:</span>
        {suggestions(scenarioId).map((s) => (
          <button type="button" key={s} className="btn btn-ghost px-2 py-1 text-xs" disabled={disabled} onClick={() => { setName(s); go(s); }}>{s}</button>
        ))}
      </form>
      {disabled && <p className="mt-3 text-sm text-slate-600">The real-Internet network cannot be browsed from this console: the console's container has no Internet access by design. See the terminal commands above.</p>}
      {err && <p className="mt-3 text-sm text-red-700">{err}</p>}
      {res && (
        <div className={`mt-4 grid gap-4 ${res.naive ? "md:grid-cols-2" : ""}`}>
          <Result title="This device, resolving through SplitTrust" l={res.device} />
          {res.naive && <Result title="A device without SplitTrust on the same Wi-Fi (hotel DNS)" l={res.naive} />}
        </div>
      )}
    </div>
  );
}
