/* Presentation metadata for the lab's networks and devices. Verdicts come from the API;
   this file only knows how to introduce each actor to a human. */

import type { Device } from "./api";

export interface DeviceCard { id: Device; name: string; short: string; blurb: string }

export const DEVICES: DeviceCard[] = [
  { id: "validating-stub", name: "Laptop", short: "validates DNSSEC itself",
    blurb: "Checks every DNSSEC signature itself. The network's resolver is only a forwarder. If a zone is unsigned there is nothing to check, so nothing is trusted." },
  { id: "private-dns", name: "Phone", short: "Private DNS via Quad9",
    blurb: "Sends all queries to Quad9 over TLS and verifies the owner's record through it. Its safety rests on Quad9. RFC 9704 section 6.1 calls this the external-resolver path." },
  { id: "hybrid", name: "Hybrid", short: "validates, falls back to Quad9",
    blurb: "Validates like the laptop. Only when a zone is provably unsigned does it ask Quad9 instead (RFC 9704 section 6.2, the recommended retry)." },
];

export interface NetworkVariant { id: string; label: string; announces: string; world: string }
export interface NetworkGroup { key: string; name: string; tagline: string; variants: NetworkVariant[]; requiresInternet?: boolean }

export const NETWORKS: NetworkGroup[] = [
  { key: "corp", name: "Corp Wi-Fi", tagline: "The company whose domain owner agreed.",
    variants: [{ id: "legit", label: "as configured",
      announces: "dns.corp.lab answers for internal.corp.lab; dns2.corp.lab answers for mail.corp.lab.",
      world: "corp.lab is DNSSEC-signed and publishes both Verification Records. The first one also delegates a key for internal.corp.lab." }] },
  { key: "hotel", name: "Hotel Guest", tagline: "Claims the bank. Four variants.",
    variants: [
      { id: "hotel", label: "plain hijack", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "The bank never published a record. The hotel relays the bank's signed denial unchanged and overrides www.banka.lab for its guests." },
      { id: "hotel-forged", label: "forged record", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "The hotel's resolver serves its own copy of banka.lab, including a Verification Record with the correct token. It wrote the claim, so it knows the token." },
      { id: "replay", label: "replayed claim", announces: "dns.corp.lab answers for internal.corp.lab (copied from the company word for word).",
        world: "The hotel's resolver sits at the announced address, but its certificate is for dns.hotel.lab." },
      { id: "hotel-blocks-external", label: "Quad9 blocked", announces: "dns.hotel.lab answers for everything under banka.lab.",
        world: "Port 853 to Quad9 is black-holed. A phone with Private DNS cannot reach its own resolver." },
    ] },
  { key: "cafe", name: "Startup Cafe", tagline: "Honest, but the zone is not signed.",
    variants: [{ id: "unsigned", label: "as configured", announces: "dns.unsigned.lab answers for internal.unsigned.lab.",
      world: "The record is published and correct, but unsigned.lab has no DNSSEC. A validating device has no proof. A phone with Private DNS takes Quad9's word for it." }] },
  { key: "branch", name: "Branch Office", tagline: "Well-meaning IT, three mistakes.",
    variants: [
      { id: "stale-salt", label: "stale record", announces: "dns.stale.lab answers for internal.stale.lab (with a new salt).",
        world: "IT changed the salt in the claim but the zone still carries the record for the old one." },
      { id: "expired-signature", label: "expired signatures", announces: "dns.expired.lab answers for internal.expired.lab.",
        world: "expired.lab is signed, but every signature expired an hour ago." },
      { id: "wrong-ds", label: "wrong key", announces: "dns.wrongds.lab answers for internal.wrongds.lab.",
        world: "The record's ds value points at a key the resolver does not have." },
    ] },
  { key: "home", name: "Home", tagline: "A router claiming home.arpa.",
    variants: [{ id: "special-use", label: "as configured", announces: "dns.corp.lab answers for printers.home.arpa.",
      world: "home.arpa is a Special-Use Domain Name (RFC 6761). RFC 9704 section 3 says such names must not be verified this way." }] },
  { key: "real", name: "Real Internet", tagline: "Our own zone, the real root, real Quad9.", requiresInternet: true,
    variants: [{ id: "real-zivkovic", label: "zivkovic.me", announces: "dns.splittrust.zivkovic.me answers for internal.splittrust.zivkovic.me.",
      world: "A Verification Record we published in the real, DNSSEC-signed zone zivkovic.me (Cloudflare), validated under the IANA root trust anchor." }] },
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
