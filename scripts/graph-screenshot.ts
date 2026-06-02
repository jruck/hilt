/**
 * One-off: capture the System -> Graph view against the REAL vault so we can eyeball
 * the actual render. Builds flag-on, starts next on a temp port + temp DATA_DIR (so it
 * never touches the live :3000 server or its data), rebuilds the graph index, then
 * screenshots desktop + mobile viewports to /tmp.
 *
 *   npx tsx scripts/graph-screenshot.ts [vaultPath]
 */
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { chromium } from "playwright";

const HOST = "127.0.0.1";
const VAULT = process.argv[2] || "/Users/jruck/work/bridge";
const OUT_DESKTOP = "/tmp/hilt-graph-desktop.png";
const OUT_MOBILE = "/tmp/hilt-graph-mobile.png";

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-graph-shot-data-"));
  const env = {
    ...process.env,
    HILT_GRAPH_ENABLED: "true",
    DATA_DIR: dataDir,
    BRIDGE_VAULT_PATH: VAULT,
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete (env as Record<string, unknown>).HILT_WORKING_FOLDER;

  console.log("• Building flag-on (next build)…");
  const build = spawnSync("npx", ["next", "build"], { cwd: process.cwd(), env, stdio: "inherit" });
  if (build.status !== 0) throw new Error(`next build failed (${build.status})`);

  let server: ChildProcessWithoutNullStreams | null = null;
  let logs = "";
  try {
    console.log(`• Starting next start on ${baseUrl} (vault: ${VAULT})…`);
    server = spawn("npx", ["next", "start", "-H", HOST, "-p", String(port)], { cwd: process.cwd(), env: { ...env, HOST, PORT: String(port) } });
    server.stdout.on("data", (c: Buffer) => { logs += c.toString(); });
    server.stderr.on("data", (c: Buffer) => { logs += c.toString(); });
    await waitForServer(baseUrl, () => logs, server);

    console.log("• Building graph index + layout (POST /rebuild)…");
    const rebuild = await fetch(`${baseUrl}/api/system/graph/rebuild`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const summary = await rebuild.json();
    console.log("  rebuild:", JSON.stringify(summary));

    const browser = await chromium.launch();
    try {
      // Desktop
      const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" });
      const dp = await desktop.newPage();
      await dp.goto(`${baseUrl}/system/graph`, { waitUntil: "networkidle" });
      await dp.getByTestId("graph-view").waitFor({ timeout: 30_000 });
      await dp.getByTestId("graph-canvas").waitFor({ timeout: 30_000 });
      await dp.waitForTimeout(3500);
      await dp.screenshot({ path: OUT_DESKTOP });
      console.log(`  ✓ desktop -> ${OUT_DESKTOP}`);
      await desktop.close();

      // Mobile (iPhone-ish)
      const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "light", isMobile: true, hasTouch: true });
      const mp = await mobile.newPage();
      await mp.goto(`${baseUrl}/system/graph`, { waitUntil: "networkidle" });
      await mp.getByTestId("graph-view").waitFor({ timeout: 30_000 });
      await mp.waitForTimeout(3500);
      await mp.screenshot({ path: OUT_MOBILE });
      console.log(`  ✓ mobile -> ${OUT_MOBILE}`);
      await mobile.close();
    } finally {
      await browser.close();
    }
  } finally {
    if (server && server.exitCode === null) {
      server.kill("SIGTERM");
      await new Promise((r) => setTimeout(r, 1500));
      if (server.exitCode === null) server.kill("SIGKILL");
    }
    rmSync(dataDir, { recursive: true, force: true });
  }
}

async function waitForServer(baseUrl: string, logs: () => string, server: ChildProcessWithoutNullStreams) {
  for (let i = 0; i < 240; i++) {
    if (server.exitCode !== null) throw new Error(`server exited early\n${logs()}`);
    try {
      const r = await fetch(`${baseUrl}/api/system/graph/meta`, { cache: "no-store" });
      if (r.ok) return;
    } catch { /* keep waiting */ }
    await new Promise((res) => setTimeout(res, 500));
  }
  throw new Error(`timed out waiting for server\n${logs()}`);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, HOST, () => {
      const a = s.address();
      if (!a || typeof a === "string") { reject(new Error("no port")); return; }
      s.close(() => resolve(a.port));
    });
    s.on("error", reject);
  });
}

main().catch((e) => { console.error(e); process.exit(1); });
