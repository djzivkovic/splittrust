/* "The lab, right now": every container probed from the app every few seconds. */

import { useEffect, useState } from "react";
import { api, type LabProbe } from "../lib/api";
import { Slide } from "./Slide";
import { ProxyLog, Terminal } from "./Terminal";

export function LabSlide() {
  const [probes, setProbes] = useState<LabProbe[] | null>(null);
  const [at, setAt] = useState<string>("");
  useEffect(() => {
    let stop = false;
    const tick = () => api.labStatus().then((r) => { if (!stop) { setProbes(r.probes); setAt(r.checked_at); } }).catch(() => undefined);
    tick();
    const id = window.setInterval(tick, 4000);
    return () => { stop = true; window.clearInterval(id); };
  }, []);
  const ok = probes?.filter((p) => p.ok).length ?? 0;
  return (
    <Slide section="The lab" title="Fourteen containers, probed from this page right now"
      sub="DNS queries, TLS handshakes and HTTP requests to each one, every four seconds"
      right={probes && <span className={`rounded-md px-2.5 py-1 text-sm font-semibold ${ok === probes.length ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{ok} / {probes.length} answering{at && `, ${new Date(at).toLocaleTimeString()}`}</span>}
      takeaway="This is the network the two laptops were on. Nothing in the scenes was recorded or mocked.">
      <div className="grid min-h-0 flex-1 gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="grid content-start gap-2 md:grid-cols-2">
          {(probes ?? []).map((p) => (
            <div key={p.name} className={`flex items-start gap-3 rounded-xl border bg-white px-3 py-2 shadow-sm ${p.ok ? "border-slate-200" : "border-red-300"}`}>
              <span className={`mt-1.5 h-3 w-3 shrink-0 rounded-full ${p.ok ? "bg-green-500" : "bg-red-500"}`} />
              <div className="min-w-0">
                <div className="flex items-baseline gap-2"><span className="font-semibold">{p.name}</span><code className="text-xs text-slate-500">{p.addr}</code><span className="ml-auto text-xs text-slate-400">{p.millis} ms</span></div>
                <div className="text-sm text-slate-600">{p.role}</div>
                <div className="truncate font-mono text-[11px] text-slate-500" title={p.detail}>{p.detail}</div>
              </div>
            </div>
          ))}
          {!probes && <div className="animate-pulse text-slate-400">probing...</div>}
        </div>
        <Terminal title="splittrust proxy, live log (172.30.97.60)"><ProxyLog since={0} /></Terminal>
      </div>
    </Slide>
  );
}
