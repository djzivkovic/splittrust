/* Human sentences for machine codes. Verdicts come from the API; this maps them to words
   a room can follow. Lead with the consequence, follow with the mechanism, end with the RFC. */

import type { ClaimReport, Decision, Device, Grant, Stage } from "./api";

export type Tone = "green" | "yellow" | "red" | "grey";

export function toneFor(decision: Decision, reason: string, grant?: Grant): Tone {
  if (decision === "rejected") return "red";
  if (decision === "indeterminate") return "grey";
  if (reason === "EXTERNAL_TOKEN_MATCH" && !(grant && grant.external_ad)) return "yellow";
  if (grant && grant.local_dnssec_mode === "not_established") return "yellow";
  return "green";
}

export function runTone(claims: ClaimReport[], decision: Decision): Tone {
  if (decision !== "accepted") return decision === "rejected" ? "red" : "grey";
  return claims.some((c) => toneFor(c.decision, c.reason, c.grant) === "yellow") ? "yellow" : "green";
}

const short = (t?: string) => (t ? t.slice(0, 10) + "…" : "");

/* One sentence per stage outcome. */
export function stageSentence(st: Stage, c: ClaimReport): string {
  const r = c.resolver, scopes = c.inspection?.scopes.join(", ") ?? "the claimed names";
  switch (st.id) {
    case "pvd":
      if (st.status === "pass") return "The network's PvD document was fetched over HTTPS and lists its claims.";
      if (st.code === "INLINE_CLAIM") return "The claim arrived directly (DHCP-style); no PvD document to fetch.";
      return st.code === "PVD_EXPIRED" ? "The network's PvD document has expired; nothing in it counts." : "The network's PvD document is unusable.";
    case "claim":
      switch (st.code) {
        case "CLAIM_OK": return `${r} wants to answer for ${scopes}.`;
        case "SPECIAL_USE_NAME": return "That is a Special-Use Domain Name — the RFC says never verify these. Stop, no traffic.";
        case "CLAIM_RESOLVER_MISMATCH": return "The claim names a resolver the network did not announce. Stop, no traffic.";
        case "OUT_OF_LAB_SCOPE": return "Outside the lab's namespaces; the device sends nothing.";
        default: return "The claim is malformed.";
      }
    case "token":
      return `The device computes the token the owner must have published: ${short(c.inspection?.token)}`;
    case "resolver_tls":
      if (st.status === "pass") return `${r} proved its name over TLS — the certificate matches what was announced.`;
      if (st.code === "TLS_IDENTITY_FAILED") return `The resolver at the announced address cannot prove it is ${r}: its certificate is for someone else. Nothing more is asked of it.`;
      return "The announced resolver cannot be reached.";
    case "public_dnssec":
      switch (st.code) {
        case "DNSSEC_SECURE": return "The owner's record was fetched and every signature from the root down checks out.";
        case "DNSSEC_BOGUS": return "The owner's zone never signed what came back. Whoever sent it could not produce the chain of trust.";
        case "DNSSEC_INSECURE": return "The owner's zone is provably unsigned; this device may still ask its external resolver.";
        case "DNSSEC_INSECURE_NO_FALLBACK": return "The owner's zone is provably unsigned. This device has no one else to ask, so there is no proof — and no authority.";
        case "DNSSEC_INDETERMINATE": return "No trust anchor covers this name; the device cannot decide.";
        case "NOT_APPLICABLE": return "This device does not validate DNSSEC itself; it asks its external resolver.";
        case "DNS_LOOKUP_FAILED": return "The lookup failed before any verdict could be reached.";
        default: return st.message ?? "";
      }
    case "external_resolver":
      switch (st.code) {
        case "EXTERNAL_ANSWERED": return "Quad9 answered over authenticated TLS. The device now trusts Quad9's word about the owner's record.";
        case "EXTERNAL_TIMEOUT": return "The external resolver did not answer. The RFC says: then verification has failed. The hotel gained only a denial of service.";
        case "NOT_APPLICABLE": return "Not needed: the DNSSEC path already produced a verdict.";
        default: return st.message ?? "";
      }
    case "record":
      switch (st.code) {
        case "TOKEN_MATCH": return "The published token equals the one the device computed. The owner really did authorise this claim.";
        case "TOKEN_MISMATCH": return "The owner published a record — for a different claim. The tokens do not match.";
        case "RECORD_MISSING": return "The owner published nothing for this resolver. The network's claim stands alone.";
        case "RECORD_INVALID": return "The record exists but is not a well-formed Verification Record.";
        default: return st.message ?? "";
      }
    case "ds":
      switch (st.code) {
        case "DS_MATCH": return "The owner also delegated a DNSSEC key to this resolver; the resolver presented exactly that key.";
        case "DS_MISMATCH": return "The owner delegated a key, but the resolver presents a different one. No downgrade to 'token only' — rejected.";
        case "DS_NOT_PRESENT": return "No key was delegated: the resolver is authorised, but its answers cannot be validated locally.";
        case "NOT_APPLICABLE": return "Key delegation is not used on the external-resolver path.";
        default: return st.message ?? "";
      }
    case "grant":
      if (st.code === "AUTHORIZED") return `${r} may answer for ${scopes} until the record's signatures or TTL expire.`;
      if (st.code === "EXTERNAL_TOKEN_MATCH") return `${r} may answer for ${scopes} — on Quad9's word.`;
      return st.message ?? "";
    default:
      return st.message ?? "";
  }
}

