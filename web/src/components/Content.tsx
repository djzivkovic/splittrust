/* Content slides about the solution: why existing tools fall short, what SplitTrust brings, an
   owner-record example, why a company adopts it, and what comes next. */

import { useState } from "react";
import { BLUE, Doc, GREEN, Laptop, Lock, RED, Resolver, Server, Shield } from "./Art";
import { Slide } from "./Slide";
import { STORY } from "../lib/deck";

/* ---------- Why existing tools do not solve it (interactive tabs) ---------- */

const OPTIONS = [
  { name: "HTTPS", short: "Is this the genuine GitLab service?",
    text: "Authenticates the application server and encrypts web traffic. A DNS redirect alone normally cannot impersonate a correctly validated HTTPS site.",
    detail: "It does not tell the DNS client which network resolver the company authorized for its private view.",
    relationship: "Keep HTTPS and application authentication. SplitTrust does not replace them." },
  { name: "Encrypted DNS", short: "Is the DNS connection protected?",
    text: "DoT or DoH protects the connection and authenticates the resolver's identity. A preconfigured trusted external resolver is different from one supplied by an untrusted network.",
    detail: "Knowing that a resolver is dns.hotel.lab does not establish its authority over the company's private names.",
    relationship: "RFC 9704 uses authenticated encrypted DNS; its external-resolver path can use an existing trusted service." },
  { name: "VPN", short: "Can I reach the private network?",
    text: "A VPN can provide trusted corporate connectivity and DNS policy. Full-tunnel and split-tunnel deployments both exist; not every VPN hairpins all traffic.",
    detail: "A managed VPN is already a valid way to establish trust. RFC 9704 addresses owner authorization of local DNS views, not a replacement for network access.",
    relationship: "Private GitLab may still require a VPN. SplitTrust does not create connectivity." },
  { name: "DNSSEC", short: "Is this DNS data authentic?",
    text: "Validates DNS data against trusted keys. Properly signed and delegated private DNS can work with DNSSEC; private views do not universally break validation.",
    detail: "RFC 9704 defines a specific owner-authorized local-view mechanism, including optional delegation of a local DNSSEC key.",
    relationship: "DNSSEC is a foundation of the checking path, not a competing feature that SplitTrust replaces." },
  { name: "RFC 9704 / SplitTrust", short: "Did the owner approve this local view?",
    text: "Authenticates the owner's Verification Record, checks the resolver identity, and permits a scoped local exception while preserving normal DNS policy elsewhere.",
    detail: "Requires a checking client, an authenticated encrypted local resolver, and owner-published authorization. It is not zero-deployment infrastructure.",
    relationship: "Adds scoped resolver authority alongside HTTPS, DNSSEC, encrypted DNS and appropriate network access." },
];

