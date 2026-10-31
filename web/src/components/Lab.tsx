/* "The lab, right now": every container probed from the app every few seconds. */

import { useEffect, useState } from "react";
import { api, type LabProbe } from "../lib/api";
import { Slide } from "./Slide";
import { ProxyDecisions } from "./Terminal";

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
    <Slide section="Evidence" title="The network the laptops were on, probed from this page right now"
      sub="14 endpoints across the lab's services: DNS queries, TLS handshakes, HTTP requests, every four seconds"
      right={probes && <span className={`rounded-md px-2.5 py-1 text-sm font-semibold ${ok === probes.length ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"}`}>{ok} / {probes.length} answering{at && `, ${new Date(at).toLocaleTimeString()}`}</span>}
      takeaway="This is the network the two laptops were on. Nothing in the scenes was recorded or mocked.">
      <div className="grid min-h-0 min-w-0 flex-1 gap-5 lg:grid-cols-[3fr_2fr]">
        <div className="flex min-w-0 flex-col gap-4">
          {(["demo", "testbed"] as const).map((g) => (
            <div key={g} className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex items-baseline gap-3">
                <span className="text-sm font-bold">{g === "demo" ? "Runs the scenes" : "Test bed"}</span>
                <span className="text-xs text-slate-500">{g === "demo" ? "the two networks' resolvers, the PvD server, the proxy, the pages" : "the RFC's corner cases: private root, lab zones, quad9.lab, banka.lab"}</span>
              </div>
              <div className="grid gap-x-6 gap-y-1.5 md:grid-cols-2">
                {(probes ?? []).filter((p) => p.group === g).map((p) => (
                  <div key={p.name} className="flex min-w-0 items-center gap-3" title={`${p.addr}: ${p.detail ?? ""}`}>
                    <span className={`h-3 w-3 shrink-0 rounded-full ${p.ok ? "bg-green-500" : "bg-red-500"}`} />
                    <span className="w-32 shrink-0 truncate text-sm font-semibold">{p.name}</span>
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{p.role.replace(/^[A-Za-z]+: /, "")}</span>
                    <span className="shrink-0 font-mono text-xs text-slate-400">{p.millis} ms</span>
                  </div>
                ))}
                {!probes && <div className="animate-pulse text-sm text-slate-400">probing...</div>}
              </div>
            </div>
          ))}
        </div>
        <ProxyDecisions since={0} limit={12} />
      </div>
    </Slide>
  );
}
