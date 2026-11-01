import { expect, test, type Page } from "@playwright/test";

const scenarios = [
  {
    id: "legit", title: "Company network", explanation: "The company approved its resolver.",
    default_device: "validating-stub", trust_context: "lab", requires_internet: false,
    example_qname: "host.internal.corp.lab",
    expected: [{ device: "validating-stub", decision: "accepted", reason: "AUTHORIZED" }],
  },
  {
    id: "wrong-ds", title: "Wrong ds key binding", explanation: "The published DS does not match the resolver key.",
    default_device: "validating-stub", trust_context: "lab", requires_internet: false,
    example_qname: "host.internal.wrongds.lab",
    expected: [{ device: "hybrid", decision: "rejected", reason: "DS_MISMATCH" }],
  },
];

async function openDemo(page: Page) {
  await page.route("**/api/scenarios", (route) => route.fulfill({ json: scenarios }));
  await page.route("**/api/demo/presets", (route) => route.fulfill({ json: [] }));
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Try SplitTrust", exact: true })).toBeVisible();
}

test("closing button opens a standalone playground that survives reload", async ({ page }) => {
  await page.route("**/api/scenarios", (route) => route.fulfill({ json: scenarios }));
  await page.route("**/api/demo/presets", (route) => route.fulfill({ json: [] }));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("footer")).toContainText(`${i + 2} /`);
  }
  await page.getByRole("link", { name: "Try it yourself" }).click();
  await expect(page).toHaveURL(/\/demo$/);
  await expect(page.getByRole("heading", { name: "Try SplitTrust", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Try SplitTrust", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Back to presentation" }).click();
  await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
});

test("playground can open the appendix directly, refresh there, and return Home", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole("link", { name: "Back to presentation", exact: true })).toHaveAttribute("href", "/");
  const appendix = page.getByRole("link", { name: "Go to appendix", exact: true });
  await expect(appendix).toHaveAttribute("href", "/#appendix");
  await appendix.click();
  await expect(page).toHaveURL(/\/#appendix$/);
  await expect(page.getByRole("heading", { name: "Why this standard is worth implementing", exact: true })).toBeVisible();
  await expect(page.locator("footer")).toContainText("Appendix");
  await expect(page.locator("footer")).toContainText("1 / 9");
  await page.reload();
  await expect(page.getByRole("heading", { name: "Why this standard is worth implementing", exact: true })).toBeVisible();
  await expect(page.locator("footer")).toContainText("Appendix");
  await page.keyboard.press("Home");
  await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.locator("footer")).toContainText("Main pitch");
});

test("playground focuses on the terminal story and owner tool, not the scenario catalogue", async ({ page }) => {
  await openDemo(page);
  await expect(page.getByRole("tab", { name: "Live terminal" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Build a record" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Run a scenario" })).toHaveCount(0);
  await expect(page.getByLabel("Scenario", { exact: true })).toHaveCount(0);
});

test("owner output comes from the builder and disappears when its input changes", async ({ page }) => {
  await page.route("**/api/records/build", async (route) => {
    expect(route.request().postDataJSON().parent).toBe("corp.lab");
    await route.fulfill({ json: {
      claim: { resolver: "dns.corp.lab", parent: "corp.lab", subdomains: ["internal"], algorithm: "SHA384", salt: "AA" },
      zone_line: 'dns.corp.lab._splitdns-challenge.corp.lab. 60 IN TXT "token=fixture-token"',
      record_owner: "dns.corp.lab._splitdns-challenge.corp.lab.", token: "fixture-token", txt: "token=fixture-token",
      signing_state: "not_checked", trust_context: "lab",
      warnings: ["The parent zone's signing status has not been checked."],
    } });
  });
  await openDemo(page);
  await page.getByRole("tab", { name: "Build a record" }).click();
  await page.getByLabel("Resolver name", { exact: true }).fill("dns.corp.lab");
  await page.getByLabel("Parent zone", { exact: true }).fill("corp.lab");
  await page.getByLabel("Subdomains", { exact: true }).fill("internal");
  await page.getByRole("button", { name: "Generate record", exact: true }).click();
  await expect(page.getByRole("region", { name: "Generated record" })).toContainText("fixture-token");
  await expect(page.getByText("The parent zone's signing status has not been checked.", { exact: true })).toBeVisible();
  await page.getByLabel("Subdomains", { exact: true }).fill("different");
  await expect(page.getByRole("region", { name: "Generated record" })).toHaveCount(0);
});

test("owner validation errors returned with HTTP 200 are still errors", async ({ page }) => {
  await page.route("**/api/records/build", (route) => route.fulfill({
    json: { error: "INVALID_CLAIM", detail: "salt is not base64url", trust_context: "lab" },
  }));
  await openDemo(page);
  await page.getByRole("tab", { name: "Build a record" }).click();
  await page.getByRole("button", { name: "Generate record", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("salt is not base64url");
  await expect(page.getByRole("region", { name: "Generated record" })).toHaveCount(0);
});
