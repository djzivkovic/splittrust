/* Typed wrappers over the SplitTrust API. The deck renders; it never computes verdicts. */

export type Device = "validating-stub" | "private-dns" | "hybrid";
export type Decision = "accepted" | "rejected" | "indeterminate";

export interface Summary { id: string; title: string; default_device: Device; trust_context: string; requires_internet: boolean }
export interface Stage { id: string; status: "pass" | "fail" | "error" | "skipped"; code?: string; message?: string; evidence?: unknown }
export interface Grant { resolver: string; scopes: string[]; path: "dnssec" | "external"; local_dnssec_mode: string; external_ad: boolean }
export interface Inspection { canonical_resolver: string; canonical_parent: string; scopes: string[]; token: string; record_owner: string; algorithm: string; salt_length: number }
export interface ClaimReport { index: number; resolver: string; decision: Decision; reason: string; stages: Stage[]; inspection?: Inspection; grant?: Grant }
export interface Run { scenario_id: string; device: Device; trust_context: string; decision: Decision; claims: ClaimReport[] }

export interface Lookup { via: string; rcode: string; ad: boolean; answers: string[]; ede?: string; dig?: string; page?: string; page_url?: string; page_error?: string; error?: string; millis: number }
export interface LabProbe { name: string; role: string; addr: string; kind: string; ok: boolean; millis: number; detail?: string }
export interface BrowseResult { name: string; device: Lookup; naive?: Lookup }

export interface LiveRecord {
  parent: string; record_owner: string; expected_token: string; checked_at: string;
  txt: { security: string; rcode: string; answer?: string[]; why?: string };
  ds: { security: string; rcode: string; answer?: string[] };
}

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  scenarios: () => call<Summary[]>("/api/scenarios"),
  verify: (scenario_id: string, device: Device) => call<Run>("/api/verify", { scenario_id, device, resolution: "" }),
  browse: (name: string, with_naive: boolean, naive_dns = "") => call<BrowseResult>("/api/browse", { name, with_naive, naive_dns }),
  live: (scenario_id: string) => call<LiveRecord>("/api/live", { scenario_id }),
  clientJoin: (scenario_id: string, device: Device) => call<unknown>("/api/client/join", { scenario_id, device, resolution: "" }),
  clientLog: () => call<{ lines: string[] }>("/api/client/log"),
  labStatus: () => call<{ checked_at: string; probes: LabProbe[] }>("/api/lab/status"),
  inspect: (claim: { resolver: string; parent: string; subdomains: string[]; algorithm: string; salt: string }) => call<Inspection & { pseudo_wire_hex: string; token_input_hex: string }>("/api/inspect", { claim }),
};
