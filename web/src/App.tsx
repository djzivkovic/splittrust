import { useEffect, useState } from "react";
import { BrowserRouter, Navigate, NavLink, Route, Routes } from "react-router-dom";
import { api, type Summary } from "./lib/api";
import { Demo } from "./pages/Demo";
import { HowItWorks } from "./pages/HowItWorks";
import { Tools } from "./pages/Tools";

function Nav() {
  const link = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-1.5 text-sm font-medium transition ${isActive ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`;
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
        <div>
          <div className="text-lg font-bold tracking-tight">SplitTrust</div>
          <div className="text-xs text-slate-500">RFC 9704: who may answer for a domain inside a network</div>
        </div>
        <nav className="flex gap-1">
          <NavLink to="/" end className={link}>Demo</NavLink>
          <NavLink to="/tools" className={link}>Tools</NavLink>
          <NavLink to="/how" className={link}>How it works</NavLink>
        </nav>
        <div className="ml-auto text-xs text-slate-500">
          Lab environment: a private DNS root with a real DNSSEC chain. Verdicts are real; the Internet is simulated.
        </div>
      </div>
    </header>
  );
}

export default function App() {
  const [summaries, setSummaries] = useState<Summary[] | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { api.scenarios().then(setSummaries).catch((e) => setErr((e as Error).message)); }, []);
  return (
    <BrowserRouter>
      <Nav />
      {err && <div className="mx-auto max-w-7xl px-6 pt-6 text-red-700">Cannot reach the API: {err}. Is the lab running? <code>docker compose -f lab/compose.yaml ps</code></div>}
      {!summaries && !err && <div className="mx-auto max-w-7xl px-6 pt-6 text-slate-500">Loading the scenario catalogue...</div>}
      {summaries && (
        <Routes>
          <Route path="/" element={<Demo summaries={summaries} />} />
          <Route path="/tools" element={<Tools summaries={summaries} />} />
          <Route path="/how" element={<HowItWorks />} />
          <Route path="/live" element={<Navigate to="/tools" replace />} />
          <Route path="/about" element={<Navigate to="/how" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
