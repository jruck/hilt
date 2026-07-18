#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import {
  buildBriefingDecisionQueue,
  composeBriefingDecisions,
  DECISION_CONTRACT_MARKER,
} from "../src/lib/briefing/decisions";
import { serializeLoopArtifact } from "../src/lib/loops/artifacts";
import { writeLedger, type LedgerEntry } from "../src/lib/loops/meeting-ledger";
import { serializeTaskFile } from "../src/lib/tasks/task-file";
import type { TaskFile } from "../src/lib/tasks/types";

const HOST = "127.0.0.1";
const REPO = process.cwd();
const SENTINEL = ".hilt-briefing-decisions-e2e";

interface RunningProcess {
  child: ChildProcess;
  logs: () => string;
}

interface Fixture {
  weekendId: string;
  dailyId: string;
  historicalId: string;
  meetings: { alpha: string; beta: string; omitted: string; arriving: string };
  ids: { alphaOne: string; alphaTwo: string; beta: string; omitted: string; preDismissed: string; historical: string };
}

async function main(): Promise<void> {
  const realVault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || null;
  const realBefore = realVault ? snapshotTree(realVault) : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-briefing-decisions-e2e-"));
  const home = path.join(root, "home");
  const vault = path.join(root, "vault");
  const data = path.join(root, "data");
  const shots = path.join(root, "screenshots");
  const workspace = path.join(root, "workspace");
  const distName = ".next-briefing-decisions-e2e";
  let app: RunningProcess | null = null;
  let ws: RunningProcess | null = null;
  let browser: Browser | null = null;
  let compactDesktopContext: BrowserContext | null = null;
  let mobileContext: BrowserContext | null = null;

  for (const dir of [home, vault, data, shots]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL), "isolated Decisions briefing E2E\n", "utf-8");
  assertSafe(root, vault);
  prepareWorkspace(workspace);
  const fixture = seedVault(vault);

  try {
    const [appPort, wsPort] = await Promise.all([freePort(), freePort()]);
    const baseUrl = `http://${HOST}:${appPort}`;
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      HOME: home,
      DATA_DIR: data,
      BRIDGE_VAULT_PATH: vault,
      HILT_WORKING_FOLDER: vault,
      HOST,
      PORT: String(appPort),
      WS_PORT: String(wsPort),
      HILT_DIST_DIR: distName,
      HILT_NEXT_DEV_BUNDLER: "webpack",
      HILT_LIBRARY_INTAKE_DAEMON: "0",
      HILT_GRANOLA_SYNC_DAEMON: "0",
      HILT_CALENDAR_SYNC_DAEMON: "0",
      LIBRARY_CONNECTIONS_DISABLED: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    };
    ws = spawnLogged(process.execPath, ["--import", "tsx", "server/ws-server.ts"], env, workspace);
    await waitFor(() => fs.existsSync(path.join(home, ".hilt-ws-port")), 20_000, "WebSocket server", ws);
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      app = spawnLogged(process.execPath, ["--import", "tsx", "server/app-server.ts"], env, workspace);
      try {
        await waitForHttp(`${baseUrl}/api/bridge/briefings`, attempt === 1 ? 45_000 : 120_000, app);
        break;
      } catch (error) {
        await stopProcess(app, "SIGTERM");
        if (attempt === 2 || !app.logs().includes("required-server-files.json")) throw error;
        fs.rmSync(path.join(workspace, distName), { recursive: true, force: true });
        app = null;
      }
    }
    assert.ok(app, "app server failed to start");

    browser = await chromium.launch({ headless: true });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1100 }, colorScheme: "light" });
    const page = await desktop.newPage();
    const navigationCount = await openBriefing(page, baseUrl);
    await selectBriefing(page, fixture.weekendId);
    assert.match(await page.locator("[data-briefing-selector]").innerText(), /2026/, "desktop briefing selector retains year context");

    let decisions = page.locator('[data-briefing-decisions="true"]');
    await decisions.waitFor({ timeout: 30_000 });
    await expectPending(decisions, 4);
    assert.equal(await decisions.locator("[data-briefing-meeting]").count(), 3);
    assert.deepEqual(
      await decisions.locator("[data-briefing-meeting]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-briefing-meeting"))),
      [fixture.meetings.beta, fixture.meetings.alpha, fixture.meetings.omitted],
      "the model's featured order stays intact and omitted groups append afterward",
    );
    const collapsed = await decisions.innerText();
    assert.match(collapsed, /Beta settled the rollout shape/);
    assert.match(collapsed, /The omitted meeting introduced a late approval boundary/);
    assert.doesNotMatch(collapsed, /Alpha task one|Alpha task two|Omitted task title/);
    assert.doesNotMatch(collapsed, /decisions? across/i);
    assert.doesNotMatch(await page.locator('[data-briefing-work="true"]').innerText(), /pending verdicts|decisions awaiting you|task-/i);
    await assertDecisionLayout(decisions, "wide desktop");
    await page.screenshot({ path: path.join(shots, "desktop-weekend-collapsed-light.png"), fullPage: true });

    const alpha = meetingLocator(decisions, fixture.meetings.alpha);
    await toggleMeeting(alpha);
    await expectCount(alpha.locator("[data-task-card]"), 2, 10_000);
    await alpha.getByText("Dismissed · 1", { exact: true }).click();
    await alpha.getByText("A previously dismissed alpha follow-up", { exact: true }).waitFor();
    await alpha.getByRole("button", { name: "Restore proposal: A previously dismissed alpha follow-up" }).waitFor();
    await alpha.screenshot({ path: path.join(shots, "desktop-meeting-expanded-light.png") });

    await decideTask(page, fixture.ids.alphaOne, "Approve");
    await expectPending(decisions, 3);
    await alpha.getByText("Resolved · 1", { exact: true }).waitFor({ timeout: 10_000 });

    const beta = meetingLocator(decisions, fixture.meetings.beta);
    await toggleMeeting(beta);
    await decideTask(page, fixture.ids.beta, "Dismiss");
    await expectPending(decisions, 2);
    await beta.getByText("Dismissed · 1", { exact: true }).click();
    const restoreBeta = beta.getByRole("button", { name: "Restore proposal: Beta task title" });
    await restoreBeta.waitFor({ timeout: 10_000 });
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/loops/dismissed/") && response.url().endsWith("/restore") && response.request().method() === "POST"),
      restoreBeta.click(),
    ]);
    await expectPending(decisions, 3);
    await expectCount(beta.locator(`[data-task-card="${fixture.ids.beta}"]`), 1, 10_000);
    await expectCount(beta.locator("[data-dismissed-proposal]"), 0, 10_000);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    await decisions.screenshot({ path: path.join(shots, "desktop-decisions-resolved-dark.png") });

    const arrivingId = "t-20260712-005";
    writeProposal(vault, arrivingId, "This arriving task title must stay inside its TaskCard", fixture.meetings.arriving, "2026-07-12T11:30:00.000Z");
    await expectPending(decisions, 4, 15_000);
    assert.equal(await decisions.locator("[data-briefing-meeting]").count(), 4);
    const weekendFile = path.join(vault, "briefings", "weekend", "2026-07-11.md");
    await waitFor(() => fs.readFileSync(weekendFile, "utf-8").includes(arrivingId), 5_000, "durable weekend proposal append");
    const arriving = meetingLocator(decisions, fixture.meetings.arriving);
    await waitForAsync(async () => (await arriving.innerText()).includes("A newly arrived meeting changed Monday's launch sequence"), 10_000, "live stored meeting context");
    assert.doesNotMatch(await arriving.innerText(), /This arriving task title/);
    assert.equal(await navigationEntries(page), navigationCount, "live proposal arrival does not reload the briefing");
    await decisions.screenshot({ path: path.join(shots, "desktop-live-arrival-dark.png") });

    await selectBriefing(page, fixture.dailyId);
    decisions = page.locator('[data-briefing-decisions="true"]');
    await decisions.waitFor();
    await expectPending(decisions, 4);
    assert.equal(await decisions.locator("[data-briefing-meeting]").count(), 4, "active daily receives the same new canonical group");
    assert.match(await page.locator('[data-briefing-work="true"]').innerText(), /activity converged into a release boundary/);
    await page.screenshot({ path: path.join(shots, "desktop-daily-dark.png"), fullPage: true });

    await selectBriefing(page, fixture.historicalId);
    const historical = page.locator('[data-briefing-decisions="true"]');
    await historical.waitFor();
    await expectPending(historical, 0);
    assert.equal(await historical.locator("[data-briefing-meeting]").count(), 1);
    assert.doesNotMatch(await historical.innerText(), /newly arrived|arriving task/i);
    await toggleMeeting(historical.locator("[data-briefing-meeting]").first());
    await historical.getByText("Resolved · 1", { exact: true }).waitFor();
    await historical.screenshot({ path: path.join(shots, "desktop-historical-frozen-dark.png") });

    compactDesktopContext = await browser.newContext({ viewport: { width: 987, height: 1100 }, colorScheme: "dark" });
    const compactDesktop = await compactDesktopContext.newPage();
    await openBriefing(compactDesktop, baseUrl);
    await selectBriefing(compactDesktop, fixture.weekendId);
    const compactDecisions = compactDesktop.locator('[data-briefing-decisions="true"]');
    await compactDecisions.waitFor({ timeout: 30_000 });
    await assertDecisionLayout(compactDecisions, "987px desktop");
    assert.equal(await compactDesktop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "compact desktop has no horizontal overflow");
    await compactDecisions.screenshot({ path: path.join(shots, "compact-desktop-decisions-dark.png") });

    mobileContext = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: "light", isMobile: true, hasTouch: true });
    const mobile = await mobileContext.newPage();
    await openBriefing(mobile, baseUrl);
    await selectBriefing(mobile, fixture.weekendId);
    const mobileSelector = mobile.locator("[data-briefing-selector]");
    assert.doesNotMatch(await mobileSelector.innerText(), /2026/, "mobile briefing selector omits the year");
    assert.equal(
      await mobileSelector.evaluate((element) => getComputedStyle(element).whiteSpace),
      "nowrap",
      "mobile briefing selector stays on one line",
    );
    const mobileDecisions = mobile.locator('[data-briefing-decisions="true"]');
    await mobileDecisions.waitFor({ timeout: 30_000 });
    await assertDecisionLayout(mobileDecisions, "393px mobile");
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile briefing has no horizontal overflow");
    await mobileDecisions.screenshot({ path: path.join(shots, "mobile-decisions-light.png") });
    const mobileAlpha = meetingLocator(mobileDecisions, fixture.meetings.alpha);
    await toggleMeeting(mobileAlpha);
    await mobileAlpha.getByText("Dismissed · 1", { exact: true }).click();
    await mobileAlpha.getByRole("button", { name: "Restore proposal: A previously dismissed alpha follow-up" }).waitFor();
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile dismissal recovery stays contained");
    await mobileAlpha.screenshot({ path: path.join(shots, "mobile-dismissed-expanded-light.png") });
    await toggleMeeting(meetingLocator(mobileDecisions, fixture.meetings.omitted));
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "expanded mobile decisions stay contained");
    await mobileDecisions.screenshot({ path: path.join(shots, "mobile-decisions-expanded-light.png") });
    await mobile.emulateMedia({ colorScheme: "dark" });
    await mobile.waitForTimeout(150);
    await mobileDecisions.screenshot({ path: path.join(shots, "mobile-decisions-expanded-dark.png") });

    await desktop.close();
    await compactDesktopContext.close();
    compactDesktopContext = null;
    await mobileContext.close();
    mobileContext = null;
    console.log(`[briefing-decisions-e2e] PASS. Screenshots: ${shots}`);
  } catch (error) {
    console.error(`[briefing-decisions-e2e] WebSocket log tail:\n${ws?.logs() || "(stopped)"}`);
    console.error(`[briefing-decisions-e2e] App log tail:\n${app?.logs() || "(stopped)"}`);
    throw error;
  } finally {
    if (compactDesktopContext) await compactDesktopContext.close().catch(() => {});
    if (mobileContext) await mobileContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (ws) await stopProcess(ws, "SIGINT");
    if (app) await stopProcess(app, "SIGTERM");
    if (realVault && realBefore) assert.deepEqual(snapshotTree(realVault), realBefore, `Real Bridge tree changed: ${realVault}`);
    if (process.env.KEEP_E2E === "1") console.log(`[briefing-decisions-e2e] KEEP_E2E=1 retained ${root}`);
    else {
      assertSafe(root, vault);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function seedVault(vault: string): Fixture {
  for (const dir of ["briefings/weekend", "tasks/.proposals", "meta/loops/meetings/state", "lists/now"]) {
    fs.mkdirSync(path.join(vault, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(vault, "meta", "loops", "registry.yml"), `loops:
  - id: meeting-actions
    domain: meetings
    cadence: daily
    enabled: true
    phase: live
    proposal_sink: vault
`, "utf-8");
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-06.md"), "# Week\n", "utf-8");

  const meetings = {
    alpha: "meetings/2026-07-10/Alpha planning.md",
    beta: "meetings/2026-07-11/Resolving billing issues from the Listen360 platform migration.md",
    omitted: "meetings/2026-07-11/Omitted scope review.md",
    arriving: "meetings/2026-07-12/A newly arriving launch review.md",
  };
  const ids = {
    alphaOne: "t-20260712-001",
    alphaTwo: "t-20260712-002",
    beta: "t-20260712-003",
    omitted: "t-20260712-004",
    preDismissed: "t-20260710-090",
    historical: "t-20260710-099",
  };
  const proposals = [
    writeProposal(vault, ids.alphaOne, "Alpha task one", meetings.alpha, "2026-07-12T08:00:00.000Z"),
    writeProposal(vault, ids.alphaTwo, "Alpha task two", meetings.alpha, "2026-07-12T08:05:00.000Z"),
    writeProposal(vault, ids.beta, "Beta task title", meetings.beta, "2026-07-12T09:00:00.000Z", "2026-07-12"),
    writeProposal(vault, ids.omitted, "Omitted task title", meetings.omitted, "2026-07-12T10:00:00.000Z"),
  ];
  const summaries = {
    [meetings.alpha]: { date: "2026-07-10", summary: "Alpha established the implementation path but left ownership and sequence unresolved." },
    [meetings.beta]: { date: "2026-07-11", summary: "Beta settled the rollout shape; the remaining approval now controls launch timing." },
    [meetings.omitted]: { date: "2026-07-11", summary: "The omitted meeting introduced a late approval boundary that the draft did not feature." },
    [meetings.arriving]: { date: "2026-07-12", summary: "A newly arrived meeting changed Monday's launch sequence and left one approval open." },
  };
  const ledgerEntries: Record<string, LedgerEntry> = Object.fromEntries(proposals.map((task) => {
    const entry: LedgerEntry = {
      id: task.origin!.item_id!,
      action: task.title,
      owner: "justin",
      citations: [{ source: task.origin!.meeting!, date: task.created_at.slice(0, 10), anchor: `Commitment for ${task.title}` }],
      confidence: 0.95,
      source: "extractor",
      status: "open",
      opened_at: task.created_at,
      opened_from: task.origin!.meeting!,
      task_id: task.id,
      status_history: [{ at: task.created_at, from: null, to: "open" }],
      sightings: [],
    };
    return [entry.id, entry];
  }));
  const dismissedAt = "2026-07-11T02:00:00.000Z";
  const preDismissedEntry: LedgerEntry = {
    id: "ma-pre-dismissed-alpha",
    action: "A previously dismissed alpha follow-up",
    owner: "justin",
    citations: [{ source: meetings.alpha, date: "2026-07-10", anchor: "We can skip that follow-up" }],
    confidence: 0.9,
    source: "extractor",
    status: "dropped",
    opened_at: "2026-07-10T08:30:00.000Z",
    opened_from: meetings.alpha,
    verdict: { verdict: "dismiss", at: dismissedAt, note: "Already covered by the rollout plan" },
    task_id: ids.preDismissed,
    status_history: [
      { at: "2026-07-10T08:30:00.000Z", from: null, to: "open" },
      { at: dismissedAt, from: "open", to: "dropped", evidence: "dismissed by verdict" },
    ],
    sightings: [],
  };
  ledgerEntries[preDismissedEntry.id] = preDismissedEntry;
  writeLedger(path.join(vault, "meta", "loops", "meetings"), { version: 1, entries: ledgerEntries });
  fs.writeFileSync(path.join(vault, "meta", "loops", "meetings", "state", "meeting-summaries.json"), JSON.stringify(summaries, null, 2), "utf-8");
  fs.mkdirSync(path.join(vault, "meta", "loops", "meetings", "reports"), { recursive: true });
  fs.writeFileSync(
    path.join(vault, "meta", "loops", "meetings", "reports", "2026-07-12.md"),
    serializeLoopArtifact({
      loop: "meeting-actions",
      run_at: "2026-07-12T05:00:00.000Z",
      cadence: "daily",
      items: proposals.map((task) => ({
        id: task.origin!.item_id!,
        loop: "meeting-actions",
        kind: "action" as const,
        title: task.title,
        citations: [{ source: task.origin!.meeting!, date: task.created_at.slice(0, 10) }],
        escalated: { reason: "Fixture proposal awaiting a verdict" },
        confidence: 0.95,
        owner: "justin",
        allowed_verdicts: ["approve", "assign_to_agent", "dismiss"],
        task_id: task.id,
      })),
      health: { ok: true, attempted: proposals.length, succeeded: proposals.length, coverage: 1 },
    }, "# Meeting actions fixture\n"),
    "utf-8",
  );

  const queue = buildBriefingDecisionQueue({
    proposals,
    asOf: "2026-07-12",
    meetingSummaries: new Map(Object.entries(summaries).map(([meeting, value]) => [meeting, value.summary])),
  });
  const weekend = composeBriefingDecisions(weekendDraft(meetings, ids), "weekend", queue);
  const daily = composeBriefingDecisions(dailyDraft(meetings, ids), "daily", queue);
  assert.ok(weekend.indexOf("Beta settled the rollout shape") < weekend.indexOf("Alpha established the implementation path"));
  assert.ok(weekend.indexOf("Alpha established the implementation path") < weekend.indexOf("The omitted meeting introduced"));
  assert.doesNotMatch(weekend, /Alpha task one|Omitted task title|decisions? across/i);
  fs.writeFileSync(path.join(vault, "briefings", "weekend", "2026-07-11.md"), weekend, "utf-8");
  fs.writeFileSync(path.join(vault, "briefings", "2026-07-12.md"), daily, "utf-8");

  writeTask(vault, {
    id: ids.historical,
    title: "Historical resolved ownership decision",
    status: "done",
    origin: { loop: "meeting-actions", meeting: "meetings/2026-07-10/Historical resolved meeting.md", item_id: "ma-historical" },
    created_at: "2026-07-10T10:00:00.000Z",
    body: "",
  }, false);
  fs.writeFileSync(path.join(vault, "briefings", "2026-07-10.md"), historicalBriefing(ids.historical), "utf-8");

  return { weekendId: "weekend:2026-07-11", dailyId: "2026-07-12", historicalId: "2026-07-10", meetings, ids };
}

function weekendDraft(meetings: Fixture["meetings"], ids: Fixture["ids"]): string {
  return `---
briefing_kind: weekend
date_range:
  start: 2026-07-11
  end: 2026-07-12
created_at: 2026-07-11T06:00:00-04:00
updated_at: 2026-07-12T06:00:00-04:00
title: Weekend Briefing — Jul 11-12, 2026
---

# Weekend Briefing — Jul 11-12, 2026

## 🧭 Direction of travel
- Delivery work converged around a smaller set of consequential boundaries.

## ✅ Closed loops / open loops
- The implementation direction is clearer; ownership remains open below.

## ⏭ Decisions awaiting you
- Beta settled the rollout shape; the remaining approval now controls launch timing.
  - *${meetings.beta}, 2026-07-11*
  - \`${ids.beta}\`
- Alpha established the implementation path but left ownership and sequence unresolved.
  - *${meetings.alpha}, 2026-07-10*
  - \`${ids.alphaOne}\`
  - \`${ids.alphaTwo}\`

## 💼 Work & product
- Activity across Hilt, EverPro, and adjacent Bridge work converged into a release boundary that needs one Monday sequence rather than more parallel motion.
- The implementation and product evidence now agree on what shipped; the remaining tension is ownership, not technical feasibility.

## 📈 Systems / loops
- Fixture systems are healthy.

---
*Generated by the \`briefing\` skill. To change this, edit the skill.*
`;
}

function dailyDraft(meetings: Fixture["meetings"], ids: Fixture["ids"]): string {
  return `# Morning Briefing — Sunday, July 12, 2026

## 📅 Today
- Protect the morning handoff before the next launch decision.

## ⏭ Decisions awaiting you
- Alpha established the implementation path but left ownership and sequence unresolved.
  - *${meetings.alpha}, 2026-07-10*
  - \`${ids.alphaOne}\`
  - \`${ids.alphaTwo}\`

## 💼 Work & product
- Broad activity converged into a release boundary; implementation is no longer the constraint, but Monday's owner sequence is.

## 📈 System
- Fixture systems are healthy.

---
*Generated by the \`briefing\` skill. To change this, edit the skill.*
`;
}

function historicalBriefing(id: string): string {
  return `# Morning Briefing — Friday, July 10, 2026

## 📅 Today
- Close the historical fixture cleanly.

## ⏭ Decisions awaiting you
- The earlier review resolved its ownership question and remains here as historical context.
  - *meetings/2026-07-10/Historical resolved meeting.md, 2026-07-10*
  - \`${id}\`

## 💼 Work & product
- The earlier implementation pass completed without a new active work signal.

## 📈 System
- Healthy.

---
*Generated by the \`briefing\` skill. To change this, edit the skill.*
${DECISION_CONTRACT_MARKER}
`;
}

function writeProposal(vault: string, id: string, title: string, meeting: string, createdAt: string, due?: string): TaskFile {
  const task: TaskFile = {
    id,
    title,
    status: "proposed",
    origin: { loop: "meeting-actions", meeting, item_id: `ma-${id}` },
    created_at: createdAt,
    ...(due ? { due } : {}),
    body: "",
  };
  writeTask(vault, task, true);
  return task;
}

function writeTask(vault: string, task: TaskFile, proposal: boolean): void {
  const dir = path.join(vault, "tasks", proposal ? ".proposals" : "");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${task.id}.md`), serializeTaskFile(task), "utf-8");
}

async function openBriefing(page: Page, baseUrl: string): Promise<number> {
  await page.goto(`${baseUrl}/briefings`, { waitUntil: "domcontentloaded" });
  await page.locator("[data-briefing-selector]").waitFor({ timeout: 30_000 });
  return navigationEntries(page);
}

async function selectBriefing(page: Page, id: string): Promise<void> {
  await page.locator("[data-briefing-selector]").click();
  const option = page.locator(`[data-briefing-option-id="${id}"]`);
  if (await option.getAttribute("aria-current") !== "date") await option.click();
  else await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
}

function meetingLocator(decisions: ReturnType<Page["locator"]>, meeting: string) {
  return decisions.locator(`[data-briefing-meeting="${meeting.replace(/["\\]/g, "\\$&")}"]`);
}

async function assertDecisionLayout(decisions: ReturnType<Page["locator"]>, label: string): Promise<void> {
  const measurements = await decisions.locator("[data-decision-row=true]").evaluateAll((rows) => rows.map((row) => {
    const meeting = row.querySelector<HTMLElement>("[data-decision-meeting-meta=true]")?.getBoundingClientRect();
    const context = row.querySelector<HTMLElement>("[data-decision-context=true]")?.getBoundingClientRect();
    const status = row.querySelector<HTMLElement>("[data-decision-status=true]")?.getBoundingClientRect();
    const header = row.getBoundingClientRect();
    return {
      headerWidth: header.width,
      headerHeight: header.height,
      meetingRight: meeting?.right ?? null,
      statusLeft: status?.left ?? null,
      contextWidth: context?.width ?? null,
      contextLeft: context?.left ?? null,
      contextRight: context?.right ?? null,
      headerLeft: header.left,
      headerRight: header.right,
    };
  }));

  assert.ok(measurements.length > 0, `${label}: expected decision rows`);
  for (const [index, measurement] of measurements.entries()) {
    assert.ok(measurement.headerHeight < 320, `${label} row ${index}: collapsed row is implausibly tall (${measurement.headerHeight}px)`);
    if (measurement.meetingRight !== null && measurement.statusLeft !== null) {
      assert.ok(measurement.meetingRight <= measurement.statusLeft, `${label} row ${index}: meeting metadata overlaps status`);
    }
    if (measurement.contextWidth !== null && measurement.contextLeft !== null && measurement.contextRight !== null) {
      assert.ok(measurement.contextWidth >= measurement.headerWidth - 2, `${label} row ${index}: context lost full-row width (${measurement.contextWidth}px of ${measurement.headerWidth}px)`);
      assert.ok(measurement.contextLeft >= measurement.headerLeft - 1 && measurement.contextRight <= measurement.headerRight + 1, `${label} row ${index}: context escapes the row`);
    }
  }
}

async function toggleMeeting(meeting: ReturnType<Page["locator"]>): Promise<void> {
  await meeting.locator(":scope > div").first().click();
}

async function decideTask(page: Page, id: string, verdict: "Approve" | "Dismiss"): Promise<void> {
  const card = page.locator(`[data-task-card="${id}"]`);
  await card.getByTitle("Proposed — not yet a task. Approve, assign to an agent, or dismiss").click();
  await Promise.all([
    page.waitForResponse((response) => response.url().includes("/api/loops/verdicts") && response.request().method() === "POST"),
    page.getByRole("menuitem", { name: verdict, exact: true }).click(),
  ]);
}

async function expectPending(decisions: ReturnType<Page["locator"]>, count: number, timeout = 10_000): Promise<void> {
  await waitForAsync(async () => (await decisions.locator("[data-decision-pending-count]").innerText()).trim() === `${count} pending`, timeout, `${count} pending decisions`);
}

async function expectCount(locator: ReturnType<Page["locator"]>, count: number, timeout: number): Promise<void> {
  await waitForAsync(async () => await locator.count() === count, timeout, `count ${count}`);
}

async function navigationEntries(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

function prepareWorkspace(workspace: string): void {
  const excluded = new Set([".git", ".next", ".next-prod", ".gate-shots", "data", "dist", "node_modules", "worktrees"]);
  fs.cpSync(REPO, workspace, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(REPO, source);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      return !excluded.has(top) && !top.startsWith(".next-") && !top.startsWith(".env");
    },
  });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(workspace, "node_modules"), "dir");
}

