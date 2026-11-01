import { useState, type FormEvent } from "react";
import { api, type RecordBuild } from "../lib/api";

export function RecordBuilder() {
  const [form, setForm] = useState({
    resolver: "dns.splittrust.zivkovic.me", parent: "zivkovic.me",
    subdomains: "internal.splittrust", salt: "", algorithm: "SHA384", ds: "",
  });
  const [result, setResult] = useState<RecordBuild | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");

  const change = (key: keyof typeof form, value: string) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setResult(null);
    setError("");
    setCopyStatus("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setResult(null);
    setError("");
    setCopyStatus("");
    try {
      const built = await api.build({
        resolver: form.resolver.trim(), parent: form.parent.trim(),
        subdomains: form.subdomains.split(",").map((value) => value.trim()).filter(Boolean),
        algorithm: form.algorithm, salt: form.salt.trim(),
        ds: form.ds.split("\n").map((value) => value.trim()).filter(Boolean),
      });
      if ("error" in built) setError([built.error, built.detail].filter(Boolean).join(": "));
      else setResult(built);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus("Copied to clipboard.");
    } catch {
      setCopyStatus("Clipboard unavailable. Select and copy the text below.");
    }
  };
  const field = (key: "resolver" | "parent" | "subdomains" | "salt", label: string, help: string) => (
    <label className="block text-sm font-semibold">
      {label}
      <input value={form[key]} onChange={(event) => change(key, event.target.value)}
        required={key !== "salt"} spellCheck={false} aria-label={label}
        className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm font-normal" />
      <span className="mt-1 block text-xs font-normal leading-relaxed text-slate-500">{help}</span>
    </label>
  );

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(280px,1fr)_minmax(0,2fr)]">
      <form onSubmit={(event) => void submit(event)} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Owner record tool</h2>
        <p className="mt-2 text-sm leading-relaxed text-slate-600">Build the claim and TXT record a domain owner would publish. Nothing is published automatically.</p>
        <fieldset disabled={busy} className="mt-5 space-y-4 disabled:opacity-70">
          {field("resolver", "Resolver name", "The authentication name of the resolver, not its IP address.")}
          {field("parent", "Parent zone", "The domain whose owner authorizes the claim.")}
          {field("subdomains", "Subdomains", "Comma-separated relative names, or * for the whole parent zone.")}
          {field("salt", "Salt", "Optional base64url value. Leave blank to generate a new random salt.")}
          <details className="rounded-lg border border-slate-200 p-3">
            <summary className="cursor-pointer text-sm font-semibold">Advanced options</summary>
            <label className="mt-3 block text-sm font-semibold">
              Hash algorithm
              <select value={form.algorithm} onChange={(event) => change("algorithm", event.target.value)} className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-normal">
                <option value="SHA384">SHA384</option><option value="SHA512">SHA512</option>
              </select>
            </label>
            <label className="mt-3 block text-sm font-semibold">
              DS values
              <textarea value={form.ds} onChange={(event) => change("ds", event.target.value)} rows={3} spellCheck={false}
                className="mt-1 block w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs font-normal" />
              <span className="mt-1 block text-xs font-normal text-slate-500">Optional: one base64url-encoded DS RDATA value per line.</span>
            </label>
          </details>
          <button type="submit" className="w-full rounded-lg bg-blue-700 px-4 py-3 font-semibold text-white hover:bg-blue-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700">
            {busy ? "Generating..." : "Generate record"}
          </button>
        </fieldset>
      </form>

      <div className="min-w-0 space-y-4" aria-busy={busy}>
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-sm leading-relaxed text-blue-900">
          A matching token is not proof of authorization. This tool generates record data; it does not authenticate the record's origin or check the zone's signing status.
        </div>
        {error && <div role="alert" className="break-words rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</div>}
        {busy && <p role="status" className="rounded-xl bg-white p-5 text-slate-600">Generating the record with the backend...</p>}
        {!result && !busy && !error && <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-slate-500">Fill in the claim and generate a record to see the TXT line and matching claim JSON.</p>}
        {result && <section aria-label="Generated record" className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-bold">Generated record</h2>
            <button type="button" onClick={() => void copy(result.zone_line)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Copy TXT</button>
          </div>
          <pre className="mt-4 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-4 font-mono text-sm text-slate-100">{result.zone_line}</pre>
          <p className="mt-3 text-sm text-slate-600">Zone signing status: <strong>{result.signing_state.replaceAll("_", " ")}</strong></p>
          {result.warnings.length > 0 && <ul className="mt-3 space-y-2 rounded-lg bg-amber-50 p-3 text-sm leading-relaxed text-amber-900">
            {result.warnings.map((warning) => <li key={warning} className="break-words">{warning}</li>)}
          </ul>}
          <div className="mt-5 flex items-center justify-between gap-3">
            <h3 className="font-semibold">Claim to announce</h3>
            <button type="button" onClick={() => void copy(JSON.stringify(result.claim, null, 2))} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-semibold hover:bg-slate-50">Copy JSON</button>
          </div>
          <pre className="mt-3 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-slate-50 p-4 text-xs">{JSON.stringify(result.claim, null, 2)}</pre>
          <p role="status" className="mt-3 text-sm text-slate-600">{copyStatus}</p>
        </section>}
      </div>
    </div>
  );
}
