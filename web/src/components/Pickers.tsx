import type { Device, Summary } from "../lib/api";
import { DEVICES, NETWORKS, type NetworkGroup } from "../lib/networks";

/* Segmented control for the device, with the selected device's one-paragraph description. */
export function DevicePicker({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  const selected = DEVICES.find((d) => d.id === value) ?? DEVICES[0];
  return (
    <div className="card">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-slate-300 bg-slate-50 p-1" role="radiogroup" aria-label="Device">
          {DEVICES.map((d, i) => {
            const on = d.id === value;
            return (
              <button key={d.id} role="radio" aria-checked={on} onClick={() => onChange(d.id)}
                className={`rounded-md px-4 py-2 text-sm font-semibold transition ${on ? "bg-white text-slate-900 shadow-sm ring-1 ring-slate-200" : "text-slate-600 hover:text-slate-900"}`}>
                <span className="kbd mr-2">{i + 1}</span>{d.name}
                <span className="ml-2 hidden font-normal text-slate-500 md:inline">{d.short}</span>
              </button>
            );
          })}
        </div>
        <code className="text-xs text-slate-500">{selected.id}</code>
      </div>
      <p className="mt-3 text-sm text-slate-700">{selected.blurb}</p>
    </div>
  );
}

/* One card per network; networks with several variants show them as pills. */
export function NetworkPicker({ value, onChange, summaries }: { value: string; onChange: (id: string) => void; summaries: Summary[] }) {
  const known = new Set(summaries.map((s) => s.id));
  const groupOf = (id: string): NetworkGroup | undefined => NETWORKS.find((g) => g.variants.some((v) => v.id === id));
  const activeGroup = groupOf(value);
  return (
    <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
      {NETWORKS.map((g) => {
        const variants = g.variants.filter((v) => known.has(v.id));
        if (variants.length === 0) return null;
        const on = activeGroup?.key === g.key;
        return (
          <div key={g.key} role="button" tabIndex={0}
            className={`card cursor-pointer transition ${on ? "border-blue-600 ring-2 ring-blue-100" : "hover:border-slate-400"}`}
            onClick={() => !on && onChange(variants[0].id)}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(variants[0].id); }}>
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold leading-tight">{g.name}</div>
              {g.requiresInternet && <span className="chip chip-yellow">real</span>}
            </div>
            <p className="mt-1 text-xs text-slate-500">{g.tagline}</p>
            {variants.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {variants.map((v) => (
                  <button key={v.id} onClick={(e) => { e.stopPropagation(); onChange(v.id); }}
                    className={`rounded-md px-2 py-1 text-xs font-medium transition ${v.id === value ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
