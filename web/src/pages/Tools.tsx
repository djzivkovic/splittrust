/* Tools: run the engine with every knob exposed and look at the raw JSON. Not part of the demo flow. */

import { useEffect, useState } from "react";
import { api, type ClientStatus, type Device, type Resolution, type ResolveReport, type Run, type Summary } from "../lib/api";
import { RawTrace, toneChip } from "../components/Verdict";
import { runTone } from "../lib/story";

const DEVICES: Device[] = ["validating-stub", "private-dns", "hybrid"];

function Json({ v }: { v: unknown }) {
  return <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(v, null, 2)}</pre>;
}

function Section({ title, children, hint }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="card">
      <h2 className="text-lg font-semibold">{title}</h2>
      {hint && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export function Tools({ summaries }: { summaries: Summary[] }) {
  const runnable = summaries.filter((s) => !s.requires_internet);
  const [scenario, setScenario] = useState(runnable[0]?.id ?? "legit");
  const [device, setDevice] = useState<Device | "">("");
  const [resolution, setResolution] = useState<Resolution | "">("");
  const [run, setRun] = useState<Run | null>(null);
  const [runErr, setRunErr] = useState("");
  const [qname, setQname] = useState("host.internal.corp.lab");
  const [resolve, setResolve] = useState<ResolveReport | null>(null);
  const [resolveErr, setResolveErr] = useState("");
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const [claimText, setClaimText] = useState('{"resolver":"dns.firma.rs","parent":"firma.rs","subdomains":["intranet","mail"],"algorithm":"SHA384","salt":"Vn3kQ2r9bXz0pLm4Yt8wHA"}');
  const [inspect, setInspect] = useState<unknown>(null);
  const [owner, setOwner] = useState({ resolver: "dns.firma.rs", parent: "firma.rs", subdomains: "intranet, mail", algorithm: "SHA384", salt: "", ds: "" });
  const [built, setBuilt] = useState<unknown>(null);
  const [caps, setCaps] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState("");

  const refreshStatus = () => api.clientStatus().then(setStatus).catch(() => setStatus(null));
  useEffect(() => { refreshStatus(); api.capabilities().then(setCaps).catch(() => undefined); const t = setInterval(refreshStatus, 5000); return () => clearInterval(t); }, []);

  const doVerify = async () => {
    setBusy("verify"); setRunErr(""); setRun(null);
    try { setRun(await api.verify(scenario, device || undefined, resolution || undefined)); } catch (e) { setRunErr((e as Error).message); } finally { setBusy(""); }
  };
  const doResolve = async () => {
    setBusy("resolve"); setResolveErr(""); setResolve(null);
    try { setResolve(await api.resolve(scenario, qname, device || undefined, resolution || undefined)); } catch (e) { setResolveErr((e as Error).message); } finally { setBusy(""); }
  };
  const doInspect = async () => {
    try { setInspect(await api.inspect(JSON.parse(claimText))); } catch (e) { setInspect({ error: (e as Error).message }); }
  };
  const doBuild = async () => {
    const req = { resolver: owner.resolver, parent: owner.parent, subdomains: owner.subdomains.split(",").map((s) => s.trim()).filter(Boolean), algorithm: owner.algorithm, salt: owner.salt, ds: owner.ds.split(/\s+/).filter(Boolean) };
    try { setBuilt(await api.build(req)); } catch (e) { setBuilt({ error: (e as Error).message }); }
  };
  const doJoin = async () => { if (status) { await api.clientJoin(scenario, (device || summaries.find((s) => s.id === scenario)?.default_device || "validating-stub") as Device); refreshStatus(); } };

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-6 pb-24 pt-6">
      <p className="text-sm text-slate-600">The same engine the Demo page uses, with every option exposed. Reports are the JSON the CLI prints.</p>

      <Section title="Verify a network's claims" hint="POST /api/verify: one report per claim, stages in order, evidence attached.">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs text-slate-600">scenario<br /><select className="input w-auto" value={scenario} onChange={(e) => setScenario(e.target.value)}>{runnable.map((s) => <option key={s.id} value={s.id}>{s.id}</option>)}</select></label>
          <label className="text-xs text-slate-600">device<br /><select className="input w-auto" value={device} onChange={(e) => setDevice(e.target.value as Device | "")}><option value="">(scenario default)</option>{DEVICES.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="text-xs text-slate-600">resolution<br /><select className="input w-auto" value={resolution} onChange={(e) => setResolution(e.target.value as Resolution | "")}><option value="">(default)</option><option value="via-network">via-network</option><option value="iterative">iterative</option></select></label>
          <button className="btn btn-primary" onClick={doVerify} disabled={busy === "verify"}>{busy === "verify" ? "Verifying..." : "Verify"}</button>
          <span className="text-xs text-slate-500">expected: {summaries.find((s) => s.id === scenario)?.expected.map((x) => `${x.device}: ${x.decision}/${x.reason}`).join("; ")}</span>
        </div>
        {runErr && <p className="mt-3 text-sm text-rose-300">{runErr}</p>}
        {run && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2"><span className={toneChip[runTone(run.claims, run.decision)]}>{run.decision}</span><span className="text-sm text-slate-500">device {run.device}; {run.resolution}; trust_context {run.trust_context}</span></div>
            {run.claims.map((c) => (
              <div key={c.index} className="rounded-xl border border-slate-800 p-3">
                <div className="flex flex-wrap items-center gap-2 text-sm"><span className={toneChip[runTone([c], c.decision)]}>{c.decision}</span><code>{c.resolver}</code>: <b>{c.reason}</b>{c.inspection && <span className="text-slate-500">(scopes {c.inspection.scopes.join(", ")}; token {c.inspection.token.slice(0, 12)}...)</span>}</div>
                <RawTrace stages={c.stages} title="stages + evidence" />
              </div>
            ))}
            <details><summary className="cursor-pointer text-xs text-slate-500">full JSON</summary><Json v={run} /></details>
          </div>
        )}
      </Section>

      <Section title="Resolve a name as the device" hint="POST /api/resolve: granted names go to the authorised resolver with local validation; others take the device's default path.">
        <div className="flex flex-wrap items-end gap-3">
          <input className="input max-w-sm" value={qname} onChange={(e) => setQname(e.target.value)} />
          <button className="btn btn-primary" onClick={doResolve} disabled={busy === "resolve"}>Resolve</button>
        </div>
        {resolveErr && <p className="mt-3 text-sm text-rose-300">{resolveErr}</p>}
        {resolve && (
          <div className="mt-3 text-sm">
            <div>route <b>{resolve.route}</b> ({resolve.route_reason}); via {resolve.via}; {resolve.security}</div>
            <div className="mt-1">{resolve.error_code ? <span className="text-red-700">{resolve.error_code}: {resolve.error}</span> : <span className="text-green-700">answers: {resolve.answers.join(", ") || "none"}</span>}</div>
            <details><summary className="cursor-pointer text-xs text-slate-500">full JSON</summary><Json v={resolve} /></details>
          </div>
        )}
      </Section>

      <Section title="DNS proxy (the lab client's resolver)" hint="GET /api/client/status and POST /api/client/join: what the plain client container currently believes.">
        {status ? (
          <div className="text-sm">
            <div>on <b>{status.title}</b> ({status.scenario_id}) as <b>{status.device}</b>; {status.resolution}; {status.queries} queries answered</div>
            <ul className="mt-2 space-y-1">
              {status.grants.length === 0 && <li className="text-slate-500">no cached verdicts yet; the proxy verifies on the first query for a claimed name</li>}
              {status.grants.map((g, i) => <li key={i}><span className={toneChip[g.decision === "accepted" ? (g.local_dnssec_mode === "delegated" ? "green" : "yellow") : "red"]}>{g.decision}</span> <code>{g.resolver}</code> for <code>{g.scopes.join(", ")}</code>: {g.reason}{g.expires_at && <>; until {new Date(g.expires_at).toLocaleTimeString()}</>}</li>)}
            </ul>
            <button className="btn btn-ghost mt-3" onClick={doJoin}>Move the client to "{scenario}" as {device || "its default device"}</button>
          </div>
        ) : <p className="text-sm text-slate-500">no proxy reachable from this console</p>}
      </Section>

      <Section title="Inspect a claim" hint="POST /api/inspect: canonical form, $X, token input and token. Try the RFC 9704 section 5.1 claim.">
        <textarea className="input h-28" value={claimText} onChange={(e) => setClaimText(e.target.value)} spellCheck={false} />
        <div className="mt-2 flex gap-2">
          <button className="btn btn-primary" onClick={doInspect}>Inspect</button>
          <button className="btn btn-ghost" onClick={() => setClaimText('{"resolver":"resolver17.parent.example","parent":"parent.example","subdomains":["payroll.parent.example","secret.project.parent.example"],"algorithm":"SHA384","salt":"ZXhhbXBsZSBzYWx0IG9jdGV0cyAoc2hvdWxkIGJlIHJhbmRvbSk"}')}>RFC section 5.1 example</button>
        </div>
        {inspect !== null && <Json v={inspect} />}
      </Section>

      <Section title="Domain owner: build the Verification Record" hint="POST /api/records/build: the TXT line to publish and the claim to announce. Nothing is published from here.">
        <div className="grid gap-2 md:grid-cols-2">
          {(["resolver", "parent", "subdomains", "salt"] as const).map((k) => (
            <label key={k} className="text-xs text-slate-600">{k}<input className="input" value={owner[k]} onChange={(e) => setOwner({ ...owner, [k]: e.target.value })} /></label>
          ))}
          <label className="text-xs text-slate-600">algorithm<select className="input" value={owner.algorithm} onChange={(e) => setOwner({ ...owner, algorithm: e.target.value })}><option>SHA384</option><option>SHA512</option></select></label>
          <label className="text-xs text-slate-600">ds values (one per line)<textarea className="input" value={owner.ds} onChange={(e) => setOwner({ ...owner, ds: e.target.value })} /></label>
        </div>
        <button className="btn btn-primary mt-3" onClick={doBuild}>Build</button>
        {built !== null && <Json v={built} />}
      </Section>

      {caps && <Section title="Capabilities"><Json v={caps} /></Section>}
    </div>
  );
}
