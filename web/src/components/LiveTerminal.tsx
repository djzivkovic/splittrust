import { useEffect, useState } from "react";
import { api, type DemoPreset, type DemoReport } from "../lib/api";

const outcomes: Record<DemoReport["outcome"], { title: string; colour: string }> = {
  redirected: { title: "Attack succeeded in the lab", colour: "border-red-300 bg-red-50 text-red-950" },
  blocked: { title: "Attack blocked", colour: "border-green-300 bg-green-50 text-green-950" },
  authorized: { title: "The employee reached private GitLab", colour: "border-green-300 bg-green-50 text-green-950" },
  not_redirected: { title: "No redirect observed", colour: "border-amber-300 bg-amber-50 text-amber-950" },
  inconclusive: { title: "Run inconclusive", colour: "border-amber-300 bg-amber-50 text-amber-950" },
};

function displayCommand(args: string[]) {
  return args.map((arg) => /^[a-zA-Z0-9_@=+:./-]+$/.test(arg) ? arg : JSON.stringify(arg)).join(" ");
}

export function LiveTerminal() {
  const [presets, setPresets] = useState<DemoPreset[]>([]);
  const [presetID, setPresetID] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [reload, setReload] = useState(0);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [report, setReport] = useState<DemoReport | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    api.demoPresets().then((items) => {
      if (!active) return;
      setPresets(items);
      setPresetID(items[0]?.id ?? "");
      if (!items.length) setLoadError("No command presets are available on this server.");
    }).catch((e: Error) => {
      if (active) setLoadError(e.message);
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [reload]);

  const selected = presets.find((preset) => preset.id === presetID);
  const run = async () => {
    if (!selected || running) return;
    setReport(null);
    setError("");
    setRunning(true);
    try {
      setReport(await api.demoRun(selected.id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <section aria-labelledby="terminal-heading">
        <h2 id="terminal-heading" className="text-2xl font-bold">Private code. One hostname. Two DNS views.</h2>
        <p className="mt-2 max-w-4xl text-sm leading-relaxed text-slate-600">
          SecureCompany runs an internal GitLab so its source code stays on the company network.
          Employees open the same bookmark from the office or corporate VPN. Public DNS has no address for it;
          the company resolver supplies its private address. That is why this company uses split-horizon DNS.
        </p>
        <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">The employee's bookmark</p>
          <p className="mt-1 break-all font-mono text-lg font-bold text-blue-950">{selected?.qname || "git.dev.corp.lab"}</p>
          <p className="mt-2 text-sm text-blue-950">
            Now the employee travels to a hotel. Its Wi-Fi can announce a resolver, but does that let it answer for the company's developer services?
            Run the three steps to see the legitimate private view, the fake login redirect, and the protected refusal.
          </p>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-slate-500">
          DNS selects an address; firewalls, the VPN and GitLab authentication enforce access. This demo uses private lab DNS and small HTTP pages, not a full GitLab installation.
        </p>
        {loadError && <div role="alert" className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {loadError} <button className="ml-2 font-semibold underline" onClick={() => setReload((value) => value + 1)}>Retry</button>
        </div>}
        {loading && <p role="status" className="mt-4 text-sm text-slate-600">Loading command presets...</p>}
        <div className="mt-5 grid gap-3 md:grid-cols-3">
          {presets.map((preset, index) => (
            <button key={preset.id} aria-label={preset.title} aria-pressed={preset.id === presetID}
              disabled={running} onClick={() => { setPresetID(preset.id); setReport(null); setError(""); }}
              className={`rounded-xl border-2 p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait ${preset.id === presetID ? "border-blue-600 bg-blue-50" : "border-slate-200 bg-white hover:border-slate-400"}`}>
              <span className="block text-xs font-bold uppercase tracking-wide text-slate-500">0{index + 1} / {preset.verification_mode === "none" ? "Unprotected" : "Protected"}</span>
              <span className="mt-2 block font-bold">{preset.title}</span>
              <span className="mt-2 block text-sm leading-relaxed text-slate-600">{preset.description}</span>
            </button>
          ))}
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-slate-200 bg-white p-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Real commands for this step</p>
          {selected?.preview?.map((command) => <p key={command} className="mt-1 break-all font-mono text-xs text-slate-700">{command}</p>)}
          <p className="mt-2 text-xs text-slate-500">Fixed lab targets only. No shell access or changes to the presentation proxy.</p>
          {selected?.verification_mode === "splittrust" && <p className="mt-1 text-xs text-slate-500">
            Before the protected lookup, the dedicated demo proxy joins this step's network and clears its cached grants.
          </p>}
          <p className="mt-2 text-xs font-semibold text-slate-700">{selected?.verification_mode === "none"
            ? "For this step, dig trusts hotel DNS directly. No DNSSEC or resolver-authorization check."
            : "dig is the client; the SplitTrust proxy performs validation."}</p>
        </div>
        <button onClick={() => void run()} disabled={loading || !selected || running}
          className="shrink-0 rounded-lg bg-blue-700 px-6 py-3 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700 disabled:cursor-wait disabled:opacity-60">
          {running ? "Running commands..." : "Run commands"}
        </button>
      </div>

      {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-800">
        <p className="font-semibold">The command run could not finish</p><p className="mt-1 text-sm">{error}</p>
      </div>}

      <section aria-label="Command transcript" aria-busy={running} className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950 text-slate-100 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-700 bg-slate-900 px-5 py-3 text-xs">
          <span className="font-mono">Docker / {report?.hostname ?? "SplitTrust app"} / captured stdout + stderr</span>
          <span className="text-slate-400">{report ? `${report.commands.length} command${report.commands.length === 1 ? "" : "s"} / ${report.duration_ms} ms` : "Read-only output"}</span>
        </div>
        <div className="max-h-[28rem] overflow-auto p-5 font-mono text-xs leading-relaxed">
          {!report && <p role={running ? "status" : undefined} className="py-8 text-slate-400">
            {running ? "Executing the selected preset in Docker. Output appears when the run finishes (up to 35 seconds)..." : "Choose a preset and run it. The actual commands, output and exit codes will appear here."}
          </p>}
          {report?.commands.map((command, index) => (
            <div key={index} className={index ? "mt-5 border-t border-slate-800 pt-5" : ""}>
              <p className="break-all font-semibold text-cyan-300"><span aria-hidden="true">$ </span>{displayCommand(command.command)}</p>
              {command.stdout && <pre className="mt-2 whitespace-pre-wrap break-all">{command.stdout}</pre>}
              {command.stderr && <div className="mt-2 text-amber-300"><p className="text-xs uppercase">stderr</p><pre className="whitespace-pre-wrap break-all">{command.stderr}</pre></div>}
              {command.error && <p className="mt-2 break-all text-red-300">Execution error: {command.error}</p>}
              {command.truncated && <p className="mt-2 text-amber-300">Output truncated at 64 KiB per stream; no conclusive outcome is inferred.</p>}
              <p className={`mt-2 ${command.exit_code === 0 ? "text-slate-400" : "text-amber-300"}`}>exit {command.exit_code} / {command.duration_ms} ms</p>
            </div>
          ))}
        </div>
      </section>

      {report && <section aria-label="Demo outcome" className="space-y-4">
        <div className={`rounded-xl border p-5 ${outcomes[report.outcome].colour}`}>
          <p className="text-xs font-semibold uppercase tracking-wide">Observed outcome / {report.duration_ms} ms</p>
          <h2 className="mt-1 text-2xl font-bold">{outcomes[report.outcome].title}</h2>
          <p className="mt-2 text-sm">{report.summary}</p>
          <p className="mt-3 text-sm font-semibold">{report.verification_mode === "none"
            ? "No DNSSEC or RFC 9704 verification"
            : "DNSSEC and resolver-authorization checks enabled on the proxy"}</p>
          {report.dns_answer && <p className="mt-2 text-sm">Observed DNS answer: <code>{report.dns_answer}</code></p>}
          {report.http_url && <p className="mt-1 break-all text-sm">HTTP target: <code>{report.http_url}</code> (pinned to the observed DNS answer)</p>}
          {report.outcome === "blocked" && <p className="mt-3 text-sm">
            Failing closed is the right result here. The employee still needs the corporate VPN to reach private GitLab; SplitTrust prevents the detour to the hotel's page.
          </p>}
        </div>
        {report.public_dns && <section aria-label="Split-horizon comparison" className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">Same hostname, two observed DNS views</h3>
          <p className="mt-1 break-all font-mono text-sm text-slate-600">{report.public_dns.qname}</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg bg-slate-100 p-4">
              <p className="text-sm font-semibold">Public DNS view (lab authoritative server)</p>
              <p className="mt-2 font-mono text-lg">{report.public_dns.rcode}</p>
              <p className="mt-1 text-sm">{report.public_dns.answers.join(", ") || "No public address for this name."}</p>
            </div>
            <div className="rounded-lg bg-blue-50 p-4">
              <p className="text-sm font-semibold">Office DNS view (through SplitTrust)</p>
              <p className="mt-2 font-mono text-lg">{report.dns?.answers.join(", ") || "No private address established"}</p>
              <p className="mt-1 text-sm">{report.dns ? `${report.dns.rcode} / AD ${report.dns.ad ? "set by proxy" : "not set"}` : "The office lookup did not complete."}</p>
            </div>
          </div>
        </section>}
        {report.dns && <section aria-label="DNS response" className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">DNS response received by dig</h3>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
            <div><dt className="text-slate-500">Name</dt><dd className="break-all font-mono">{report.dns.qname}</dd></div>
            <div><dt className="text-slate-500">DNS server</dt><dd className="font-mono">{report.dns.server}</dd></div>
            <div><dt className="text-slate-500">Response status</dt><dd className="font-mono">{report.dns.rcode}</dd></div>
            <div><dt className="text-slate-500">Authenticated Data (AD)</dt><dd>{report.dns.ad ? "Set by the SplitTrust proxy" : "Not set"}</dd></div>
            <div><dt className="text-slate-500">Answers</dt><dd className="font-mono">{report.dns.answers.join(", ") || "No usable answer"}</dd></div>
            <div><dt className="text-slate-500">Response flags</dt><dd className="font-mono">{report.dns.flags.join(" ")}</dd></div>
          </dl>
          {report.dns.ede.map((ede, index) => <p key={index} className="mt-3 break-words rounded-lg bg-slate-100 p-3 text-sm">
            <span className="font-semibold">Extended DNS Error {ede.code}: </span>{ede.text}
          </p>)}
          <p className="mt-3 text-xs text-slate-500">+dnssec requests DNSSEC records; it does not make dig validate them. AD is the proxy's assertion on this trusted lab connection.</p>
        </section>}
        {report.proxy && <section aria-label="Proxy evidence" className="rounded-xl border border-slate-200 bg-white p-5">
          <h3 className="font-bold">What the demo proxy checked</h3>
          <p className="mt-2 text-sm text-slate-600">
            Network: {report.proxy.status.scenario_id} / {report.proxy.status.device}. Private lab trust anchor, not global DNS authorization.
          </p>
          <div className="mt-4 space-y-3">
            {report.proxy.status.grants.map((grant) => <div key={grant.resolver} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-1 text-xs font-semibold ${grant.decision === "accepted" ? "bg-green-100 text-green-900" : grant.decision === "rejected" ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>
                  {grant.decision}
                </span>
                <span className="break-all font-mono">{grant.resolver}</span>
                <span className="break-all font-mono text-xs text-slate-500">{grant.reason}</span>
              </div>
              <p className="mt-2 break-all text-slate-600">Claimed scope: {grant.scopes?.length ? grant.scopes.join(", ") : "Not established"}</p>
              {grant.local_dnssec_mode && <p className="mt-1 text-slate-600">Local DNSSEC: {grant.local_dnssec_mode}</p>}
            </div>)}
          </div>
          <details className="mt-4">
            <summary className="cursor-pointer text-sm font-semibold">Events from this network join and lookup</summary>
            <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-3 text-xs">{JSON.stringify(report.proxy.events, null, 2)}</pre>
          </details>
        </section>}
        <details className="rounded-xl border border-slate-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold">Full command-run report</summary>
          <pre className="mt-3 max-h-96 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(report, null, 2)}</pre>
        </details>
      </section>}

      <p className="text-xs leading-relaxed text-slate-500">This HTTP lab demonstrates DNS redirection, not an HTTPS certificate bypass.</p>
    </div>
  );
}
