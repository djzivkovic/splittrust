import { expect, test, type Page } from "@playwright/test";

const presets = [
  { id: "office-authorized", title: "Office: open GitLab", description: "Compare public and office DNS, then open the private GitLab page.", verification_mode: "splittrust", qname: "git.dev.corp.lab" },
  { id: "hotel-unverified", title: "Hotel: trust the Wi-Fi", description: "The same name leads to the hotel's fake login page.", verification_mode: "none", qname: "git.dev.corp.lab" },
  { id: "hotel-protected", title: "Hotel: verify with SplitTrust", description: "The proxy rejects the hotel's claim and bogus answer.", verification_mode: "splittrust", qname: "git.dev.corp.lab" },
];
const unverified = {
  preset_id: "hotel-unverified", hostname: "demo-app-fixture", verification_mode: "none",
  outcome: "redirected", summary: "The unverified client reached the hotel's fake page.",
  dns_answer: "172.30.97.66", http_url: "http://git.dev.corp.lab/", duration_ms: 42,
  commands: [
    { command: ["dig", "@172.30.97.21", "git.dev.corp.lab", "A"], stdout: "git.dev.corp.lab. 60 IN A 172.30.97.66\n", stderr: "", exit_code: 0, duration_ms: 20, truncated: false },
    { command: ["curl", "--resolve", "git.dev.corp.lab:80:172.30.97.66", "http://git.dev.corp.lab/"], stdout: "FAKE PAGE / GITLAB LOGIN: served by the hotel's resolver\n", stderr: "", exit_code: 0, duration_ms: 22, truncated: false },
  ],
};

async function openTerminal(page: Page) {
  await page.route("**/api/scenarios", (route) => route.fulfill({ json: [] }));
  await page.route("**/api/demo/presets", (route) => route.fulfill({ json: presets }));
  await page.goto("/demo");
  await expect(page.getByRole("tab", { name: "Live terminal" })).toHaveAttribute("aria-selected", "true");
}

test("unverified attack runs a preset and shows real command output above its report", async ({ page }) => {
  await page.route("**/api/demo/run", async (route) => {
    expect(route.request().postDataJSON()).toEqual({ preset_id: "hotel-unverified" });
    await route.fulfill({ json: unverified });
  });
  await openTerminal(page);
  await page.getByRole("button", { name: "Hotel: trust the Wi-Fi", exact: true }).click();
  await expect(page.getByText("dig is the client; the SplitTrust proxy performs validation.", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  const transcript = page.getByRole("region", { name: "Command transcript" });
  await expect(transcript).toContainText("demo-app-fixture");
  await expect(transcript).toContainText("FAKE PAGE / GITLAB LOGIN");
  await expect(transcript).toContainText("exit 0");
  const report = page.getByRole("region", { name: "Demo outcome" });
  await expect(report).toContainText("Attack succeeded in the lab");
  await expect(report).toContainText("No DNSSEC or RFC 9704 verification");
  const terminalBox = await transcript.boundingBox();
  const reportBox = await report.boundingBox();
  expect(reportBox!.y).toBeGreaterThanOrEqual(terminalBox!.y + terminalBox!.height);
  await expect(page.getByText("This HTTP lab demonstrates DNS redirection, not an HTTPS certificate bypass.", { exact: true })).toBeVisible();
});

test("dig SERVFAIL with proxy evidence is a blocked attack, not a runner crash", async ({ page }) => {
  await page.route("**/api/demo/run", (route) => route.fulfill({ json: {
    preset_id: "hotel-protected", hostname: "demo-app-fixture", verification_mode: "splittrust",
    outcome: "blocked", summary: "The validating lookup rejected the forged DNS answer.", duration_ms: 50,
    commands: [{ command: ["dig", "@172.30.97.63", "git.dev.corp.lab", "A", "+dnssec"], stdout: "status: SERVFAIL\n; EDE: 6 (DNSSEC Bogus)", stderr: "", exit_code: 0, duration_ms: 50, truncated: false }],
    dns: { qname: "git.dev.corp.lab.", qtype: "A", server: "172.30.97.63:53", rcode: "SERVFAIL", ad: false, flags: ["qr", "rd", "ra"], answers: [], ede: [{ code: 6, text: "(DNSSEC Bogus)" }] },
    proxy: { status: { scenario_id: "gitlab-hotel", device: "validating-stub", trust_context: "lab", grants: [{ resolver: "dns.hotel.lab", scopes: ["dev.corp.lab"], decision: "rejected", reason: "RECORD_MISSING" }] },
      events: [{ kind: "verify", resolver: "dns.hotel.lab", decision: "rejected", reason: "RECORD_MISSING" }] },
  } }));
  await openTerminal(page);
  await page.getByRole("button", { name: "Hotel: verify with SplitTrust", exact: true }).click();
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  await expect(page.getByRole("region", { name: "Command transcript" })).toContainText("exit 0");
  await expect(page.getByRole("heading", { name: "Attack blocked", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "DNS response" })).toContainText("SERVFAIL");
  await expect(page.getByRole("region", { name: "Proxy evidence" })).toContainText("RECORD_MISSING");
  await expect(page.getByText("dig is the client; the SplitTrust proxy performs validation.", { exact: true })).toBeVisible();
});

test("failed command execution never becomes the preset's expected success", async ({ page }) => {
  await page.route("**/api/demo/run", (route) => route.fulfill({ json: {
    ...unverified, outcome: "inconclusive", summary: "The DNS command timed out.", dns_answer: "",
    commands: [{ command: ["dig", "@172.30.97.21", "git.dev.corp.lab"], stdout: "", stderr: "connection timed out", exit_code: 9, duration_ms: 2000, truncated: false }],
  } }));
  await openTerminal(page);
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run inconclusive", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Command transcript" })).toContainText("connection timed out");
  await expect(page.getByRole("heading", { name: "Attack succeeded in the lab", exact: true })).toHaveCount(0);
});

