/* Presentation metadata for the lab's networks and devices. Verdicts come from the API;
   this file only knows how to introduce each actor to a human. */

import type { Device } from "./api";

export interface DeviceCard { id: Device; name: string; blurb: string; icon: string }

export const DEVICES: DeviceCard[] = [
  { id: "validating-stub", name: "Laptop that validates DNSSEC", icon: "💻",
    blurb: "Checks every signature itself. The network's resolver is only a forwarder — if a zone is unsigned there is nothing to check, and nothing to trust." },
  { id: "private-dns", name: "Phone with Private DNS", icon: "📱",
    blurb: "Sends everything to Quad9 over TLS by default and verifies the owner's record through it. Its safety rests on Quad9 — the RFC calls this the external-resolver path (§6.1)." },
  { id: "hybrid", name: "Hybrid", icon: "🧭",
    blurb: "Validates like the laptop, and only when a zone is provably unsigned asks Quad9 instead (§6.2 'SHOULD retry')." },
];

export interface NetworkVariant { id: string; label: string; announces: string; world: string }
export interface NetworkGroup { key: string; ssid: string; icon: string; tagline: string; variants: NetworkVariant[]; requiresInternet?: boolean }

export const NETWORKS: NetworkGroup[] = [
  { key: "corp", ssid: "Corp Wi-Fi", icon: "🏢", tagline: "The company that actually agreed with its domain owner.",
    variants: [{ id: "legit", label: "as configured",
      announces: "dns.corp.lab answers for internal.corp.lab, and dns2.corp.lab for mail.corp.lab.",
      world: "corp.lab is DNSSEC-signed and publishes both Verification Records; the first also delegates a key for internal.corp.lab." }] },
  { key: "hotel", ssid: "Hotel Guest", icon: "🏨", tagline: "Claims the bank. Four tricks, one Wi-Fi.",
    variants: [
      { id: "hotel", label: "plays it straight", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "The bank never published a record. The hotel relays the bank's signed denial unchanged, and overrides www.banka.lab for its guests." },
      { id: "hotel-forged", label: "forges the record", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "The hotel's resolver serves its own banka.lab, including a Verification Record with the correct token — it wrote the claim, so it knows the token." },
      { id: "replay", label: "replays the company's claim", announces: "dns.corp.lab answers for internal.corp.lab (copied from the company, word for word).",
        world: "The hotel's resolver sits at the announced address, but it only has a certificate for dns.hotel.lab." },
      { id: "hotel-blocks-external", label: "blocks Quad9", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "Port 853 to Quad9 is black-holed. A Private-DNS phone cannot reach its own resolver." },
    ] },
  { key: "cafe", ssid: "Startup Café", icon: "☕", tagline: "Honest, but never signed its zone.",
    variants: [{ id: "unsigned", label: "as configured", announces: "dns.unsigned.lab answers for internal.unsigned.lab.",
      world: "The record is published and correct, but unsigned.lab has no DNSSEC. A validating device has no proof; a Private-DNS phone takes Quad9's word for it." }] },
  { key: "branch", ssid: "Branch Office", icon: "🏬", tagline: "Well-meaning IT, three different mistakes.",
    variants: [
      { id: "stale-salt", label: "stale record", announces: "dns.stale.lab answers for internal.stale.lab (with a new salt).",
        world: "IT changed the salt in the claim but the zone still carries the record for the old one." },
      { id: "expired-signature", label: "expired signatures", announces: "dns.expired.lab answers for internal.expired.lab.",
        world: "expired.lab is signed, but every RRSIG expired an hour ago." },
      { id: "wrong-ds", label: "wrong key", announces: "dns.wrongds.lab answers for internal.wrongds.lab.",
        world: "The record's ds value points at a key the resolver does not have." },
    ] },
  { key: "home", ssid: "Home", icon: "🏠", tagline: "A router claiming home.arpa.",
    variants: [{ id: "special-use", label: "as configured", announces: "dns.corp.lab answers for printers.home.arpa.",
      world: "home.arpa is a Special-Use Domain Name (RFC 6761). RFC 9704 §3: such names MUST NOT be validated this way." }] },
  { key: "real", ssid: "The real Internet", icon: "🌍", tagline: "Our own zone, the real root, real Quad9.", requiresInternet: true,
    variants: [{ id: "real-zivkovic", label: "zivkovic.me", announces: "dns.splittrust.zivkovic.me answers for internal.splittrust.zivkovic.me.",
      world: "A Verification Record we published in the real, DNSSEC-signed zivkovic.me (Cloudflare); validated under the IANA root trust anchor." }] },
];

export function findVariant(id: string): { group: NetworkGroup; variant: NetworkVariant } | undefined {
  for (const g of NETWORKS) for (const v of g.variants) if (v.id === id) return { group: g, variant: v };
  return undefined;
}

/* Names worth typing into the address bar on each network. */
export function suggestions(scenarioId: string): string[] {
  const g = findVariant(scenarioId)?.group.key;
  switch (g) {
    case "corp": return ["host.internal.corp.lab", "host.mail.corp.lab", "www.corp.lab"];
    case "hotel": return ["www.banka.lab", "host.internal.corp.lab"];
    case "cafe": return ["host.internal.unsigned.lab", "www.corp.lab"];
    case "branch": return ["host.internal.stale.lab", "host.internal.expired.lab", "host.internal.wrongds.lab"];
    case "home": return ["printers.home.arpa", "www.corp.lab"];
    default: return ["www.corp.lab"];
  }
}
