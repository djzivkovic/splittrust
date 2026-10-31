/* The deck: a title, three scenes, a closing slide. Copy is deliberately short; the speaker carries
   the details. SecureCompany's zone is the real, DNSSEC-signed zivkovic.me; UnsecureCompany is unsecure.example. */

export type Place = "office" | "hotel";

export interface Scene {
  id: "real-office" | "real-hotel-forged" | "real-replay";
  place: Place;
  day: string;
  headline: string;
  sub: string;
  alfaName: string;        // what SecureCompany's employee opens
  betaName: string;        // what UnsecureCompany's employee opens
  betaDNS: string;         // the resolver UnsecureCompany's laptop is handed on this network
  takeaway: string;        // one line, appears when the animation is done
}

export const ALFA = { name: "SecureCompany", domain: "zivkovic.me", site: "zivkovic.me", intranet: "host.internal.splittrust.zivkovic.me" };
export const BETA = { name: "UnsecureCompany", domain: "unsecure.example" };

export const SCENES: Scene[] = [
  {
    id: "real-office", place: "office", day: "Demo 1",
    headline: "At the office",
    sub: "SecureCompany's laptop checks the claim; UnsecureCompany's laptop trusts the local resolver. Both open their intranet.",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.unsecure.example", betaDNS: "172.30.97.20:53",
    takeaway: "On a trusted network the difference is invisible.",
  },
  {
    id: "real-hotel-forged", place: "hotel", day: "Demo 2",
    headline: "At the hotel",
    sub: "The hotel's resolver claims both domains.",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.unsecure.example", betaDNS: "172.30.97.21:53",
    takeaway: "UnsecureCompany reaches the fake login. SecureCompany gets SERVFAIL with EDE 6 and never connects to the hotel's page.",
  },
  {
    id: "real-replay", place: "hotel", day: "Demo 3",
    headline: "What SecureCompany did",
    sub: "",
    alfaName: "host.internal.splittrust.zivkovic.me", betaName: "intranet.unsecure.example", betaDNS: "172.30.97.21:53",
    takeaway: "Copying the public record is not enough: the resolver must also prove the claimed name over TLS.",
  },
];

export const DEVICE_NAMES: Record<string, string> = { "validating-stub": "laptop", "private-dns": "phone", hybrid: "hybrid" };

export const REASONS: Record<string, string> = {
  AUTHORIZED: "accepted",
  EXTERNAL_TOKEN_MATCH: "verified via Quad9",
  DNSSEC_BOGUS: "DNSSEC validation failed, rejected",
  RECORD_MISSING: "no verification record, rejected",
  TOKEN_MISMATCH: "wrong record, rejected",
  TLS_IDENTITY_FAILED: "wrong certificate, rejected",
  EXTERNAL_TIMEOUT: "cannot reach Quad9",
  DNS_LOOKUP_FAILED: "no answer",
  RESOLVER_UNREACHABLE: "resolver unreachable",
};
