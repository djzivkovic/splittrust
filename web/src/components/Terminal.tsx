/* Terminal-styled panels showing what really happened on the wire: dig-format responses and
   the SplitTrust proxy's live log as the client container's queries hit it. */

import { useEffect, useState } from "react";
import { api, type Lookup } from "../lib/api";

export function Terminal({ title, children, className = "" }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-md ${className}`}>
      <div className="flex items-center gap-2 border-b border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300">
        <span className="h-2.5 w-2.5 rounded-full bg-red-400" /><span className="h-2.5 w-2.5 rounded-full bg-amber-400" /><span className="h-2.5 w-2.5 rounded-full bg-green-400" />
        <span className="ml-2 font-semibold">{title}</span>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[11px] leading-[1.45] text-slate-100">{children}</pre>
    </div>
  );
}

/* Colour a dig transcript: prompt, status, EDE and records. */
export function Dig({ l }: { l: Lookup | null }) {
  if (!l?.dig) return <span className="text-slate-500">waiting for the lookup...</span>;
  return <>{l.dig.split("\n").map((line, i) => <div key={i} className={line.startsWith("$") ? "text-green-300" : line.includes("status: SERVFAIL") || line.startsWith(";; EDE") ? "text-red-300" : line.includes("status: NOERROR") ? "text-emerald-200" : line.startsWith(";;") ? "text-slate-400" : "text-sky-200"}>{line}</div>)}</>;
}

/* The proxy's log, polled while the panel is visible. */
export function ProxyLog({ since }: { since: number }) {
  const [lines, setLines] = useState<string[]>([]);
  useEffect(() => {
    let stop = false;
    const tick = () => api.clientLog().then((r) => { if (!stop) setLines(r.lines.slice(-14)); }).catch(() => undefined);
    tick();
    const id = window.setInterval(tick, 1500);
    return () => { stop = true; window.clearInterval(id); };
  }, [since]);
  if (!lines.length) return <span className="text-slate-500">connecting to the proxy at 172.30.97.60:8001...</span>;
  return <>{lines.map((l, i) => <div key={i} className={l.includes("rejected") || l.includes("SERVFAIL") ? "text-red-300" : l.includes("accepted") || l.includes("NOERROR") ? "text-emerald-200" : l.includes("joined") ? "text-sky-200" : "text-slate-300"}>{l}</div>)}</>;
}
