/* Evidence rendered the way an engineer would check it by hand: dig-style output from the
   real responses and the certificate the resolver actually presented. Nothing here is
   paraphrased; the values come from the verifier's evidence objects. */

import type { ClaimReport, Stage } from "../lib/api";

type Ev = Record<string, unknown>;
const ev = (s?: Stage): Ev => (s && typeof s.evidence === "object" && s.evidence ? (s.evidence as Ev) : {});
const stage = (c: ClaimReport, id: string) => c.stages.find((s) => s.id === id);

/* The verification query as dig would show it: header, flags, answer section, validator text. */
export function DigView({ claim }: { claim: ClaimReport }) {
  const pub = stage(claim, "public_dnssec");
  const ext = stage(claim, "external_resolver");
  const owner = claim.inspection?.record_owner ?? "";
  let lines: string[] = [];
  if (pub && pub.status !== "skipped") {
    const e = ev(pub);
    const rcode = (e.rcode as string) || "";
    const sec = e.security as string;
    const fwd = e.forwarder as string | undefined;
    const answers = (e.answer as string[] | undefined) ?? [];
    lines.push(`; <<>> SplitTrust (libunbound validator) <<>> ${owner} TXT`);
    lines.push(fwd ? `;; forwarder: ${fwd} (DNS over TLS, authenticated)` : ";; resolution: iterative from the trust anchor");
    lines.push(`;; ->>HEADER<<- status: ${rcode || "n/a"}, flags: qr rd ra${sec === "secure" ? " ad" : ""}`);
    if (answers.length) { lines.push(";; ANSWER SECTION:"); lines.push(...answers); }
    else lines.push(";; ANSWER SECTION: (empty)");
    lines.push(`;; DNSSEC: ${sec}${e.why ? `: ${e.why as string}` : ""}`);
    if (e.rrsig_expires_at) lines.push(`;; RRSIG expires: ${e.rrsig_expires_at as string}`);
  } else if (ext && ext.status === "pass") {
    const e = ev(ext);
    const external = e.external as { adn?: string; addr?: string } | undefined;
    const answers = (e.answers as string[] | undefined) ?? [];
    lines.push(`; <<>> SplitTrust <<>> ${owner} TXT @${external?.adn ?? "external"} (${external?.addr ?? ""}, DNS over TLS)`);
    lines.push(`;; ->>HEADER<<- status: ${e.rcode as string}, flags: qr rd ra${e.ad ? " ad" : ""}`);
    if (answers.length) { lines.push(";; ANSWER SECTION:"); lines.push(...answers); } else lines.push(";; ANSWER SECTION: (empty)");
    lines.push(`;; validated by the external resolver: AD=${String(!!e.ad)} (this device does not validate itself)`);
  } else {
    lines.push(";; the Verification Record was never requested: the device stopped earlier");
  }
  const rec = stage(claim, "record");
  if (rec && rec.status !== "skipped") {
    const e = ev(rec);
    if (e.expected_token) lines.push(`;; expected token: ${e.expected_token as string}`);
    lines.push(`;; record check: ${rec.code}`);
  }
  return <Pre title="The query, as dig would show it" lines={lines} />;
}

/* The resolver's certificate next to the name the network announced. */
export function CertView({ claim }: { claim: ClaimReport }) {
  const tls = stage(claim, "resolver_tls");
  if (!tls || tls.status === "skipped") return null;
  const e = ev(tls);
  const cert = e.certificate as { subject?: string; sans?: string[]; issuer?: string; not_after?: string } | undefined;
  const ok = tls.status === "pass";
  const lines = [
    `announced resolver name: ${e.server_name as string}`,
    `address: ${e.addr as string}`,
    cert ? `certificate subject: ${cert.subject}` : "certificate: not available",
    cert ? `certificate SANs: ${(cert.sans ?? []).join(", ") || "(none)"}` : "",
    cert ? `issuer: ${cert.issuer}` : "",
    cert ? `valid until: ${cert.not_after}` : "",
    `result: ${ok ? "name matches a SAN; TLS identity verified" : "no SAN matches the announced name; identity rejected"}`,
  ].filter(Boolean);
  return <Pre title="The resolver's TLS certificate" lines={lines} tone={ok ? "ok" : "fail"} />;
}

/* The claim exactly as the network sent it. */
export function ClaimView({ claim }: { claim: ClaimReport }) {
  const pvd = stage(claim, "pvd");
  const doc = ev(pvd).document as Record<string, unknown> | undefined;
  const ins = claim.inspection;
  const sent = doc ? doc : ins ? { resolver: ins.resolver, parent: ins.parent, subdomains: ins.relative } : null;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Pre title={doc ? "PvD document (application/pvd+json), fetched over HTTPS" : "Claim, as announced"} lines={[JSON.stringify(sent, null, 2)]} />
      {ins && (
        <Pre title="What the device derives from it" lines={[
          `resolver:       ${ins.resolver}`,
          `parent:         ${ins.parent}`,
          `scopes:         ${ins.scopes.join(", ")}`,
          `record owner:   ${ins.record_owner}`,
          `expected token: ${ins.token}`,
          ...(ins.warnings ?? []).map((w) => `warning: ${w}`),
        ]} />
      )}
    </div>
  );
}

function Pre({ title, lines, tone }: { title: string; lines: string[]; tone?: "ok" | "fail" }) {
  const border = tone === "ok" ? "border-green-300" : tone === "fail" ? "border-red-300" : "border-slate-200";
  return (
    <div className={`rounded-lg border bg-white ${border}`}>
      <div className="border-b border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600">{title}</div>
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-[13px] leading-relaxed text-slate-800">{lines.join("\n")}</pre>
    </div>
  );
}
