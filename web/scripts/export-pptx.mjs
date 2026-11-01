// Export the main pitch (the first N slides of the deck) to a PowerPoint file: one full-bleed
// screenshot per slide, speaker notes from docs/speech.md. Usage, from web/:
//   npm run build && npm run export:pptx            (serves dist/ on a free port)
//   PPTX_URL=http://127.0.0.1:8000 npm run export:pptx   (use a running console instead)
import { chromium } from "@playwright/test";
import pptxgen from "pptxgenjs";
import { spawn } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const out = process.env.PPTX_OUT ?? resolve(root, "docs", "SplitTrust-pitch.pptx");
const slides = Number(process.env.PPTX_SLIDES ?? 10);
const width = 1440, height = 810; // 16:9; the deck is laid out for about 1280 px of content, so this fills the slide

// Speaker notes: the "## N. Title (m:ss)" sections of docs/speech.md.
const speech = readFileSync(resolve(root, "docs", "speech.md"), "utf8");
const notes = new Map();
for (const m of speech.matchAll(/^## (\d+)\. [^\n]*\n([\s\S]*?)(?=^## |\n---\n)/gm)) {
  notes.set(Number(m[1]), m[2].trim().replace(/\n(?!\n)/g, " ").replace(/`/g, ""));
}

let server, url = process.env.PPTX_URL;
if (!url) {
  const port = 4173 + Math.floor(Math.random() * 500);
  server = spawn("npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: resolve(here, ".."), stdio: "ignore" });
  url = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { await fetch(url); break; } catch { await new Promise((r) => setTimeout(r, 200)); }
  }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce" });
await page.goto(url);
await page.waitForSelector("h1, h2");
// Presentation chrome that has no place on a printed slide.
await page.addStyleTag({ content: "footer{display:none !important} button{display:none !important} .pptx-hide{display:none !important}" });

mkdirSync(resolve(here, "..", ".pptx"), { recursive: true });
const shots = [];
for (let n = 1; n <= slides; n++) {
  if (n > 1) {
    const before = await page.locator("h1, h2").first().textContent();
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction((t) => document.querySelector("h1, h2")?.textContent !== t, before);
  }
  await page.waitForTimeout(700); // slide transition and reduced-motion reveal
  const file = resolve(here, "..", ".pptx", `slide-${String(n).padStart(2, "0")}.png`);
  await page.screenshot({ path: file, fullPage: false });
  shots.push({ n, file, title: (await page.locator("h1, h2").first().textContent())?.trim() ?? `Slide ${n}` });
}
await browser.close();
server?.kill();

const pptx = new pptxgen();
pptx.layout = "LAYOUT_16x9"; // 10 x 5.625 in
pptx.title = "SplitTrust: private DNS with the owner's permission";
pptx.author = "Team NXDOMAIN";
for (const s of shots) {
  const slide = pptx.addSlide();
  slide.addImage({ path: s.file, x: 0, y: 0, w: 10, h: 5.625 });
  if (notes.has(s.n)) slide.addNotes(notes.get(s.n));
}
await pptx.writeFile({ fileName: out });
console.log(`${shots.length} slides -> ${out}`);
for (const s of shots) console.log(`  ${s.n}. ${s.title}`);
