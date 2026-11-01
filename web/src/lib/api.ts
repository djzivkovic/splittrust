/* Typed wrappers over the SplitTrust API. The deck renders; it never computes verdicts. */

export type Device = "validating-stub" | "private-dns" | "hybrid";
export type Decision = "accepted" | "rejected" | "indeterminate";

export interface Summary {
  id: string; title: string; explanation: string; default_device: Device;
  trust_context: string; requires_internet: boolean; example_qname: string;
  expected: { device: Device; decision: Decision; reason: string }[];
}
export interface Stage { id: string; status: "pass" | "fail" | "error" | "skipped"; code?: string; message?: string; evidence?: unknown }
export interface Grant { resolver: string; scopes: string[]; path: "dnssec" | "external"; local_dnssec_mode: string; external_ad: boolean }
export interface Inspection { canonical_resolver: string; canonical_parent: string; scopes: string[]; token: string; record_owner: string; algorithm: string; salt_length: number }
export interface ClaimReport { index: number; resolver: string; decision: Decision; reason: string; stages: Stage[]; inspection?: Inspection; grant?: Grant }
export interface Run { scenario_id: string; device: Device; trust_context: string; decision: Decision; claims: ClaimReport[] }

export interface Lookup { via: string; rcode: string; ad: boolean; answers: string[]; ede?: string; dig?: string; page?: string; page_url?: string; page_error?: string; error?: string; millis: number }
export interface ProxyEvent { time: string; kind: "join" | "verify" | "query"; scenario?: string; device?: string; resolver?: string; decision?: string; reason?: string; name?: string; qtype?: string; rcode?: string; ad?: boolean; ede?: number; ede_name?: string; text?: string }
export interface LabProbe { name: string; group: string; role: string; addr: string; kind: string; ok: boolean; micros: number; detail?: string }
export interface ClientStatus { scenario_id: string; title: string; device: string; queries: number; grants: { resolver: string; decision: string; reason: string }[] }
export interface BrowseResult { name: string; device: Lookup; naive?: Lookup }

export interface DemoPreset {
  id: string; title: string; description: string; qname: string;
  verification_mode: "none" | "splittrust"; preview: string[];
}
export interface CommandResult {
  command: string[]; stdout: string; stderr: string; exit_code: number;
  duration_ms: number; truncated: boolean; error?: string;
}
export interface DNSResponse {
  qname: string; qtype: string; server: string; rcode: string; flags: string[];
  ad: boolean; answers: string[]; ede: { code: number; text: string }[];
}
export interface DemoProxyStatus {
  scenario_id: string; title: string; device: Device; resolution: string; trust_context: string;
  queries: number; last_verified?: string;
  grants: { resolver: string; scopes: string[] | null; decision: Decision; reason: string;
    expires_at?: string; local_dnssec_mode?: string; path?: string }[];
}
export interface DemoReport {
  preset_id: string; hostname: string; verification_mode: "none" | "splittrust";
  outcome: "redirected" | "blocked" | "authorized" | "not_redirected" | "inconclusive";
  summary: string; commands: CommandResult[]; dns_answer?: string; http_url?: string;
  dns?: DNSResponse; public_dns?: DNSResponse; proxy?: { status: DemoProxyStatus; events: ProxyEvent[] }; duration_ms: number;
}

export interface LiveRecord {
  parent: string; record_owner: string; expected_token: string; checked_at: string;
  txt: { security: string; rcode: string; answer?: string[]; why?: string };
  ds: { security: string; rcode: string; answer?: string[] };
}

export interface RecordBuildRequest {
  resolver: string; parent: string; subdomains: string[];
  algorithm: string; salt: string; ds: string[];
}
export interface RecordBuild {
  claim: Omit<RecordBuildRequest, "ds">;
  zone_line: string; token: string; record_owner: string; txt: string;
  signing_state: "secure" | "insecure" | "bogus" | "not_checked";
  trust_context: string; warnings: string[];
}
export interface BuildFailure { error: string; detail?: string }

async function call<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  let data: unknown = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text }; }
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}

export const api = {
  demoPresets: () => call<DemoPreset[]>("/api/demo/presets"),
  demoRun: (preset_id: string) => call<DemoReport>("/api/demo/run", { preset_id }),
  scenarios: () => call<Summary[]>("/api/scenarios"),
  verify: (scenario_id: string, device: Device) => call<Run>("/api/verify", { scenario_id, device, resolution: "" }),
  browse: (name: string, with_naive: boolean, naive_dns = "") => call<BrowseResult>("/api/browse", { name, with_naive, naive_dns }),
  live: (scenario_id: string) => call<LiveRecord>("/api/live", { scenario_id }),
  clientJoin: (scenario_id: string, device: Device) => call<unknown>("/api/client/join", { scenario_id, device, resolution: "" }),
  clientLog: () => call<{ lines: string[] }>("/api/client/log"),
  clientStatus: () => call<ClientStatus>("/api/client/status"),
  clientEvents: () => call<{ events: ProxyEvent[] }>("/api/client/events"),
  labStatus: () => call<{ checked_at: string; probes: LabProbe[] }>("/api/lab/status"),
  build: (req: RecordBuildRequest) => call<RecordBuild | BuildFailure>("/api/records/build", req),
  inspect: (claim: { resolver: string; parent: string; subdomains: string[]; algorithm: string; salt: string }) => call<Inspection & { pseudo_wire_hex: string; token_input_hex: string }>("/api/inspect", { claim }),
};