export function WhyNotSlide() {
  const [i, setI] = useState(0);
  const o = OPTIONS[i];
  return (
    <Slide section="Complementary protections" title="Different protections answer different questions"
      takeaway="SplitTrust adds scoped DNS authority. It does not replace HTTPS, DNSSEC or a VPN.">
      <div className="grid flex-1 gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="flex flex-col gap-2">
          {OPTIONS.map((opt, k) => (
            <button key={opt.name} onClick={() => setI(k)}
              className={`rounded-xl border-2 px-4 py-3 text-left transition ${k === i ? "border-blue-600 bg-white shadow-sm" : "border-slate-200 bg-white/60 hover:border-slate-400"}`}>
              <div className="flex items-center gap-3">
                <span className="text-lg font-bold">{opt.name}</span>
              </div>
              <div className="text-sm text-slate-500">{opt.short}</div>
            </button>
          ))}
        </div>
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-2xl font-bold">{o.name}</div>
          <p className="mt-3 text-lg text-slate-800">{o.text}</p>
          <p className="mt-2 text-base text-slate-500">{o.detail}</p>
          <div className="mt-6 rounded-xl border border-blue-200 bg-blue-50 p-4">
            <h3 className="font-bold text-blue-900">How it fits with SplitTrust</h3>
            <p className="mt-2 text-base text-blue-950">{o.relationship}</p>
          </div>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- What SplitTrust brings ---------- */

const FEATURES: { icon: React.ReactNode; title: string; lines: string[] }[] = [
  { icon: <g transform="scale(1.1)"><Shield /></g>, title: "The RFC 9704 client check",
    lines: ["claim canonicalisation and token (§5)", "resolver identity over DoT (RFC 9525)", "DNSSEC validation in-process (libunbound)", "ds key binding (§7), grants with expiry"] },
  { icon: <g transform="translate(0,4) scale(0.9)"><Laptop tone={BLUE} /></g>, title: "A DNS proxy that enforces it",
    lines: ["any stub resolver can point at it", "no authority from rejected claims; bogus answers refused", "verdicts cached and re-verified", "no application changes"] },
  { icon: <g transform="scale(1.1)"><Doc tone={BLUE} /></g>, title: "The owner's record tool",
    lines: ["claim in, TXT record out", "replace record and salt to revoke (after TTLs)", "DHCP option 90/11 codec, PvD documents"] },
  { icon: <g transform="scale(0.9)"><Resolver tone={GREEN} /></g>, title: "Tested against the public DNS",
    lines: ["our zone zivkovic.me, DNSSEC-signed", "validated under the IANA root", "phone profile through dns.quad9.net"] },
  { icon: <g transform="scale(0.9)"><Server /></g>, title: "A lab that attacks it",
    lines: ["forged records, replayed claims, stale salts", "expired signatures, wrong keys, blocked Quad9", "15 scenarios, 3 device profiles"] },
  { icon: <g transform="scale(1.3)"><Lock tone={RED} /></g>, title: "Limits",
    lines: ["discovery pre-configured; DHCP not sent on the wire", "native OS resolver support remains future work", "unsigned zones only via a trusted resolver (§6.1)"] },
];

export function SolutionSlide() {
  return (
    <Slide section="Inventory" title="What SplitTrust implements">
      <div className="grid flex-1 content-center gap-4 md:grid-cols-3">
        {FEATURES.map((f) => (
          <div key={f.title} className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center gap-3">
              <svg viewBox="-40 -40 80 80" className="h-12 w-12 shrink-0">{f.icon}</svg>
              <div className="text-lg font-bold leading-tight">{f.title}</div>
            </div>
            <ul className="mt-3 space-y-1 text-sm text-slate-700">{f.lines.map((l) => <li key={l} className="flex gap-2"><span className="text-blue-600">+</span><span>{l}</span></li>)}</ul>
          </div>
        ))}
      </div>
    </Slide>
  );
}

export function OwnerRecordSlide() {
  const fields = [
    ["Resolver identity", STORY.officeResolver],
    ["Parent zone", STORY.parent],
    ["Allowed scope", STORY.scope],
    ["Salt", "Random bytes, also distributed with the claim"],
  ];
  return (
    <Slide section="Owner configuration" title="What the owner publishes" sub="An illustrative record, not a live DNS lookup."
      takeaway="The builder prepares a record. Publishing and authenticating it are what establish the owner's permission.">
      <div className="grid flex-1 content-center gap-5 lg:grid-cols-[2fr_3fr]">
        <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="text-xl font-bold">Start with the intended claim</h3>
          <dl className="mt-4 space-y-4">
            {fields.map(([label, value]) => <div key={label}>
              <dt className="text-sm text-slate-500">{label}</dt>
              <dd className="mt-1 break-words font-mono text-base">{value}</dd>
            </div>)}
          </dl>
        </div>
        <div className="flex flex-col gap-4">
          <div className="rounded-2xl border-2 border-slate-200 bg-white p-5 shadow-sm">
            <h3 className="text-xl font-bold">Publish a Verification Record</h3>
            <pre className="mt-4 whitespace-pre-wrap break-all rounded-lg bg-slate-100 p-4 font-mono text-sm">{`${STORY.officeResolver}._splitdns-challenge.${STORY.parent}.\n  IN TXT "token=<derived base64url token>"`}</pre>
            <p className="mt-3 text-sm text-slate-500">Example syntax only: the token above is a placeholder, not a publish-ready record.</p>
            <p className="mt-3 text-base text-slate-700">The token hashes the salt length, salt and canonical relative subdomains. The resolver is bound through the record's DNS name.</p>
            <p className="mt-2 text-sm font-semibold text-blue-800">Changing only the resolver changes the record name, not the token, when the other inputs stay the same.</p>
          </div>
          <div className="rounded-2xl border-2 border-blue-200 bg-blue-50 p-5 shadow-sm">
            <h3 className="text-lg font-bold">Readable by everyone, authorized by the owner</h3>
            <p className="mt-2 text-base text-slate-700">A matching token alone is not proof. The client authenticates the record through DNSSEC or its pre-existing trusted external resolver. An optional <code>ds</code> value binds a local DNSSEC key.</p>
          </div>
        </div>
      </div>
    </Slide>
  );
}

/* ---------- Why a company adopts it ---------- */

export function ImpactSlide() {
  const col = (title: string, tone: string, items: [string, string][]) => (
    <div className={`rounded-2xl border-2 bg-white p-6 shadow-sm ${tone}`}>
      <div className="text-xl font-bold">{title}</div>
      <ul className="mt-4 space-y-4">
        {items.map(([h, d]) => <li key={h}><div className="text-lg font-semibold text-slate-900">{h}</div><div className="text-base text-slate-600">{d}</div></li>)}
      </ul>
    </div>
  );
  return (
    <Slide section="Deployment" title="What changes for a company"
      takeaway="DNS and resolver configuration change. Applications do not.">
      <div className="grid flex-1 content-center gap-6 lg:grid-cols-2">
        {col("The company changes", "border-blue-200", [
          ["DNSSEC on the zone", "Enable it at the DNS provider; publish the DS through the registrar. Without it, devices can verify only through a resolver they already trust (§6.1)."],
          ["One TXT record per claim", "Built from the exact claim with the record tool. Replace record and salt to revoke; takes effect as caches expire."],
          ["Encrypted DNS on the office resolver", "Use a DoT-capable resolver with a certificate for its announced name. Existing software may need configuration or additional support."],
          ["A client that checks", "The SplitTrust proxy as the device's resolver today; the OS resolver once vendors ship the check."],
        ])}
        {col("What users see", "border-green-200", [
          ["On the office network", "The approved private view provides the GitLab address; network access and application authentication still apply."],
          ["On a hostile network", "Rejected claims gain no authority. Valid default-path answers can still work; DNSSEC-bogus answers are refused with SERVFAIL and an Extended DNS Error."],
          ["A copied claim", "An impersonator that cannot prove the claimed resolver's TLS identity is rejected before a DNS query is sent to it."],
          ["Evidence", "Every verdict carries its checks and the raw responses."],
        ])}
      </div>
    </Slide>
  );
}

/* ---------- Roadmap ---------- */

export function RoadmapSlide() {
  const steps = [
    ["One company, one private service", "Start with a domain and resolver controlled by the organization, not a broad production rollout."],
    ["Managed checking clients", "Deploy the proxy and explicit claim configuration through existing device management or VPN configuration."],
    ["Measure operational behavior", "Evaluate network changes, rejected claims, expiry, recovery and user-visible failures before expanding."],
  ];
  return (
    <Slide section="What's next" title="Next: one managed-device pilot"
      takeaway="A concrete pilot first. Automatic discovery and native OS integration follow the operational evidence.">
      <div className="flex flex-1 flex-col justify-center gap-6">
        <div className="grid gap-5 md:grid-cols-3">
          {steps.map(([title, text], index) => <div key={title} className="rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-sm">
            <p className="text-sm font-bold text-blue-700">Pilot step {index + 1}</p>
            <h3 className="mt-2 text-xl font-bold">{title}</h3>
            <p className="mt-3 text-base leading-relaxed text-slate-600">{text}</p>
          </div>)}
        </div>
        <div className="grid gap-4 md:grid-cols-3 text-sm text-slate-600">
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> protection applies to clients that use the proxy or the CLI; nothing intercepts the host's DNS yet.</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> unsigned zones can only be verified through an external resolver the device already trusts (§6.1).</div>
          <div className="rounded-xl bg-white p-4 shadow-sm"><b className="text-slate-900">Limit:</b> discovery is pre-configured per network; the DHCP option is encoded and decoded, not yet sent.</div>
        </div>
      </div>
    </Slide>
  );
}
