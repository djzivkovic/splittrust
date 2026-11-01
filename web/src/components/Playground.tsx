import { useState } from "react";
import { RecordBuilder } from "./RecordBuilder";
import { LiveTerminal } from "./LiveTerminal";

export function Playground() {
  const [tab, setTab] = useState<"terminal" | "owner">("terminal");
  return (
    <div className="min-h-screen bg-slate-100 text-slate-900">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-blue-700">SplitTrust / live playground</p>
            <h1 className="mt-1 text-3xl font-bold tracking-tight">Try SplitTrust</h1>
            <p className="mt-1 text-sm text-slate-600">Run real lab commands. Inspect the evidence. No changes to your device's DNS or public records.</p>
          </div>
          <nav aria-label="Presentation navigation" className="flex flex-wrap gap-2">
            {([["/", "Back to presentation"], ["/#appendix", "Go to appendix"]] as const).map(([href, label]) => (
              <a key={href} href={href} className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-semibold hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-blue-700">
                {label}
              </a>
            ))}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-6 py-6">
        <div role="tablist" aria-label="Playground tools" className="mb-6 flex flex-wrap gap-2">
          {([
            ["terminal", "Live terminal"], ["owner", "Build a record"],
          ] as const).map(([value, label]) => (
            <button key={value} id={`tab-${value}`} role="tab" aria-selected={tab === value}
              aria-controls={`panel-${value}`} onClick={() => setTab(value)}
              className={`rounded-lg px-5 py-2.5 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 ${tab === value ? "bg-slate-900 text-white" : "bg-white text-slate-600 hover:bg-slate-200"}`}>
              {label}
            </button>
          ))}
        </div>
        <div id="panel-terminal" role="tabpanel" aria-labelledby="tab-terminal" hidden={tab !== "terminal"}>
          <LiveTerminal />
        </div>
        <div id="panel-owner" role="tabpanel" aria-labelledby="tab-owner" hidden={tab !== "owner"}>
          <RecordBuilder />
        </div>
      </main>
    </div>
  );
}
