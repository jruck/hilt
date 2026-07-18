import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser } from "playwright";
import type { LedgerEntry } from "../src/lib/loops/meeting-ledger";
import {
  emitMeetingLedgerChanged,
  MeetingLedgerStore,
  meetingLedgerDbPath,
  writeMeetingLedgerStorageMarker,
} from "../src/lib/loops/meeting-ledger-store";

const REPO = process.cwd();
const HOST = "127.0.0.1";
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-ledger-playwright-"));
const sentinel = path.join(root, ".hilt-meeting-ledger-playwright");
const home = path.join(root, "home");
const vault = path.join(root, "vault");
const data = path.join(root, "data");
const workspace = path.join(root, "workspace");
const shots = path.join(REPO, ".gate-shots", "meeting-ledger");
const realVault = "/Users/jruck/work/bridge";

interface RunningProcess { child: ChildProcess; logs(): string }

function hashTree(base: string): string {
  if (!fs.existsSync(base)) return "missing";
  const hash = crypto.createHash("sha256");
  const walk = (dir: string) => {
    for (const item of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (item.isFile()) { hash.update(path.relative(base, full)); hash.update(fs.readFileSync(full)); }
    }
  };
  walk(base);
  return hash.digest("hex");
}

function assertSafe(): void {
  assert.ok(path.basename(root).startsWith("hilt-meeting-ledger-playwright-"));
  assert.ok(vault.startsWith(`${root}${path.sep}`));
  assert.ok(fs.existsSync(sentinel));
}

function entry(id: string, overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id,
    action: "A deliberately long meeting action that remains readable while preserving dense controls and enough context for a real decision",
    owner: "justin",
    context: "The launch review surfaced a dependency between the scorecard, customer evidence, and the final go/no-go decision. This record keeps that surrounding discussion available without promoting it into a proposal twice.",
    citations: [{ source: "meetings/2026-07-12/Launch review.md", date: "2026-07-12", anchor: "I will send the scorecard once the customer evidence is attached." }],
    confidence: 0.96,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-12T23:00:00.000Z",
    opened_from: "meetings/2026-07-12/Launch review.md",
    first_escalated_at: "2026-07-12T23:01:00.000Z",
    task_id: "t-20260712-90001",
    status_history: [{ at: "2026-07-12T23:00:00.000Z", from: null, to: "open" }],
    sightings: [{ at: "2026-07-12T23:05:00.000Z", meeting: "meetings/2026-07-12/Launch follow-up.md", quote: "The scorecard handoff is still mine." }],
    ...overrides,
  };
}

function seed(): void {
  fs.mkdirSync(path.join(vault, "lists", "now"), { recursive: true });
  fs.mkdirSync(path.join(vault, "tasks", ".proposals"), { recursive: true });
  fs.mkdirSync(path.join(vault, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-12.md"), "---\ntype: weekly-list\nweek: 2026-07-12\n---\n\n# Week of 2026-07-12\n\n## Tasks\n\n- [ ] Review the launch scorecard\n\n## Notes\n\nFixture workspace.\n", "utf-8");
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), "loops:\n  - id: meeting-actions\n    domain: meetings\n    cadence: daily\n    enabled: true\n    phase: shadow\n    proposal_sink: vault\n", "utf-8");
  process.env.DATA_DIR = data;
  const store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  store.putEntry(entry("ma-2026-07-12-00001"), { type: "fixture-opened", at: "2026-07-12T23:05:00.000Z" });
  store.upsertMeetingSummary({ meeting: "meetings/2026-07-12/Launch review.md", date: "2026-07-12", summary: "The launch review made the scorecard handoff the immediate decision dependency.", updated_at: "2026-07-12T23:05:00.000Z" });
  const insert = store.db.prepare(`INSERT INTO ledger_entries(
    id, action, normalized_action, owner, due, context, confidence, source, status, opened_at, opened_from,
    first_escalated_at, task_id, verdict_action, verdict_at, verdict_note, last_seen_at, updated_at
  ) VALUES (@id,@action,@normalized_action,@owner,NULL,@context,0.88,'extractor',@status,@opened_at,@opened_from,@first_escalated_at,@task_id,@verdict_action,@verdict_at,NULL,@last_seen_at,@updated_at)`);
  const insertFts = store.db.prepare("INSERT INTO ledger_entries_fts(id,action,context,owner,opened_from) VALUES (?,?,?,?,?)");
  store.db.transaction(() => {
    for (let index = 2; index <= 40_000; index += 1) {
      const kind = index % 5;
      const status = kind === 3 ? "dropped" : kind === 4 ? "resolved" : "open";
      const verdict = kind === 1 ? "approve" : kind === 3 ? "dismiss" : null;
      const taskId = kind <= 1 || kind === 3 ? `t-20200101-${String(index).padStart(5, "0")}` : null;
      const action = `${index % 317 === 0 ? "Reconcile location billing migration" : "Follow up on customer delivery"} ${index}`;
      const id = `ma-2020-01-01-${String(index).padStart(5, "0")}`;
      const row = {
        id, action, normalized_action: action.toLowerCase(), owner: kind === 2 ? "unclear" : kind === 0 ? "justin" : `other:person-${index % 17}`,
        context: `Project ${index % 91} has a concrete handoff and decision context.`, status,
        opened_at: `2020-01-01T${String(index % 24).padStart(2, "0")}:00:00.000Z`, opened_from: `meetings/2020-01-01/Fixture ${index % 700}.md`,
        first_escalated_at: kind === 0 ? "2020-01-01T12:00:00.000Z" : null, task_id: taskId,
        verdict_action: verdict, verdict_at: verdict ? "2020-01-02T12:00:00.000Z" : null,
        last_seen_at: `2020-01-02T${String(index % 24).padStart(2, "0")}:00:00.000Z`, updated_at: "2026-07-12T12:00:00.000Z",
      };
      insert.run(row);
      insertFts.run(id, action, row.context, row.owner, row.opened_from);
    }
  })();
  assert.equal(store.counts().total, 40_000);
  store.close();
  writeMeetingLedgerStorageMarker(vault, { version: 1, mode: "sqlite", migrated_at: "2026-07-12T12:00:00.000Z", legacy_home: null });
}

