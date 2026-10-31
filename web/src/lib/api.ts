/* Typed wrappers over the SplitTrust API. The console renders; it never computes verdicts. */

export type Device = "validating-stub" | "private-dns" | "hybrid";
export type Resolution = "via-network" | "iterative";
export type Decision = "accepted" | "rejected" | "indeterminate";

export interface Expected { device: Device; decision: Decision; reason: string }
export interface Summary {
  id: string; title: string; explanation: string; default_device: Device; example_qname: string;
  expected: Expected[]; trust_context: string; requires_internet: boolean;
}
export interface Stage { id: string; status: "pass" | "fail" | "error" | "skipped"; code?: string; message?: string; evidence?: unknown }
export interface Grant {
  resolver: string; scopes: string[]; expires_at: string; authorized_keys: string[];
  local_dnssec_mode: "delegated" | "not_established"; path: "dnssec" | "external"; external_ad: boolean; dot_addr: string;
}
export interface Inspection { canonical_resolver: string; canonical_parent: string; relative: string[]; scopes: string[]; whole_zone: boolean; algorithm: string; token: string; record_owner: string; warnings?: string[] }
export interface ClaimReport { index: number; resolver: string; decision: Decision; reason: string; stages: Stage[]; inspection?: Inspection; grant?: Grant }
export interface Run { schema_version: number; scenario_id: string; device: Device; resolution: Resolution; trust_context: string; decision: Decision; claims: ClaimReport[] }

export interface Lookup { via: string; rcode: string; ad: boolean; answers: string[]; ede?: string; page?: string; page_url?: string; page_error?: string; error?: string; millis: number }
export interface BrowseResult { name: string; device: Lookup; naive?: Lookup }

export interface LiveRecord {
  parent: string; record_owner: string; expected_token: string; checked_at: string; trust_context: string;
  txt: { security: string; rcode: string; answer?: string[]; why?: string; forwarder?: string; rrsig_expires_at?: string };
  ds: { security: string; rcode: string; answer?: string[]; why?: string };
}

export interface ClientStatus {
  scenario_id: string; title: string; device: Device; resolution: Resolution; trust_context: string; queries: number;
  grants: { resolver: string; scopes: string[]; decision: Decision; reason: string; expires_at?: string; local_dnssec_mode?: string; path?: string }[];
}
export interface ResolveReport {
  qname: string; device: Device; route: "local" | "default" | "none"; route_reason: string; via?: string; answers: string[];
  security?: string; verification?: Run; error_code?: string; error?: string; trust_context: string;
}

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  scenarios: () => call<Summary[]>("/api/scenarios"),
  capabilities: () => call<Record<string, unknown>>("/api/capabilities"),
  verify: (scenario_id: string, device?: Device, resolution?: Resolution) => call<Run>("/api/verify", { scenario_id, device: device ?? "", resolution: resolution ?? "" }),
  resolve: (scenario_id: string, qname: string, device?: Device, resolution?: Resolution) => call<ResolveReport>("/api/resolve", { scenario_id, qname, device: device ?? "", resolution: resolution ?? "" }),
  browse: (name: string, with_naive = true, naive_dns = "") => call<BrowseResult>("/api/browse", { name, with_naive, naive_dns }),
  live: (scenario_id: string) => call<LiveRecord>("/api/live", { scenario_id }),
  clientStatus: () => call<ClientStatus>("/api/client/status"),
  clientJoin: (scenario_id: string, device: Device) => call<ClientStatus>("/api/client/join", { scenario_id, device, resolution: "" }),
  inspect: (claim: unknown) => call<Inspection & { error?: string; detail?: string }>("/api/inspect", { claim }),
  build: (req: unknown) => call<{ claim: unknown; zone_line: string; txt: string; token: string; warnings: string[]; error?: string; detail?: string }>("/api/records/build", req),
};
