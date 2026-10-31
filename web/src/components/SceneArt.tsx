/* One drawing per scene: Beta on the left, Alfa on the right, the network in the middle, the real
   DNS above. Packets travel along the lines; marks appear where the real verification said so. */

import { AnimatePresence, motion } from "framer-motion";
import type { Device, Run } from "../lib/api";
import type { Place } from "../lib/deck";
import { ALFA, BETA } from "../lib/deck";
import { BLUE, Cloud, GREEN, INK, LINE, Laptop, Lock, Mark, Mask, MUTED, Phone, RED, Resolver, Router, Server } from "./Art";

export type NodeId = "beta" | "alfa" | "betaRes" | "alfaRes" | "hotelRes" | "betaSrv" | "alfaSrv" | "fakeSrv" | "cloud" | "router";

const P: Record<NodeId, { x: number; y: number }> = {
  beta: { x: 170, y: 430 }, alfa: { x: 1030, y: 430 }, router: { x: 600, y: 440 },
  betaRes: { x: 330, y: 260 }, alfaRes: { x: 870, y: 260 }, hotelRes: { x: 600, y: 260 },
  betaSrv: { x: 150, y: 90 }, fakeSrv: { x: 470, y: 90 }, alfaSrv: { x: 1050, y: 90 }, cloud: { x: 770, y: 80 },
};

export interface Beat { from: NodeId; to: NodeId; side: "alfa" | "beta"; label?: string; mark?: { node: NodeId; ok: boolean; text?: string } }
export interface Step { alfa?: Beat; beta?: Beat }

/* Build the parallel sequence from the real verification report and the real browse results. */
export function stepsFor(place: Place, run: Run | null, alfaReached: boolean | null, alfaOffNetwork: boolean): Step[] {
  const res: NodeId = place === "office" ? "alfaRes" : "hotelRes";
  const betaRes: NodeId = place === "office" ? "betaRes" : "hotelRes";
  const betaSrv: NodeId = place === "office" ? "betaSrv" : "fakeSrv";
  const beta: Beat[] = [
    { side: "beta", from: "beta", to: betaRes, label: BETA.domain },
    { side: "beta", from: betaRes, to: betaSrv },
    { side: "beta", from: betaSrv, to: "beta", mark: { node: "beta", ok: true, text: place === "office" ? "page" : "page (hotel's)" } },
  ];
  const alfa: Beat[] = [];
  const c = run?.claims[0];
  if (c) {
    const st = (id: string) => c.stages.find((s) => s.id === id);
    const tls = st("resolver_tls");
    if (tls && tls.status !== "skipped") alfa.push({ side: "alfa", from: "alfa", to: res, label: "who are you?", mark: { node: res, ok: tls.status === "pass", text: tls.status === "pass" ? "certificate ok" : "wrong certificate" } });
    const pub = st("public_dnssec");
    if (pub && pub.status !== "skipped" && pub.code !== "NOT_APPLICABLE") {
      const ok = pub.code === "DNSSEC_SECURE";
      alfa.push({ side: "alfa", from: res, to: "cloud", label: "owner's record?" });
      alfa.push({ side: "alfa", from: "cloud", to: res, mark: { node: "cloud", ok, text: ok ? "signed by the owner" : pub.code === "DNSSEC_BOGUS" ? "signatures missing" : "unsigned" } });
    }
    const ext = st("external_resolver");
    if (ext && ext.status === "pass") {
      const rec = st("record");
      const ok = rec?.status === "pass";
      alfa.push({ side: "alfa", from: "alfa", to: "cloud", label: "ask Quad9" });
      alfa.push({ side: "alfa", from: "cloud", to: "alfa", mark: { node: "cloud", ok, text: ok ? "record found" : "no record" } });
    }
    const accepted = c.decision === "accepted";
    alfa.push({ side: "alfa", from: "alfa", to: "alfa", mark: { node: "alfa", ok: accepted, text: accepted ? "resolver verified" : "resolver rejected" } });
    if (accepted) {
      alfa.push({ side: "alfa", from: "alfa", to: res, label: ALFA.domain });
      alfa.push({ side: "alfa", from: res, to: "alfaSrv" });
      alfa.push({ side: "alfa", from: "alfaSrv", to: "alfa", mark: { node: "alfa", ok: alfaReached !== false, text: "page" } });
    } else if (alfaOffNetwork) {
      alfa.push({ side: "alfa", from: "alfa", to: "cloud", label: ALFA.site });
      alfa.push({ side: "alfa", from: "cloud", to: "alfa", mark: { node: "alfa", ok: true, text: "real site, via Quad9" } });
    }
  }
  const n = Math.max(beta.length, alfa.length);
  return Array.from({ length: n }, (_, i) => ({ beta: beta[i], alfa: alfa[i] }));
}

