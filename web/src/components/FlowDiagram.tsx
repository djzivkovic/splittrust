/* The DNS query flow as an animated map. Driven by the verifier's ordered stages:
   each stage becomes one or more "beats": a packet travelling between two actors and a
   result mark. The animation stops where the scenario breaks. */

import { motion, AnimatePresence } from "framer-motion";
import type { ClaimReport, Device, Resolution, Stage } from "../lib/api";

type NodeId = "device" | "pvd" | "resolver" | "root" | "zone" | "external";
interface Node { id: NodeId; x: number; y: number; label: string; sub?: string }

export interface Beat { stage: Stage; from: NodeId; to: NodeId; label: string; result: "ok" | "fail" | "warn" | "info"; mark?: NodeId }

const P: Record<NodeId, { x: number; y: number }> = {
  device: { x: 110, y: 250 }, pvd: { x: 420, y: 80 }, resolver: { x: 420, y: 250 },
  external: { x: 420, y: 420 }, root: { x: 760, y: 120 }, zone: { x: 760, y: 300 },
};

function nodes(c: ClaimReport, parent: string, announcedResolver: string, external: string): Node[] {
  return [
    { id: "device", ...P.device, label: "device", sub: "the client being protected" },
    { id: "pvd", ...P.pvd, label: "PvD server", sub: "the network's claims" },
    { id: "resolver", ...P.resolver, label: announcedResolver || c.resolver, sub: "the network's resolver" },
    { id: "external", ...P.external, label: external || "quad9.lab", sub: "external resolver (DoT)" },
    { id: "root", ...P.root, label: "DNS root", sub: "trust anchor" },
    { id: "zone", ...P.zone, label: parent, sub: "the owner's zone" },
  ];
}

/* Turn stages into beats. */
export function beatsFor(c: ClaimReport, device: Device, resolution: Resolution): Beat[] {
  void device;
  const beats: Beat[] = [];
  const res = (s: Stage): Beat["result"] => (s.status === "pass" ? "ok" : s.status === "skipped" ? "info" : "fail");
  for (const s of c.stages) {
    if (s.status === "skipped" && s.code !== "INLINE_CLAIM") continue;
    switch (s.id) {
      case "pvd":
        if (s.code === "INLINE_CLAIM") beats.push({ stage: s, from: "resolver", to: "device", label: "claim via DHCP", result: "info" });
        else beats.push({ stage: s, from: "device", to: "pvd", label: "GET /.well-known/pvd", result: res(s), mark: "pvd" });
        break;
      case "claim":
        beats.push({ stage: s, from: "device", to: "device", label: s.code === "CLAIM_OK" ? "claim read" : s.code ?? "claim", result: res(s), mark: "device" });
        break;
      case "token":
        beats.push({ stage: s, from: "device", to: "device", label: "token computed", result: "ok", mark: "device" });
        break;
      case "resolver_tls":
        beats.push({ stage: s, from: "device", to: "resolver", label: "TLS: prove your name", result: res(s), mark: "resolver" });
        break;
      case "public_dnssec": {
        const viaNet = resolution === "via-network";
        if (viaNet) beats.push({ stage: s, from: "device", to: "resolver", label: "TXT _splitdns-challenge ?", result: "info" });
        const rootRes: Beat["result"] = s.code === "DNSSEC_INDETERMINATE" || s.code === "DNS_LOOKUP_FAILED" ? "info" : "ok";
        beats.push({ stage: s, from: viaNet ? "resolver" : "device", to: "root", label: "chain of trust from the root", result: rootRes, mark: "root" });
        const zoneRes: Beat["result"] = s.code === "DNSSEC_SECURE" ? "ok" : s.code === "DNSSEC_INSECURE" ? "warn" : "fail";
        beats.push({ stage: s, from: "root", to: "zone", label: s.code === "DNSSEC_SECURE" ? "signatures verified" : s.code === "DNSSEC_INSECURE" || s.code === "DNSSEC_INSECURE_NO_FALLBACK" ? "zone is unsigned" : s.code === "DNSSEC_BOGUS" ? "signature chain broken" : s.code ?? "", result: zoneRes, mark: "zone" });
        if (s.status === "pass") beats.push({ stage: s, from: "zone", to: "device", label: "record, validated", result: "ok" });
        break;
      }
      case "external_resolver":
        beats.push({ stage: s, from: "device", to: "external", label: "TXT via Quad9 (DoT)", result: res(s), mark: "external" });
        if (s.status === "pass") beats.push({ stage: s, from: "external", to: "device", label: "Quad9's answer", result: "ok" });
        break;
      case "record":
        beats.push({ stage: s, from: "device", to: "device", label: s.code === "TOKEN_MATCH" ? "tokens match" : s.code === "RECORD_MISSING" ? "no record" : "tokens differ", result: res(s), mark: "device" });
        break;
      case "ds":
        beats.push({ stage: s, from: "device", to: "resolver", label: "DNSKEY resolver.arpa ?", result: s.status === "pass" ? "ok" : "fail", mark: "resolver" });
        break;
      case "grant":
        beats.push({ stage: s, from: "device", to: "resolver", label: "authority established", result: s.code === "EXTERNAL_TOKEN_MATCH" ? "warn" : "ok", mark: "resolver" });
        break;
    }
  }
  return beats;
}

