/* What really happened on the wire, in a readable form: the proxy's decisions as structured rows,
   and, on demand, the real responses in dig format at full width. */

import { useEffect, useState } from "react";
import { api, type Lookup, type ProxyEvent } from "../lib/api";

const rcodeTone = (r: string) => r === "NOERROR" ? "bg-green-100 text-green-800" : r === "SERVFAIL" ? "bg-red-100 text-red-800" : "bg-slate-200 text-slate-700";

/* One row per proxy event, newest first, trimmed to what a reader needs. */
export function ProxyDecisions({ since, limit = 4 }: { since: number; limit?: number }) {
  const [events, setEvents] = useState<ProxyEvent[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = () => api.clientEvents().then((r) => { if (!stop) setEvents(r.events.slice(-limit).reverse()); }).catch(() => undefined);
    tick();
    const id = window.setInterval(tick, 1500);
    return () => { stop = true; window.clearInterval(id); };
  }, [since, limit]);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border-2 border-slate-200 bg-white shadow-md">
      <div className="flex items-center gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
        <span className="h-2 w-2 animate-pulse rounded-full bg-green-500" /> SplitTrust proxy, live: what it decided for the laptop's queries
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {events.length === 0 && <div className="p-3 text-sm text-slate-400">waiting for the proxy at 172.30.97.60...</div>}
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 border-b border-slate-100 px-3 py-2 text-sm last:border-0">
            <span className="w-14 shrink-0 font-mono text-xs text-slate-400">{new Date(e.time).toLocaleTimeString([], { hour12: false })}</span>
            {e.kind === "join" && <><span className="chip chip-blue">joined</span><span className="text-slate-700">network <code>{e.scenario}</code> as {e.device === "private-dns" ? "phone" : "laptop"}</span></>}
            {e.kind === "verify" && <><span className={`chip ${e.decision === "accepted" ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}>{e.decision}</span><span className="text-slate-700">claim by <code>{e.resolver}</code>: <b>{e.reason}</b></span></>}
            {e.kind === "query" && (
              <>
                <span className={`chip ${rcodeTone(e.rcode ?? "")}`}>{e.rcode}{e.ad ? " AD" : ""}</span>
                <span className="min-w-0 text-slate-700">
                  <code>{e.name}</code> {e.qtype}
                  {e.ede ? <span className="ml-2 text-slate-500">EDE {e.ede} ({e.ede_name})</span> : null}
                  {e.text && <div className="truncate text-xs text-slate-500" title={e.text}>{shorten(e.text)}</div>}
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function shorten(t: string): string {
  return t.replace(/^RFC 9704: /, "").replace(/^DNSSEC validation failed: validation failure <[^>]*>: /, "DNSSEC: ").replace(/ while building chain of trust$/, "");
}

/* Full-width dig transcripts, side by side. */
export function DigPanel({ left, right, leftTitle, rightTitle }: { left: Lookup | null; right: Lookup | null; leftTitle: string; rightTitle: string }) {
  const block = (title: string, l: Lookup | null) => (
    <div className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900">
      <div className="border-b border-slate-700 bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-300">{title}</div>
      <pre className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap break-all p-3 font-mono text-[12px] leading-relaxed text-slate-100">
        {!l?.dig ? <span className="text-slate-500">waiting for the lookup...</span> : l.dig.split("\n").map((line, i) => (
          <div key={i} className={line.startsWith("$") ? "text-green-300" : line.includes("status: SERVFAIL") || line.startsWith(";; EDE") ? "text-red-300" : line.includes("status: NOERROR") ? "text-emerald-200" : line.startsWith(";;") ? "text-slate-400" : "text-sky-200"}>{line}</div>
        ))}
      </pre>
    </div>
  );
  return <div className="grid h-full min-h-0 min-w-0 grid-cols-2 gap-4">{block(leftTitle, left)}{block(rightTitle, right)}</div>;
}