function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): RunningProcess {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-40_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-40_000); });
  return { child, logs: () => output };
}

async function stopProcess(process: RunningProcess, signal: NodeJS.Signals): Promise<void> {
  if (process.child.exitCode !== null) return;
  process.child.kill(signal);
  await Promise.race([
    new Promise<void>((resolve) => process.child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(() => { if (process.child.exitCode === null) process.child.kill("SIGKILL"); resolve(); }, 5_000)),
  ]);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate port"));
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitForHttp(url: string, timeoutMs: number, process: RunningProcess): Promise<void> {
  await waitForAsync(async () => {
    if (process.child.exitCode !== null) throw new Error(`process exited ${process.child.exitCode}\n${process.logs()}`);
    try { return (await fetch(url)).ok; } catch { return false; }
  }, timeoutMs, url);
}

async function waitForAsync(check: () => boolean | Promise<boolean>, timeoutMs: number, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function waitFor(check: () => boolean, timeoutMs: number, label: string, process?: RunningProcess): Promise<void> {
  return waitForAsync(() => {
    if (process?.child.exitCode !== null && process?.child.exitCode !== undefined) throw new Error(`${label} exited\n${process.logs()}`);
    return check();
  }, timeoutMs, label);
}

function snapshotTree(root: string): Record<string, string> {
  const snapshot: Record<string, string> = {};
  for (const relativeRoot of ["briefings", "tasks"]) {
    const absoluteRoot = path.join(root, relativeRoot);
    if (!fs.existsSync(absoluteRoot)) continue;
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const absolute = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(absolute);
        else if (entry.isFile()) snapshot[path.relative(root, absolute)] = crypto.createHash("sha256").update(fs.readFileSync(absolute)).digest("hex");
      }
    };
    walk(absoluteRoot);
  }
  return snapshot;
}

function assertSafe(root: string, vault: string): void {
  assert.ok(fs.existsSync(path.join(root, SENTINEL)), "missing isolated E2E sentinel");
  assert.ok(path.resolve(vault).startsWith(`${path.resolve(root)}${path.sep}`), `unsafe fixture vault: ${vault}`);
}

void main();