const COLOR = { ok: "#15803d", fail: "#b91c1c", warn: "#b45309", info: "#1d4ed8" };

export function FlowDiagram({ claim, device, resolution, beats, playedUpTo, parent, announced, external }: {
  claim: ClaimReport; device: Device; resolution: Resolution; beats: Beat[]; playedUpTo: number;
  parent: string; announced: string; external: string;
}) {
  void device; void resolution;
  const ns = nodes(claim, parent, announced, external);
  const current = playedUpTo >= 0 ? beats[Math.min(playedUpTo, beats.length - 1)] : undefined;
  const marks = new Map<NodeId, Beat["result"]>();
  beats.slice(0, playedUpTo + 1).forEach((b) => { if (b.mark && b.result !== "info") marks.set(b.mark, b.result); });
  const done = playedUpTo >= beats.length - 1;
  const granted = done && claim.grant;
  const broke = done && claim.decision !== "accepted" ? current : undefined;

  const edge = (a: NodeId, b: NodeId) => `M ${P[a].x} ${P[a].y} L ${P[b].x} ${P[b].y}`;
  const edges: [NodeId, NodeId][] = [["device", "pvd"], ["device", "resolver"], ["device", "external"], ["resolver", "root"], ["device", "root"], ["root", "zone"], ["zone", "device"]];

  return (
    <svg viewBox="0 0 900 500" className="h-auto w-full select-none" role="img" aria-label="DNS query flow">
      <defs>
        <filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
      </defs>
      <rect x={0} y={0} width={900} height={500} rx={12} fill="#f8fafc" />
      {edges.map(([a, b]) => <path key={a + b} d={edge(a, b)} stroke="#cbd5e1" strokeWidth={2} fill="none" />)}
      {granted && (
        <motion.path d={edge("device", "resolver")} stroke={claim.grant!.path === "external" ? COLOR.warn : COLOR.ok} strokeWidth={6} fill="none" filter="url(#glow)"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }} transition={{ duration: 0.8 }} />
      )}
      {current && current.from !== current.to && (
        <motion.path key={"edge" + playedUpTo} d={edge(current.from, current.to)} stroke={COLOR[current.result]} strokeWidth={3} fill="none"
          initial={{ opacity: 0.2 }} animate={{ opacity: [0.2, 1, 0.5] }} transition={{ duration: 0.9 }} />
      )}
      <AnimatePresence>
        {current && current.from !== current.to && !done && (
          <motion.circle key={"pkt" + playedUpTo} r={9} fill={COLOR[current.result]} filter="url(#glow)"
            initial={{ cx: P[current.from].x, cy: P[current.from].y, opacity: 0 }}
            animate={{ cx: P[current.to].x, cy: P[current.to].y, opacity: [0, 1, 1, 0.6] }}
            exit={{ opacity: 0 }} transition={{ duration: 0.85, ease: "easeInOut" }} />
        )}
      </AnimatePresence>
      {ns.map((n) => {
        const m = marks.get(n.id);
        const isCurrent = current && (current.to === n.id || current.mark === n.id);
        const stroke = m ? COLOR[m] : isCurrent ? COLOR.info : "#cbd5e1";
        const isBreak = broke && (broke.mark === n.id || broke.to === n.id) && broke.result === "fail";
        return (
          <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
            <motion.rect x={-92} y={-34} width={184} height={68} rx={12} fill="#ffffff" stroke={stroke} strokeWidth={isCurrent ? 3 : 2}
              animate={isBreak ? { x: [-92, -98, -86, -92] } : { x: -92 }} transition={{ duration: 0.4 }} />
            <text x={0} y={-6} textAnchor="middle" fill="#0f172a" fontSize={15} fontWeight={600} fontFamily="ui-monospace, Menlo, monospace">{n.label}</text>
            {n.sub && <text x={0} y={16} textAnchor="middle" fill="#64748b" fontSize={12}>{n.sub}</text>}
            {m && (
              <motion.g initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 15 }}>
                <circle cx={82} cy={-30} r={14} fill={COLOR[m]} />
                <text x={82} y={-25} textAnchor="middle" fill="#ffffff" fontSize={16} fontWeight={900}>{m === "ok" ? "✓" : m === "warn" ? "!" : "✕"}</text>
              </motion.g>
            )}
          </g>
        );
      })}
      {current && (
        <motion.text key={"lbl" + playedUpTo} x={450} y={482} textAnchor="middle" fill={COLOR[current.result]} fontSize={16} fontWeight={700}
          initial={{ opacity: 0, y: 490 }} animate={{ opacity: 1, y: 482 }}>{current.label}</motion.text>
      )}
    </svg>
  );
}