function prepareWorkspace(): void {
  const excluded = new Set([".git", ".next", ".next-prod", ".gate-shots", "data", "dist", "node_modules", "worktrees"]);
  fs.cpSync(REPO, workspace, { recursive: true, filter: (source) => {
    const relative = path.relative(REPO, source);
    if (!relative) return true;
    const top = relative.split(path.sep)[0];
    return !excluded.has(top) && !top.startsWith(".next-library-") && !top.startsWith(".env");
  } });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(workspace, "node_modules"), "dir");
}

function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv): RunningProcess {
  const child = spawn(command, args, { cwd: workspace, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk}`.slice(-40_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = `${output}${chunk}`.slice(-40_000); });
  return { child, logs: () => output };
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => { const server = net.createServer(); server.on("error", reject); server.listen(0, HOST, () => { const address = server.address(); if (!address || typeof address === "string") return reject(new Error("port allocation failed")); server.close(() => resolve(address.port)); }); });
}

async function waitForHttp(url: string, process: RunningProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    if (process.child.exitCode !== null) throw new Error(`server exited\n${process.logs()}`);
    try { if ((await fetch(url)).ok) return; } catch { /* compiling */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`server timeout\n${process.logs()}`);
}

async function stop(process: RunningProcess | null): Promise<void> {
  if (!process || process.child.exitCode !== null) return;
  process.child.kill("SIGINT");
  await Promise.race([new Promise<void>((resolve) => process.child.once("exit", () => resolve())), new Promise<void>((resolve) => setTimeout(() => { process.child.kill("SIGKILL"); resolve(); }, 5_000))]);
}

async function main(): Promise<void> {
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(sentinel, "isolated\n");
  assertSafe();
  const realBefore = hashTree(path.join(realVault, "tasks"));
  seed();
  prepareWorkspace();
  const [port, wsPort] = await Promise.all([freePort(), freePort()]);
  const base = `http://${HOST}:${port}`;
  const env = {
    ...process.env, HOME: home, DATA_DIR: data, BRIDGE_VAULT_PATH: vault, HILT_WORKING_FOLDER: vault,
    HOST, PORT: String(port), WS_PORT: String(wsPort), HILT_DIST_DIR: ".next-meeting-ledger-e2e", HILT_NEXT_DEV_BUNDLER: "webpack",
    HILT_GRANOLA_SYNC_DAEMON: "0", HILT_CALENDAR_SYNC_DAEMON: "0", HILT_LIBRARY_INTAKE_DAEMON: "0",
    NEXT_TELEMETRY_DISABLED: "1",
  } as NodeJS.ProcessEnv;
  let ws: RunningProcess | null = null;
  let app: RunningProcess | null = null;
  let browser: Browser | null = null;
  try {
    ws = spawnLogged(process.execPath, ["--import", "tsx", "server/ws-server.ts"], env);
    app = spawnLogged(process.execPath, ["--import", "tsx", "server/app-server.ts"], env);
    await waitForHttp(`${base}/api/loops/meeting-ledger?limit=1`, app);
    await waitForHttp(`${base}/api/loops/meeting-ledger/health`, app);
    browser = await chromium.launch({ headless: true });

    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
    const page = await desktop.newPage();
    await page.goto(`${base}/bridge`, { waitUntil: "domcontentloaded" });
    const launcher = page.getByTestId("meeting-ledger-launcher");
    await launcher.waitFor({ timeout: 30_000 });
    await launcher.getByText(/40,000 entries/).waitFor({ timeout: 30_000 }).catch(async (error) => {
      const health = await page.evaluate(async () => {
        const response = await fetch("/api/loops/meeting-ledger/health");
        return { status: response.status, body: await response.text() };
      });
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nLauncher: ${await launcher.innerText()}\nBrowser health: ${JSON.stringify(health)}`);
    });
    assert.match(await launcher.innerText(), /40,000 entries/);
    await launcher.click();
    const panel = page.getByTestId("meeting-ledger-panel");
    await panel.waitFor();
    await panel.getByText(/40,000 records/).waitFor({ timeout: 30_000 });
    assert.match(await panel.innerText(), /Latent 8,000/);
    await page.waitForTimeout(100);
    await panel.screenshot({ path: path.join(shots, "desktop-list-light.png") });

    const firstRow = panel.locator("[data-ledger-id]").first();
    await firstRow.click();
    const detail = page.getByTestId("meeting-ledger-detail");
    await detail.waitFor();
    assert.match(await detail.innerText(), /The launch review surfaced a dependency/);
    assert.match(await detail.innerText(), /Source evidence/i);
    await page.waitForTimeout(100);
    await panel.screenshot({ path: path.join(shots, "desktop-detail-light.png") });
    await detail.getByTitle("Back to ledger").click();

    const list = page.getByTestId("meeting-ledger-list");
    const nextPage = page.waitForResponse((response) => response.url().includes("/api/loops/meeting-ledger?") && response.url().includes("cursor="));
    await list.evaluate((node) => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event("scroll")); });
    await nextPage;
    await panel.getByPlaceholder("Search actions and context").fill("no-result-sentinel");
    await panel.getByText("No ledger entries match these filters.").waitFor();
    await panel.getByText("Meeting ledger", { exact: true }).waitFor();
    await panel.getByTitle("Close meeting ledger").waitFor();
    await page.waitForTimeout(100);
    await panel.screenshot({ path: path.join(shots, "desktop-empty-light.png") });
    await panel.getByPlaceholder("Search actions and context").fill("");

    process.env.DATA_DIR = data;
    const liveStore = new MeetingLedgerStore(meetingLedgerDbPath(vault));
    liveStore.putEntry(entry("ma-2026-07-12-90002", { action: "Live ledger update arrives without navigation", opened_at: "2026-07-12T23:59:00.000Z", task_id: "t-20260712-90002", sightings: [] }), { type: "live-fixture", at: "2026-07-12T23:59:00.000Z" });
    liveStore.close();
    emitMeetingLedgerChanged(vault, { fixture: true });
    await panel.getByText(/40,001 records/).waitFor({ timeout: 10_000 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(200);
    await panel.screenshot({ path: path.join(shots, "desktop-list-dark.png") });
    await desktop.close();

    const mobile = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: "light" });
    const mobilePage = await mobile.newPage();
    await mobilePage.goto(`${base}/bridge`, { waitUntil: "domcontentloaded" });
    await mobilePage.getByTestId("meeting-ledger-launcher").click();
    const mobilePanel = mobilePage.getByTestId("meeting-ledger-panel");
    await mobilePanel.waitFor();
    await mobilePanel.getByText(/40,001 records/).waitFor({ timeout: 30_000 });
    await mobilePanel.locator("[data-ledger-id]").first().waitFor({ timeout: 30_000 });
    const panelBox = await mobilePanel.boundingBox();
    assert.ok(panelBox && panelBox.width <= 393 && panelBox.x >= 0 && panelBox.height <= 852);
    for (const label of ["All", "Pending", "Accepted", "Latent", "Observed only", "Dismissed", "Resolved"]) {
      const control = mobilePanel.getByRole("button", { name: new RegExp(`^${label}(?: |$)`) });
      const box = await control.boundingBox();
      assert.ok(box && box.x >= panelBox.x && box.x + box.width <= panelBox.x + panelBox.width, `${label} filter overflows the mobile panel`);
    }
    const mobileList = mobilePage.getByTestId("meeting-ledger-list");
    assert.ok(parseFloat(await mobileList.evaluate((node) => getComputedStyle(node).paddingBottom)) >= 90, "mobile ledger list must clear the fixed navigation");
    await mobilePage.screenshot({ path: path.join(shots, "mobile-list-light.png"), fullPage: false });
    await mobilePanel.locator("[data-ledger-id]").first().click();
    await mobilePage.getByTestId("meeting-ledger-detail").waitFor();
    await mobilePage.screenshot({ path: path.join(shots, "mobile-detail-light.png"), fullPage: false });
    await mobilePage.emulateMedia({ colorScheme: "dark" });
    await mobilePage.waitForTimeout(200);
    await mobilePage.screenshot({ path: path.join(shots, "mobile-detail-dark.png"), fullPage: false });
    await mobile.close();

    assert.equal(hashTree(path.join(realVault, "tasks")), realBefore, "isolated Playwright changed the real task tree");
    console.log(JSON.stringify({ ok: true, rows: 40_001, screenshots: shots, live_update: true, real_vault_unchanged: true }, null, 2));
  } finally {
    await browser?.close();
    await stop(app);
    await stop(ws);
    assertSafe();
    if (process.env.KEEP_E2E !== "1") fs.rmSync(root, { recursive: true, force: true });
    else console.error(`[meeting-ledger-playwright] retained ${root}`);
    delete process.env.DATA_DIR;
  }
}

main().catch((error) => { console.error("[meeting-ledger-playwright] FAIL", error); process.exitCode = 1; });