/* The five human steps the checklist shows, each built from one or more stages. */
export interface Step { key: string; title: string; stages: string[] }
export const STEPS: Step[] = [
  { key: "claim", title: "Read the network's claim", stages: ["pvd", "claim", "token"] },
  { key: "tls", title: "Make the resolver prove its name", stages: ["resolver_tls"] },
  { key: "record", title: "Fetch the owner's record — where the network cannot forge it", stages: ["public_dnssec", "external_resolver"] },
  { key: "token", title: "Compare tokens", stages: ["record"] },
  { key: "ds", title: "Check the delegated key", stages: ["ds"] },
  { key: "grant", title: "Decide", stages: ["grant"] },
];

export type StepStatus = "pass" | "fail" | "skipped" | "pending";

export function stepStatus(step: Step, stages: Stage[], playedUpTo: number): StepStatus {
  const mine = stages.map((s, i) => ({ s, i })).filter(({ s }) => step.stages.includes(s.id));
  if (mine.length === 0) return "skipped";
  // still to be played: only stages that actually ran count; stages the device never
  // reached are "skipped" as soon as the animation has passed them
  if (mine.some(({ s, i }) => i > playedUpTo && s.status !== "skipped")) return "pending";
  if (mine.some(({ s }) => s.status === "fail" || s.status === "error")) return "fail";
  if (mine.every(({ s }) => s.status === "skipped")) return "skipped";
  return "pass";
}

/* What the verdict means for the person holding the device. */
export function consequence(c: ClaimReport, device: Device): string {
  const scopes = c.inspection?.scopes.join(", ") ?? "the claimed names";
  switch (c.reason) {
    case "AUTHORIZED":
      return c.grant?.local_dnssec_mode === "delegated"
        ? `Queries for ${scopes} go to ${c.resolver} over authenticated TLS, and every answer is validated under the key the owner delegated.`
        : `Queries for ${scopes} go to ${c.resolver} over authenticated TLS. No key was delegated, so answers are used but not validated (yellow).`;
    case "EXTERNAL_TOKEN_MATCH":
      return `Queries for ${scopes} go to ${c.resolver}. This authority rests on Quad9 saying the record exists — the zone itself is unsigned (yellow).`;
    case "DNSSEC_BOGUS": return `Nothing under ${scopes} will be sent to ${c.resolver}. The token was right; the owner's signature was missing. Signatures are the proof, not tokens.`;
    case "RECORD_MISSING": return `Nothing under ${scopes} will be sent to ${c.resolver}. The owner never published a record for it.`;
    case "TOKEN_MISMATCH": return `Nothing under ${scopes} will be sent to ${c.resolver}. Publish the new record before changing the claim (RFC 9704 §11).`;
    case "TLS_IDENTITY_FAILED": return `Nothing is sent to that resolver at all: it cannot prove it is ${c.resolver}. The replayed claim died before a single DNS query.`;
    case "DNSSEC_INSECURE_NO_FALLBACK": return device === "validating-stub"
      ? `This laptop cannot verify an unsigned zone and has nobody else to ask. ${scopes} stays on the normal path. Owner: sign your zone.`
      : `Unsigned zone, no external resolver to fall back on. ${scopes} stays on the normal path.`;
    case "DS_MISMATCH": return `Nothing under ${scopes} will be sent to ${c.resolver}: the owner delegated a key the resolver does not hold, and the device refuses to quietly settle for 'token only'.`;
    case "EXTERNAL_TIMEOUT": return `The phone could not reach Quad9, so it cannot verify anything on this network. It keeps its defaults; the hotel achieved only a denial of service.`;
    case "SPECIAL_USE_NAME": return `home.arpa and friends are never verified this way (RFC 9704 §3). Rejected with zero network traffic.`;
    case "CLAIM_RESOLVER_MISMATCH": return `The claim names a resolver this network never announced. Rejected before any query.`;
    case "DNS_LOOKUP_FAILED": case "RESOLVER_UNREACHABLE": return `The device could not reach what it needed, so it cannot decide — it keeps its defaults (grey, not red).`;
    default: return c.stages.find((s) => s.status === "fail" || s.status === "error")?.message ?? "";
  }
}

export const REASON_TITLES: Record<string, string> = {
  AUTHORIZED: "Authority established",
  EXTERNAL_TOKEN_MATCH: "Accepted on the external resolver's word",
  DNSSEC_BOGUS: "The owner never signed this",
  RECORD_MISSING: "The owner published nothing",
  TOKEN_MISMATCH: "Record is for a different claim",
  TLS_IDENTITY_FAILED: "Resolver cannot prove its name",
  DNSSEC_INSECURE_NO_FALLBACK: "Unsigned zone, no fallback",
  DS_MISMATCH: "Delegated key does not match",
  EXTERNAL_TIMEOUT: "External resolver unreachable",
  SPECIAL_USE_NAME: "Special-Use name — never verified",
  CLAIM_RESOLVER_MISMATCH: "Resolver was not announced",
  DNS_LOOKUP_FAILED: "Could not decide",
  RESOLVER_UNREACHABLE: "Resolver unreachable",
};
