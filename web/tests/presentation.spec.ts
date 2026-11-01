import { expect, test } from "@playwright/test";

for (const viewport of [{ width: 1366, height: 768 }, { width: 1280, height: 720 }]) {
  test(`RFC explanation labels stay inside the diagram at ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.route("**/api/scenarios", (route) => route.fulfill({ json: [] }));
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "SplitTrust", exact: true })).toBeVisible();
    for (let i = 0; i < 3; i += 1) {
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
}
