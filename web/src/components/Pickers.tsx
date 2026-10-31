import { motion } from "framer-motion";
import type { Device, Summary } from "../lib/api";
import { DEVICES, NETWORKS, type NetworkGroup } from "../lib/networks";

export function DevicePicker({ value, onChange }: { value: Device; onChange: (d: Device) => void }) {
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {DEVICES.map((d, i) => {
        const on = d.id === value;
        return (
          <motion.button key={d.id} whileHover={{ y: -2 }} whileTap={{ scale: 0.98 }} onClick={() => onChange(d.id)}
            className={`card text-left transition ${on ? "border-sky-400 ring-2 ring-sky-400/40" : "hover:border-slate-600"}`}>
            <div className="flex items-center gap-3">
              <span className="text-3xl">{d.icon}</span>
              <div>
                <div className="font-bold">{d.name}</div>
                <div className="text-xs text-slate-400"><span className="kbd">{i + 1}</span> {d.id}</div>
              </div>
            </div>
            <p className="mt-3 text-sm text-slate-300">{d.blurb}</p>
          </motion.button>
        );
      })}
    </div>
  );
}

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
          <motion.div key={g.key} whileHover={{ y: -2 }}
            className={`card cursor-pointer transition ${on ? "border-sky-400 ring-2 ring-sky-400/40" : "hover:border-slate-600"}`}
            onClick={() => !on && onChange(variants[0].id)} role="button" tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onChange(variants[0].id); }}>
            <div className="flex items-center gap-2">
              <span className="text-2xl">{g.icon}</span>
              <div className="font-bold leading-tight">{g.ssid}</div>
              {g.requiresInternet && <span className="chip chip-yellow ml-auto">real</span>}
            </div>
            <p className="mt-2 text-xs text-slate-400">{g.tagline}</p>
            {variants.length > 1 && (
              <div className="mt-3 flex flex-wrap gap-1">
                {variants.map((v) => (
                  <button key={v.id} onClick={(e) => { e.stopPropagation(); onChange(v.id); }}
                    className={`rounded-lg px-2 py-1 text-xs font-semibold transition ${v.id === value ? "bg-sky-500 text-sky-950" : "bg-slate-800 text-slate-200 hover:bg-slate-700"}`}>
                    {v.label}
                  </button>
                ))}
              </div>
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
