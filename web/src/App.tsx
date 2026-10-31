import { useEffect, useState } from "react";
import { BrowserRouter, NavLink, Route, Routes } from "react-router-dom";
import { api, type Summary } from "./lib/api";
import { Stage } from "./pages/Stage";
import { About } from "./pages/About";
import { Live } from "./pages/Live";

function Nav() {
  const link = ({ isActive }: { isActive: boolean }) => `rounded-lg px-3 py-1.5 text-sm font-semibold transition ${isActive ? "bg-slate-800 text-white" : "text-slate-300 hover:text-white"}`;
  return (
    <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-6 py-3">
        <div className="text-xl font-black tracking-tight">SplitTrust <span className="ml-2 text-sm font-medium text-slate-400">RFC 9704 — who may answer for a domain inside a network</span></div>
        <nav className="ml-auto flex gap-1">
          <NavLink to="/" end className={link}>Stage</NavLink>
          <NavLink to="/live" className={link}>Live</NavLink>
          <NavLink to="/about" className={link}>About</NavLink>
        </nav>
        <div className="w-full rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
          LAB — a private DNS root with a real DNSSEC chain. Verdicts are real cryptography; the Internet is simulated. Only the “real Internet” network carries <code>trust_context: global</code>.
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
      {err && <div className="mx-auto max-w-7xl px-6 pt-6 text-rose-300">Cannot reach the API: {err}. Is the lab up? <code>docker compose -f lab/compose.yaml ps</code></div>}
      {!summaries && !err && <div className="mx-auto max-w-7xl px-6 pt-6 text-slate-400">loading…</div>}
      {summaries && (
        <Routes>
          <Route path="/" element={<Stage summaries={summaries} />} />
          <Route path="/live" element={<Live summaries={summaries} />} />
          <Route path="/about" element={<About />} />
          <Route path="*" element={<Stage summaries={summaries} />} />
        </Routes>
      )}
    </BrowserRouter>
  );
}
