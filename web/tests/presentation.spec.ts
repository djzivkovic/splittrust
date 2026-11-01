import { expect, test, type Locator, type Page } from "@playwright/test";

async function nextSlide(page: Page) {
  const title = await page.getByRole("heading").first().textContent();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("heading").first()).not.toHaveText(title!);
}

async function expectLockAboveLabel(diagram: Locator, label: string) {
  const lock = await diagram.locator('rect[fill="#15803d"]').locator("..").boundingBox();
  const text = await diagram.getByText(label, { exact: true }).boundingBox();
  expect(lock).not.toBeNull();
  expect(text).not.toBeNull();
  expect(lock!.y + lock!.height, `Lock must not overlap "${label}"`).toBeLessThanOrEqual(text!.y - 4);
}

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  test(`RFC explanation labels stay inside the diagram at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/scenarios", (route) => route.fulfill({ json: [] }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
    for (let i = 0; i < 2; i += 1) {
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("footer")).toContainText(`${i + 2} /`);
    }

    const diagram = page.getByRole("img", { name: "The three steps of RFC 9704" });
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveCSS("opacity", "1");

    const clipped = await diagram.evaluate((svg) => {
      const boundary = svg.getBoundingClientRect();
      return [...svg.querySelectorAll("text")].flatMap((text) => {
        const box = text.getBoundingClientRect();
        return box.left < boundary.left - 1 || box.right > boundary.right + 1
          || box.top < boundary.top - 1 || box.bottom > boundary.bottom + 1
          ? [text.textContent] : [];
      });
    });
    expect(clipped, "Every diagram label must be fully readable, not cropped by the SVG viewport").toEqual([]);
  });

  test(`architecture cloud clears the component boxes at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
    const diagram = page.getByRole("img", { name: "Architecture", exact: true });
    for (let n = 0; n < 20 && await diagram.count() === 0; n++) await nextSlide(page);
    await expect(diagram).toBeVisible();
    await expect(page.locator("#root > div > div:first-child > div").first()).toHaveCSS("opacity", "1");
    const bottom = await diagram.locator(":scope > rect").evaluateAll((boxes) => Math.max(...boxes.map((box) => box.getBoundingClientRect().bottom)));
    const cloud = await diagram.locator('path[d^="M -88 40"]').boundingBox();
    expect(cloud).not.toBeNull();
    expect(cloud!.y, "The public-zone cloud needs visible space below both architecture boxes").toBeGreaterThanOrEqual(bottom + 12);
    await expectLockAboveLabel(diagram, "zivkovic.me");
  });

  test(`example cloud locks clear their labels at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
    for (let n = 1; n < 4; n++) await nextSlide(page);
    for (const name of ["Office example", "Hotel example"]) {
      const diagram = page.getByRole("img", { name, exact: true });
      await expect(diagram).toBeVisible();
      await expectLockAboveLabel(diagram, "Company's public DNS");
      await nextSlide(page);
    }
  });
}

test("every presentation slide works without the API and never starts a live check", async ({ page }) => {
  const requests: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();

  const titles = [
    "SplitTrust", "Private DNS needs proof of permission", "How it works, in three steps",
    "At the office", "At the hotel", "What the company configures",
    "From RFC to a working DNS path", "What we built and demonstrated", "Private DNS, with the owner's permission",
    "Why this standard is worth implementing", "Architecture and test environment", "How the proxy decides",
    "What SplitTrust implements", "Who benefits, and who deploys it", "Different protections answer different questions",
    "What changes for a company", "What the owner publishes", "Next: one managed-device pilot",
  ];
  for (let slide = 1; slide <= titles.length; slide += 1) {
    await expect(page.locator("footer")).toContainText(`${slide <= 9 ? slide : slide - 9} / 9`);
    await expect(page.getByRole("heading", { name: titles[slide - 1], exact: true })).toBeVisible();
    await expect(page.locator("footer")).toContainText(slide <= 9 ? "Main pitch" : "Appendix");
    await expect(page.getByRole("button", { name: /laptop|phone/i })).toHaveCount(0);
    await expect(page.getByText("Resolver decisions", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/^Demo [123]$/)).toHaveCount(0);
    if (slide >= 4 && slide <= 6) {
      await expect(page.getByText("Illustration", { exact: true })).toBeVisible();
      for (const key of ["1", "2", "t", "e", " "]) await page.keyboard.press(key);
    }
    if (slide === 12) {
      await expect(page.getByRole("heading", { name: "How the proxy decides", exact: true })).toBeVisible();
      // Cover the old four-second polling interval without mocking animation clocks.
      await page.waitForTimeout(4500);
    }
    if (slide === 9) await expect(page.getByRole("link", { name: "Try it yourself" })).toHaveAttribute("href", "/demo");
    if (slide === 17) {
      await expect(page.getByRole("heading", { name: "What the owner publishes", exact: true })).toBeVisible();
      await expect(page.getByRole("textbox")).toHaveCount(0);
      await page.waitForTimeout(400);
    }
    for (const button of await page.getByRole("button").all()) await button.click();
    if (slide < titles.length) await nextSlide(page);
  }
  expect(requests, "Presentation navigation and local controls must not contact the backend").toEqual([]);
  expect(errors).toEqual([]);
});

for (const example of [
  { slide: 4, title: "At the office", mark: "Private GitLab reachable", proof: "TXT + signatures" },
  { slide: 5, title: "At the hotel", mark: "Bogus answer blocked", proof: "Signed denial" },
]) {
  test(`${example.title} animates packets, reveals checks and replays without the API`, async ({ page }) => {
    const requests: string[] = [];
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.route("**/api/**", (route) => {
      requests.push(route.request().url());
      return route.abort();
    });
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
    for (let slide = 1; slide < example.slide; slide++) {
      await page.keyboard.press("ArrowRight");
      await expect(page.locator("footer")).toContainText(`${slide + 1} /`);
    }
    await expect(page.getByRole("heading", { name: example.title, exact: true })).toBeVisible();
    await expect(page.getByText("Same employee, same GitLab bookmark", { exact: true })).toBeVisible();
    await expect(page.getByText("git.dev.corp.lab", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "Replay illustration", exact: true }).click();
    const progress = page.getByRole("status", { name: "Illustration step" });
    await expect(progress).toContainText("Step 1");
    await expect(page.getByText(example.mark, { exact: true })).toHaveCount(0);
    const packet = page.getByTestId("illustration-packet").first();
    await expect(packet).toBeVisible();
    const startX = await packet.evaluate((node) => Math.round(node.getBoundingClientRect().x));
    await expect.poll(() => packet.evaluate((node) => Math.round(node.getBoundingClientRect().x)), { timeout: 700 }).not.toBe(startX);
    const proof = page.getByTestId("illustration-packet").filter({ hasText: example.proof });
    await expect(proof).toBeVisible({ timeout: 16000 });
    await expect(proof).toHaveAttribute("data-to", "alfa");
    await expect(progress).toContainText("Illustration complete", { timeout: 24000 });
    await expect(page.getByText(example.mark, { exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Client-side validation" })).toContainText(example.mark);
    await expect(page.getByText("Forged authorization fails", { exact: true })).toHaveCount(0);
    await page.locator("body").click({ position: { x: 5, y: 5 } });
    await page.keyboard.press(" ");
    await expect(progress).toContainText("Step 1");
    await expect(page.getByText(example.mark, { exact: true })).toHaveCount(0);
    expect(requests).toEqual([]);
  });
}
