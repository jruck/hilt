/**
 * Regenerates the README view screenshots in docs/screenshots/.
 *
 * Boots a production build of the app against the demo vault (docs/demo) with calendar + weather
 * fixtures, then drives a headless Chromium at 1440x900 @2x (= 2880x1800 PNGs, matching the
 * existing screenshots) through each view and captures it. Light theme is forced via colorScheme.
 *
 * Usage:
 *   npm run screenshots            # seeds demo data, builds, captures all views
 *   SKIP_BUILD=1 npm run screenshots   # reuse an existing .next build (faster re-runs)
 */
import { execFileSync } from "node:child_process";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import net from "node:net";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";

const HOST = "127.0.0.1";
const REPO = process.cwd();
const SCREENSHOT_DIR = path.join(REPO, "docs", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

const DEMO_ENV = {
  DATA_DIR: path.join(REPO, "docs", "demo", ".hilt-data"),
  HILT_WORKING_FOLDER: path.join(REPO, "docs", "demo"),
  BRIDGE_VAULT_PATH: path.join(REPO, "docs", "demo"),
  HILT_SYSTEM_NETWORK_ENABLED: "false",
  HILT_SYSTEM_MACHINE_HOSTNAME: "demo-workstation",
  HILT_SYSTEM_MACHINE_DNS: "demo-workstation.tailnet.example",
  HILT_SYSTEM_MACHINE_IP4: "100.64.0.10",
  HILT_CALENDAR_FIXTURE_MODE: "1",
  HILT_WEATHER_FIXTURE_MODE: "1",
  HILT_CALENDAR_SYNC_PAST_DAYS: "30",
  HILT_CALENDAR_SYNC_FUTURE_DAYS: "90",
  NEXT_TELEMETRY_DISABLED: "1",
};

const DOCS_TARGET = path.join(REPO, "docs", "demo", "projects", "garden-planner", "index.md");

async function main() {
  const env = { ...process.env, ...DEMO_ENV };

  console.log("• Seeding demo data (map + calendar link)…");
  run("npm", ["run", "demo:seed-map"], env);
  run("npm", ["run", "demo:seed-calendar-link"], env);

  if (!process.env.SKIP_BUILD) {
    console.log("• Building (next build)…");
    run("npx", ["next", "build"], env);
  }

  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  let server: ChildProcessWithoutNullStreams | null = null;
  let logs = "";
  let browser: Browser | null = null;

  try {
    console.log(`• Starting server on ${baseUrl}…`);
    server = spawn("npx", ["next", "start", "-H", HOST, "-p", String(port)], {
      cwd: REPO,
      env: { ...env, HOST, PORT: String(port) },
    });
    server.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    server.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    await waitForServer(baseUrl, () => logs, server);

    browser = await chromium.launch();
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 2,
      colorScheme: "light",
    });
    const page = await context.newPage();

    await capture(page, baseUrl, "briefing", "/briefings", async () => {
      await page.getByText("Highlights").first().waitFor({ timeout: 20_000 });
    });
    await capture(page, baseUrl, "bridge", "/bridge", async () => {
      await page.getByText("This Week", { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => {});
    });
    await capture(page, baseUrl, "people", "/people/art-vandelay", async () => {
      await page.getByText("Client Review").first().waitFor({ timeout: 20_000 });
    });
    await capture(page, baseUrl, "library-browse", "/library", async () => {
      await page.waitForTimeout(500);
    });
    await capture(page, baseUrl, "docs", `/docs${DOCS_TARGET}`, async () => {
      await page.getByText("Garden Planner", { exact: false }).first().waitFor({ timeout: 20_000 }).catch(() => {});
    });
    await capture(page, baseUrl, "system", "/system", async () => {
      await page.waitForTimeout(800);
    });
    await capture(page, baseUrl, "calendar", "/calendar", async () => {
      await page.getByTestId("calendar-view").waitFor({ timeout: 20_000 });
      await page.getByTestId("calendar-mode-week").filter({ visible: true }).click().catch(() => {});
      await page.getByText("Client review").first().waitFor({ timeout: 20_000 });
      await page.getByText("Client review").first().click();
      await page.getByTestId("calendar-event-popover").waitFor({ timeout: 10_000 });
    });

    await context.close();
    console.log(`\n✓ Screenshots written to ${path.relative(REPO, SCREENSHOT_DIR)}/`);
  } finally {
    if (browser) await browser.close();
    if (server) await stopServer(server);
  }
}

async function capture(page: Page, baseUrl: string, name: string, route: string, ready: () => Promise<void>) {
  const outPath = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.goto(`${baseUrl}${route}`, { waitUntil: "networkidle" });
  try {
    await ready();
  } catch (error) {
    console.warn(`  ! ${name}: ready check failed, capturing anyway (${(error as Error).message})`);
  }
  await page.waitForTimeout(1200); // settle fonts/animations
  await page.screenshot({ path: outPath });
  console.log(`  ✓ ${name} → ${path.relative(REPO, outPath)}`);
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv) {
  execFileSync(command, args, { cwd: REPO, env, stdio: "inherit" });
}

async function waitForServer(baseUrl: string, logs: () => string, server: ChildProcessWithoutNullStreams) {
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error(`Server exited early.\n${logs()}`);
    try {
      const response = await fetch(`${baseUrl}/api/calendar/setup/status`, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for server.\n${logs()}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    sleep(5000).then(() => { if (server.exitCode === null) server.kill("SIGKILL"); }),
  ]);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") { reject(new Error("Could not allocate a port.")); return; }
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