test("a busy or unavailable Docker runner is visible and retryable", async ({ page }) => {
  await page.route("**/api/demo/run", (route) => route.fulfill({
    status: 409, json: { error: "A demo command is already running." },
  }));
  await openTerminal(page);
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("already running");
  await expect(page.getByRole("button", { name: "Run commands", exact: true })).toBeEnabled();
  await expect(page.getByRole("region", { name: "Demo outcome" })).toHaveCount(0);
});

test("a proxy claim failure without a parsed scope stays visible as inconclusive", async ({ page }) => {
  await page.route("**/api/demo/run", (route) => route.fulfill({ json: {
    preset_id: "hotel-protected", hostname: "demo-app-fixture", verification_mode: "splittrust",
    outcome: "inconclusive", summary: "The DNS response and proxy evidence do not establish the expected outcome.", duration_ms: 50,
    commands: [{ command: ["dig", "@172.30.97.63", "git.dev.corp.lab", "A", "+dnssec"], stdout: "status: SERVFAIL", stderr: "", exit_code: 0, duration_ms: 50, truncated: false }],
    dns: { qname: "git.dev.corp.lab.", qtype: "A", server: "172.30.97.63:53", rcode: "SERVFAIL", ad: false, flags: ["qr", "rd", "ra"], answers: [], ede: [{ code: 6, text: "(DNSSEC Bogus)" }] },
    proxy: { status: { scenario_id: "gitlab-hotel", device: "validating-stub", trust_context: "lab",
      grants: [{ resolver: "", scopes: null, decision: "indeterminate", reason: "PVD_INVALID" }] },
      events: [{ kind: "verify", decision: "indeterminate", reason: "PVD_INVALID" }] },
  } }));
  await openTerminal(page);
  await page.getByRole("button", { name: "Hotel: verify with SplitTrust", exact: true }).click();
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Run inconclusive", exact: true })).toBeVisible();
  await expect(page.getByRole("region", { name: "Proxy evidence" })).toContainText("PVD_INVALID");
  await expect(page.getByRole("region", { name: "Proxy evidence" })).toContainText("Not established");
});

test("office story starts with the business need and shows real public versus private DNS", async ({ page }) => {
  await page.route("**/api/demo/run", (route) => route.fulfill({ json: {
    preset_id: "office-authorized", hostname: "demo-app-fixture", verification_mode: "splittrust",
    outcome: "authorized", summary: "Public DNS has no GitLab address; the office resolver returned the private address and the GitLab page loaded.",
    dns_answer: "10.20.0.10", http_url: "http://git.dev.corp.lab/", duration_ms: 42,
    commands: [{ command: ["dig", "@172.30.97.10", "git.dev.corp.lab", "A"], stdout: "status: NXDOMAIN", stderr: "", exit_code: 0, duration_ms: 10, truncated: false }],
    public_dns: { qname: "git.dev.corp.lab.", qtype: "A", server: "172.30.97.10:53", rcode: "NXDOMAIN", ad: false, flags: ["qr", "aa"], answers: [], ede: [] },
    dns: { qname: "git.dev.corp.lab.", qtype: "A", server: "172.30.97.63:53", rcode: "NOERROR", ad: true, flags: ["qr", "ra", "ad"], answers: ["10.20.0.10"], ede: [] },
  } }));
  await openTerminal(page);
  await expect(page.getByRole("heading", { name: "Private code. One hostname. Two DNS views.", exact: true })).toBeVisible();
  await expect(page.getByText(/source code stays on the company network/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Office: open GitLab", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "Run commands", exact: true }).click();
  await expect(page.getByRole("region", { name: "Split-horizon comparison" })).toContainText("NXDOMAIN");
  await expect(page.getByRole("region", { name: "Split-horizon comparison" })).toContainText("10.20.0.10");
});
