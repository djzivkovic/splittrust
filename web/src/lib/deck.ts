/* The deck: a title, three scenes, a closing slide. Copy is deliberately short; the speaker carries
   the details. Alfa's zone is the real, DNSSEC-signed zivkovic.me; Beta is beta.example. */

export type Place = "office" | "hotel";

export interface Scene {
  id: "real-office" | "real-hotel-forged" | "real-replay";
  place: Place;
  day: string;
  headline: string;
  sub: string;
  alfaName: string;        // what Alfa's employee opens
  betaName: string;        // what Beta's employee opens
  betaDNS: string;         // the resolver Beta's laptop is handed on this network
  takeaway: string;        // one line, appears when the animation is done
}

export const ALFA = { name: "Alfa", domain: "zivkovic.me", site: "zivkovic.me" };
export const BETA = { name: "Beta", domain: "beta.example" };

export const SCENES: Scene[] = [
  {
    id: "real-office", place: "office", day: "Monday",
    headline: "At the office",
    sub: "Both employees open their company intranet.",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.beta.example", betaDNS: "172.30.97.20:53",
    takeaway: "Both work. Only Alfa's laptop verified the resolver first: DoT identity, DNSSEC-validated TXT, token match.",
  },
  {
    id: "real-hotel-forged", place: "hotel", day: "Tuesday",
    headline: "At the hotel",
    sub: "Same employees, same habit, hotel Wi-Fi. The hotel's resolver claims both domains and serves forged copies.",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.beta.example", betaDNS: "172.30.97.21:53",
    takeaway: "Beta's login goes to the hotel's server. Alfa's laptop: Bogus record, SERVFAIL with EDE 6, nothing sent. Fails safe.",
  },
  {
    id: "real-replay", place: "hotel", day: "What Alfa did",
    headline: "Three things",
    sub: "Signed the zone. Published one record. Devices that check.",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.beta.example", betaDNS: "172.30.97.21:53",
    takeaway: "The record is public and can be copied. A copied claim fails on the resolver's certificate.",
  },
];

export const DEVICE_NAMES: Record<string, string> = { "validating-stub": "laptop", "private-dns": "phone", hybrid: "hybrid" };

export const REASONS: Record<string, string> = {
  AUTHORIZED: "verified",
  EXTERNAL_TOKEN_MATCH: "verified via Quad9",
  DNSSEC_BOGUS: "forged, rejected",
  RECORD_MISSING: "not authorised, rejected",
  TOKEN_MISMATCH: "wrong record, rejected",
  TLS_IDENTITY_FAILED: "wrong certificate, rejected",
  EXTERNAL_TIMEOUT: "cannot reach Quad9",
  DNS_LOOKUP_FAILED: "no answer",
  RESOLVER_UNREACHABLE: "resolver unreachable",
};
