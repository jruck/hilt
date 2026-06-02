/**
 * Fast screenshot against the already-running isolated dev server (port 3019).
 * No build — just navigate + shoot, so visual iteration is ~seconds. On first run it
 * triggers a /rebuild to populate the graph index (vault is static across edits).
 *
 *   npx tsx scripts/graph-dev-shot.ts [tag]   # tag -> /tmp/hilt-graph-dev-<tag>.png
 */
import { chromium } from "playwright";

const PORT = Number(process.env.GRAPH_DEV_PORT || 3019);
const BASE = `http://127.0.0.1:${PORT}`;
const TAG = process.argv[2] || "latest";
const OUT_DESKTOP = `/tmp/hilt-graph-dev-${TAG}.png`;
const OUT_MOBILE = `/tmp/hilt-graph-dev-${TAG}-mobile.png`;
const WITH_MOBILE = process.env.GRAPH_DEV_MOBILE === "1";

async function main() {
  // Wait for the dev server + flag-on meta route.
  await waitForMeta();
  // Ensure the graph index exists (first run builds; later runs are no-ops/fast).
  const meta = await (await fetch(`${BASE}/api/system/graph/meta`)).json().catch(() => ({}));
  if (!meta || meta.builtAt == null) {
    process.stdout.write("• building graph index (POST /rebuild)…\n");
    const r = await fetch(`${BASE}/api/system/graph/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    process.stdout.write("  " + (await r.text()).slice(0, 200) + "\n");
  }

  const browser = await chromium.launch();
  try {
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
    const dp = await desktop.newPage();
    await dp.goto(`${BASE}/system/graph`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await dp.getByTestId("graph-canvas").waitFor({ timeout: 90_000 });
    await dp.waitForTimeout(3500);
    await dp.screenshot({ path: OUT_DESKTOP });
    process.stdout.write(`  ✓ ${OUT_DESKTOP}\n`);
    await desktop.close();

    if (WITH_MOBILE) {
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "light", isMobile: true, hasTouch: true });
      const mp = await mobile.newPage();
      await mp.goto(`${BASE}/system/graph`, { waitUntil: "domcontentloaded", timeout: 90_000 });
      await mp.getByTestId("graph-view").waitFor({ timeout: 90_000 });
      await mp.waitForTimeout(3500);
      await mp.screenshot({ path: OUT_MOBILE });
      process.stdout.write(`  ✓ ${OUT_MOBILE}\n`);
      await mobile.close();
    }
  } finally {
    await browser.close();
  }
}

async function waitForMeta() {
  for (let i = 0; i < 180; i++) {
    try {
      const r = await fetch(`${BASE}/api/system/graph/meta`, { cache: "no-store" });
      if (r.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((res) => setTimeout(res, 1000));
  }
  throw new Error(`dev server not ready at ${BASE}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
