/* Explanatory diagrams, not measurements or simulated verification runs. */
import { useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import type { Place } from "../lib/deck";
import { STORY } from "../lib/deck";
import { BLUE, Cloud, GREEN, INK, LINE, Laptop, Lock, Mark, Mask, MUTED, RED, Resolver, Router, Server, Shield } from "./Art";

type NodeId = "beta" | "alfa" | "officeRes" | "hotelRes" | "gitlab" | "attacker" | "cloud" | "router";

const P: Record<NodeId, { x: number; y: number }> = {
  beta: { x: 170, y: 430 }, alfa: { x: 1030, y: 430 }, router: { x: 600, y: 440 },
  officeRes: { x: 600, y: 260 }, hotelRes: { x: 600, y: 260 },
  gitlab: { x: 1050, y: 90 }, attacker: { x: 250, y: 90 }, cloud: { x: 770, y: 72 },
};

interface IllustrationMark { node: "alfa" | "beta"; ok: boolean; text: string }
interface Packet { from: NodeId; to: NodeId; side: "alfa" | "beta"; label: string; dangerous?: boolean }
interface IllustrationStep { caption: string; packets?: Packet[]; marks?: IllustrationMark[] }

const sequences: Record<Place, IllustrationStep[]> = {
  office: [
    { caption: "Same employee, two DNS choices: trust network DNS directly, or verify a scoped local exception.", packets: [
      { from: "router", to: "beta", side: "beta", label: "DNS setup" },
      { from: "router", to: "alfa", side: "alfa", label: "DNS claim" },
    ] },
    { caption: "SplitTrust authenticates dns.corp.lab during the DNS-over-TLS handshake, on the client side.", packets: [
      { from: "beta", to: "officeRes", side: "beta", label: "GitLab A?" },
      { from: "officeRes", to: "alfa", side: "alfa", label: "Resolver certificate" },
    ], marks: [{ node: "alfa", ok: true, text: "Resolver identity verified" }] },
    { caption: "The ordinary lookup accepts the private address. SplitTrust first asks for the company's authorization.", packets: [
      { from: "officeRes", to: "beta", side: "beta", label: "Private GitLab IP" },
      { from: "alfa", to: "officeRes", side: "alfa", label: "Authorization TXT?" },
    ], marks: [{ node: "beta", ok: true, text: "Private address accepted" }] },
    { caption: "The office resolver retrieves the Verification Record from the company's public DNS.", packets: [
      { from: "officeRes", to: "cloud", side: "alfa", label: "Authorization TXT?" },
    ] },
    { caption: "Public DNS supplies the signed record. It does not decide whether this client should trust the resolver.", packets: [
      { from: "cloud", to: "officeRes", side: "alfa", label: "Signed permission" },
    ] },
    { caption: "The record reaches the client-side proxy. It validates DNSSEC and the token: dns.corp.lab may serve dev.corp.lab.", packets: [
      { from: "officeRes", to: "alfa", side: "alfa", label: "TXT + signatures" },
    ], marks: [{ node: "alfa", ok: true, text: "Scoped permission verified" }] },
    { caption: "Only this approved scope uses the office resolver; other names keep the client's normal DNS policy.", packets: [
      { from: "alfa", to: "officeRes", side: "alfa", label: "GitLab A?" },
    ] },
    { caption: "The proxy validates the private GitLab answer under the local DNSSEC key delegated by the record.", packets: [
      { from: "officeRes", to: "alfa", side: "alfa", label: "Signed private IP" },
    ], marks: [{ node: "alfa", ok: true, text: "Local answer validated" }] },
    { caption: "The employee can reach private GitLab. HTTPS is a separate connection from the client to the application.", packets: [
      { from: "alfa", to: "gitlab", side: "alfa", label: "HTTPS to GitLab" },
    ], marks: [{ node: "alfa", ok: true, text: "Private GitLab reachable" }] },
  ],
  hotel: [
    { caption: "Off the corporate VPN, the employee opens the same GitLab bookmark. The hotel claims dev.corp.lab.", packets: [
      { from: "router", to: "beta", side: "beta", label: "DNS setup" },
      { from: "router", to: "alfa", side: "alfa", label: "DNS claim" },
    ] },
    { caption: "A valid DNS-over-TLS certificate proves this is dns.hotel.lab, not that the company authorized it.", packets: [
      { from: "beta", to: "hotelRes", side: "beta", label: "GitLab A?" },
      { from: "hotelRes", to: "alfa", side: "alfa", label: "Hotel certificate" },
    ], marks: [{ node: "alfa", ok: true, text: "Hotel TLS identity verified" }] },
    { caption: "Network DNS returns an attacker-controlled address. SplitTrust asks whether the company approved this resolver.", packets: [
      { from: "hotelRes", to: "beta", side: "beta", label: "Attacker IP", dangerous: true },
      { from: "alfa", to: "hotelRes", side: "alfa", label: "Authorization TXT?" },
    ], marks: [{ node: "beta", ok: false, text: "Wrong DNS address accepted" }] },
    { caption: "The hotel relays the authorization lookup to the company's real public zone.", packets: [
      { from: "hotelRes", to: "cloud", side: "alfa", label: "Company permission?" },
    ] },
    { caption: "The public zone returns an authentic, signed denial: there is no authorization record for the hotel.", packets: [
      { from: "cloud", to: "hotelRes", side: "alfa", label: "Signed no-record proof" },
    ] },
    { caption: "The client-side proxy validates that denial. RECORD_MISSING means no grant for the hotel's private view.", packets: [
      { from: "hotelRes", to: "alfa", side: "alfa", label: "Signed denial" },
    ], marks: [{ node: "alfa", ok: false, text: "No company authorization" }] },
    { caption: "Without a grant, the normal DNS path still applies. SplitTrust continues to validate its answers.", packets: [
      { from: "alfa", to: "hotelRes", side: "alfa", label: "GitLab A?" },
    ] },
    { caption: "The invented GitLab address fails DNSSEC at the client-side proxy: SERVFAIL, not an attacker IP.", packets: [
      { from: "hotelRes", to: "alfa", side: "alfa", label: "Forged GitLab IP", dangerous: true },
    ], marks: [{ node: "alfa", ok: false, text: "Bogus answer blocked" }] },
    { caption: "The comparison is DNS trust: a wrong address accepted versus a bogus answer refused. HTTPS remains a separate safeguard." },
  ],
};

export function SceneArt({ place }: { place: Place }) {
  const hotel = place === "hotel";
  const steps = sequences[place];
  const [step, setStep] = useState(0);
  const reducedMotion = useReducedMotion();
  const shownStep = reducedMotion ? steps.length : step;
  const complete = shownStep >= steps.length;
  const current = steps[shownStep];
  const marks = [...new Map(steps.slice(0, shownStep).flatMap((item) => item.marks ?? []).map((mark) => [mark.node, mark])).values()];

  useEffect(() => {
    if (reducedMotion || step >= steps.length) return;
    const timer = window.setTimeout(() => setStep((value) => value + 1), 2100);
    return () => window.clearTimeout(timer);
  }, [step, steps.length, reducedMotion]);

  const edges: [NodeId, NodeId][] = hotel
    ? [["beta", "hotelRes"], ["alfa", "hotelRes"], ["hotelRes", "cloud"]]
    : [["beta", "officeRes"], ["alfa", "officeRes"], ["alfa", "gitlab"], ["officeRes", "cloud"]];

  const packetColour = (packet: Packet) => packet.dangerous ? RED : packet.side === "alfa" ? BLUE : INK;

  const label = (id: NodeId, text: string, sub?: string, dy = 58) => (
    <g transform={`translate(${P[id].x}, ${P[id].y + dy})`}>
      <text textAnchor="middle" fontSize={17} fontWeight={600} fill={INK}>{text}</text>
      {sub && <text y={20} textAnchor="middle" fontSize={13} fill={MUTED}>{sub}</text>}
    </g>
  );

  return (
    <div className="flex h-full w-full min-h-0 flex-col">
    <svg viewBox="0 0 1200 520" className="min-h-0 w-full min-w-0 max-w-full flex-1 select-none" role="img" aria-label={`${hotel ? "Hotel" : "Office"} example`}>
      {/* network area */}
      <rect x={60} y={350} width={1080} height={150} rx={24} fill={hotel ? "#fff7ed" : "#eff6ff"} />
      <text x={600} y={500} textAnchor="middle" fontSize={14} fontWeight={600} fill={hotel ? "#9a3412" : "#1e40af"}>{hotel ? "Hotel Wi-Fi" : "Office Wi-Fi"}</text>

      {edges.map(([a, b]) => {
        const active = current?.packets?.find((packet) => (packet.from === a && packet.to === b) || (packet.from === b && packet.to === a));
        return <motion.line key={a + b} x1={P[a].x} y1={P[a].y} x2={P[b].x} y2={P[b].y}
          animate={{ stroke: active ? packetColour(active) : LINE, strokeWidth: active ? 4 : 2 }}
          transition={{ duration: 0.25 }} />;
      })}
      {current?.marks?.some((mark) => mark.node === "alfa") && <motion.circle cx={P.alfa.x} cy={P.alfa.y} r={68}
        fill="#dbeafe" stroke={BLUE} strokeWidth={2} initial={{ opacity: 0 }} animate={{ opacity: 0.65 }} />}

      {/* actors */}
      <g transform={`translate(${P.router.x}, ${P.router.y})`}><Router tone={hotel ? "#9a3412" : "#1e40af"} /></g>
      <g transform={`translate(${P.beta.x}, ${P.beta.y})`}><Laptop /></g>
      {label("beta", "Network DNS, no verification")}
      <g transform={`translate(${P.alfa.x}, ${P.alfa.y})`}><Laptop tone={BLUE} /><g transform="translate(42,-30) scale(0.7)"><Shield tone={BLUE} /></g></g>
      {label("alfa", "Same laptop + SplitTrust proxy", "validation happens here")}

      {hotel ? (
        <>
          <g transform={`translate(${P.hotelRes.x}, ${P.hotelRes.y})`}><Resolver hostile /></g>
          {label("hotelRes", STORY.hotelResolver, `claims ${STORY.scope}`, 46)}
          <g transform={`translate(${P.attacker.x}, ${P.attacker.y})`}><Server tone={RED} fill="#fef2f2" /><Mask x={0} y={-50} /></g>
          {label("attacker", "Attacker-controlled endpoint", STORY.attackerIP)}
        </>
      ) : (
        <>
          <g transform={`translate(${P.officeRes.x}, ${P.officeRes.y})`}><Resolver tone={BLUE} /></g>
          {label("officeRes", "Company resolver", STORY.officeResolver, 46)}
          <rect x={50} y={26} width={330} height={128} rx={14} fill="#fff" stroke={LINE} strokeWidth={2} />
          <text x={70} y={55} fontSize={17} fontWeight={700} fill={INK}>Why a private DNS view?</text>
          <text x={70} y={83} fontSize={14} fill={MUTED}>Public DNS has no GitLab address.</text>
          <text x={70} y={108} fontSize={14} fill={MUTED}>Office DNS supplies the private IP.</text>
          <text x={70} y={135} fontSize={14} fontWeight={600} fill={BLUE}>Only the company may approve it.</text>
        </>
      )}
      <g transform={`translate(${P.gitlab.x}, ${P.gitlab.y})`}><Server tone={BLUE} /></g>
      {label("gitlab", "Company's private GitLab", hotel ? "requires office / VPN access" : STORY.privateIP)}
      <g transform={`translate(${P.cloud.x}, ${P.cloud.y})`}><Cloud /></g>
      <text x={P.cloud.x - 6} y={P.cloud.y + 2} textAnchor="middle" fontSize={16} fontWeight={700} fill={INK}>Company's public DNS</text>
      <text x={P.cloud.x - 6} y={P.cloud.y + 22} textAnchor="middle" fontSize={12} fill={MUTED}>supplies signed records, not verdicts</text>
      <g transform={`translate(${P.cloud.x + 84}, ${P.cloud.y - 42}) scale(0.9)`}><Lock tone={GREEN} /></g>

      <AnimatePresence>
        {current?.packets?.map((packet, index) => (
          <motion.g key={`${shownStep}-${index}`} data-testid="illustration-packet" data-from={packet.from} data-to={packet.to}
            initial={{ x: P[packet.from].x, y: P[packet.from].y, opacity: 0 }}
            animate={{ x: P[packet.to].x, y: P[packet.to].y, opacity: [0, 1, 1, 0] }}
            exit={{ opacity: 0 }} transition={{ duration: 1.35, ease: "easeInOut" }}>
            <circle r={10} fill={packetColour(packet)} stroke="#fff" strokeWidth={2} />
            <text y={-18} textAnchor="middle" fontSize={14} fontWeight={600} fill={packetColour(packet)}>{packet.label}</text>
          </motion.g>
        ))}
      </AnimatePresence>

      {/* marks */}
      {marks.map((m) => {
        const left = m.node === "alfa";
        const off = { x: left ? -62 : 62, y: -44 };
        return (
          <g key={`${m.node}-${m.text}`} role="group" aria-label={left ? "Client-side validation" : "Unverified DNS result"}
            transform={`translate(${P[m.node].x + off.x}, ${P[m.node].y + off.y})`}>
            <motion.g initial={reducedMotion ? false : { opacity: 0, scale: 0.4 }}
              animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.25 }}>
              <Mark ok={m.ok} />
              {m.text && <text x={left ? -20 : 20} y={5} textAnchor={left ? "end" : "start"} fontSize={15} fontWeight={600} fill={m.ok ? GREEN : RED}>{m.text}</text>}
            </motion.g>
          </g>
        );
      })}
    </svg>
    <p role="status" aria-label="Illustration step" aria-live="off" className="min-h-10 shrink-0 px-3 py-2 text-center text-sm text-slate-700">
      <span className="mr-3 font-semibold text-blue-700">{complete ? "Illustration complete" : `Step ${shownStep + 1} / ${steps.length}`}</span>
      {current?.caption ?? steps[steps.length - 1].caption}
    </p>
    </div>
  );
}