export function SceneArt({ place, device, steps, at, resolverName }: { place: Place; device: Device; steps: Step[]; at: number; resolverName: string }) {
  const marks: { node: NodeId; ok: boolean; text?: string; side: "alfa" | "beta" }[] = [];
  steps.slice(0, at + 1).forEach((s) => [s.beta, s.alfa].forEach((b) => { if (b?.mark) marks.push({ ...b.mark, side: b.side }); }));
  const current = at >= 0 ? steps[Math.min(at, steps.length - 1)] : undefined;
  const hotel = place === "hotel";
  const Dev = device === "private-dns" ? Phone : Laptop;

  const edges: [NodeId, NodeId][] = hotel
    ? [["beta", "hotelRes"], ["alfa", "hotelRes"], ["hotelRes", "fakeSrv"], ["hotelRes", "cloud"], ["alfa", "cloud"]]
    : [["beta", "betaRes"], ["betaRes", "betaSrv"], ["alfa", "alfaRes"], ["alfaRes", "alfaSrv"], ["alfaRes", "cloud"], ["alfa", "cloud"]];

  const label = (id: NodeId, text: string, sub?: string, dy = 58) => (
    <g transform={`translate(${P[id].x}, ${P[id].y + dy})`}>
      <text textAnchor="middle" fontSize={15} fontWeight={600} fill={INK}>{text}</text>
      {sub && <text y={18} textAnchor="middle" fontSize={12} fill={MUTED} fontFamily="ui-monospace, Menlo, monospace">{sub}</text>}
    </g>
  );

  return (
    <svg viewBox="0 0 1200 520" className="h-full w-full select-none" role="img" aria-label="Scene">
      {/* network area */}
      <rect x={60} y={350} width={1080} height={150} rx={24} fill={hotel ? "#fff7ed" : "#eff6ff"} />
      <text x={600} y={500} textAnchor="middle" fontSize={14} fontWeight={600} fill={hotel ? "#9a3412" : "#1e40af"}>{hotel ? "Hotel Wi-Fi" : "Office Wi-Fi"}</text>

      {edges.map(([a, b]) => <line key={a + b} x1={P[a].x} y1={P[a].y} x2={P[b].x} y2={P[b].y} stroke={LINE} strokeWidth={2.5} />)}

      {/* actors */}
      <g transform={`translate(${P.router.x}, ${P.router.y})`}><Router tone={hotel ? "#9a3412" : "#1e40af"} /></g>
      <g transform={`translate(${P.beta.x}, ${P.beta.y})`}><Laptop /></g>
      {label("beta", `${BETA.name}'s laptop`, "no SplitTrust")}
      <g transform={`translate(${P.alfa.x}, ${P.alfa.y})`}><Dev tone={BLUE} /></g>
      {label("alfa", `${ALFA.name}'s ${device === "private-dns" ? "phone" : "laptop"}`, "SplitTrust")}

      {hotel ? (
        <>
          <g transform={`translate(${P.hotelRes.x}, ${P.hotelRes.y})`}><Resolver hostile /></g>
          {label("hotelRes", "the hotel's resolver", `claims ${BETA.domain} and ${ALFA.domain}`, 46)}
          <g transform={`translate(${P.fakeSrv.x}, ${P.fakeSrv.y})`}><Server tone={RED} fill="#fef2f2" /><Mask x={0} y={-50} /></g>
          {label("fakeSrv", "the hotel's page", "looks like the intranet login")}
        </>
      ) : (
        <>
          <g transform={`translate(${P.betaRes.x}, ${P.betaRes.y})`}><Resolver /></g>
          {label("betaRes", `${BETA.name}'s resolver`, "plain DNS", 46)}
          <g transform={`translate(${P.alfaRes.x}, ${P.alfaRes.y})`}><Resolver tone={BLUE} /></g>
          {label("alfaRes", `${ALFA.name}'s resolver`, resolverName, 46)}
          <g transform={`translate(${P.betaSrv.x}, ${P.betaSrv.y})`}><Server /></g>
          {label("betaSrv", `${BETA.name} intranet`)}
        </>
      )}
      <g transform={`translate(${P.alfaSrv.x}, ${P.alfaSrv.y})`}><Server tone={BLUE} /></g>
      {label("alfaSrv", `${ALFA.name} intranet`, hotel ? "unreachable from here" : undefined)}
      <g transform={`translate(${P.cloud.x}, ${P.cloud.y})`}><Cloud /></g>
      <text x={P.cloud.x} y={P.cloud.y - 2} textAnchor="middle" fontSize={14} fontWeight={700} fill={INK}>the real DNS</text>
      <text x={P.cloud.x} y={P.cloud.y + 16} textAnchor="middle" fontSize={11} fill={MUTED}>root, .me, Cloudflare, Quad9</text>
      <g transform={`translate(${P.cloud.x + 62}, ${P.cloud.y - 30})`}><Lock tone={GREEN} /></g>

      {/* packets */}
      <AnimatePresence>
        {current && [current.beta, current.alfa].map((b, i) => b && b.from !== b.to && (
          <motion.g key={`${at}-${i}`} initial={{ x: P[b.from].x, y: P[b.from].y, opacity: 0 }} animate={{ x: P[b.to].x, y: P[b.to].y, opacity: [0, 1, 1, 0.6] }}
            exit={{ opacity: 0 }} transition={{ duration: 1.2, ease: "easeInOut" }}>
            <circle r={9} fill={b.side === "alfa" ? BLUE : INK} />
            {b.label && <text y={-16} textAnchor="middle" fontSize={12} fontWeight={600} fill={b.side === "alfa" ? BLUE : INK}>{b.label}</text>}
          </motion.g>
        ))}
      </AnimatePresence>

      {/* marks */}
      {marks.map((m, i) => {
        const left = m.node === "alfa" || m.node === "alfaRes" || m.node === "alfaSrv";
        const nth = marks.slice(0, i).filter((o) => o.node === m.node).length; // later marks on the same actor stack upwards
        const off = m.node === "cloud" ? { x: -70, y: 44 + nth * 30 } : m.node === "alfa" || m.node === "beta" ? { x: left ? -62 : 62, y: -44 - nth * 30 } : { x: left ? -66 : 66, y: -30 - nth * 30 };
        return (
          <motion.g key={i} initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 300, damping: 16 }}
            transform={`translate(${P[m.node].x + off.x}, ${P[m.node].y + off.y})`}>
            <Mark ok={m.ok} />
            {m.text && <text x={left ? -20 : 20} y={5} textAnchor={left ? "end" : "start"} fontSize={13} fontWeight={600} fill={m.ok ? GREEN : RED}>{m.text}</text>}
          </motion.g>
        );
      })}
    </svg>
  );
}
