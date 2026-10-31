import type { Device } from "../lib/api";
import { DEVICES } from "../lib/networks";

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
