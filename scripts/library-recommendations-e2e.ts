#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { stringifyMarkdown } from "../src/lib/library/markdown";
import { writeRecommendationBatch } from "../src/lib/library/recommendation-store";

const HOST = "127.0.0.1";
const REPO = process.cwd();
const SENTINEL = ".hilt-library-recommendations-e2e";

interface FixtureItem {
  id: string;
  title: string;
  summary: string;
  createdAt: string;
  candidate?: boolean;
  thumbnail?: string;
}

interface RunningProcess {
  child: ChildProcess;
  logs: () => string;
}

const ITEMS: FixtureItem[] = [
  { id: "artifact-a", title: "Agent-native delivery needs a different operating model", summary: "A practical field guide to specification quality, review loops, and human judgment in agent-native software delivery.", createdAt: "2026-07-08T08:00:00.000Z", thumbnail: "/demo/library-ai-loop.svg" },
  { id: "artifact-b", title: "Model routing beyond a single benchmark", summary: "Why production routing should combine task shape, latency, cost, and observed failure modes instead of one aggregate score.", createdAt: "2026-07-08T08:01:00.000Z", thumbnail: "/demo/library-newsletter.svg" },
  { id: "artifact-c", title: "The validator as product infrastructure", summary: "Evaluation systems become operational product infrastructure when they feed decisions rather than merely report scores.", createdAt: "2026-07-08T08:02:00.000Z" },
  { id: "artifact-d", title: "Designing AI tools around reviewable artifacts", summary: "Artifact-first collaboration gives people concrete work to inspect, revise, and approve.", createdAt: "2026-07-08T08:03:00.000Z", thumbnail: "/demo/library-video.svg" },
  { id: "artifact-e", title: "A durable memory layer for working agents", summary: "File-native context and explicit provenance make long-running agent work easier to audit and resume.", createdAt: "2026-07-08T08:04:00.000Z" },
  { id: "artifact-f", title: "From copilots to delegated workflows", summary: "The useful transition is not more chat, but bounded delegation with visible checkpoints and recovery paths.", createdAt: "2026-07-09T08:00:00.000Z", thumbnail: "/demo/library-ai-loop.svg" },
  { id: "artifact-g", title: "Context engineering for teams", summary: "Teams need shared context contracts, not ever-larger prompts, to make agent work repeatable.", createdAt: "2026-07-09T08:01:00.000Z" },
  { id: "artifact-h", title: "Why domain experts are winning right now", summary: "Domain judgment becomes more valuable as implementation gets cheaper and iteration cycles compress.", createdAt: "2026-07-09T08:02:00.000Z", thumbnail: "/demo/library-newsletter.svg" },
  { id: "artifact-i", title: "Operating a high-signal knowledge intake", summary: "A useful intake system separates capture, processing, editorial selection, and durable recall.", createdAt: "2026-07-09T08:03:00.000Z" },
  { id: "artifact-j", title: "The agent-native way to ship software", summary: "Agents, documents, databases, and review checkpoints can form one continuous product-development workflow.", createdAt: "2026-07-10T08:00:00.000Z", candidate: true, thumbnail: "/demo/library-ai-loop.svg" },
  { id: "artifact-k", title: "Progressive disclosure for live processing systems", summary: "Stable placeholders and stage-aware updates let people trust background processing without watching infrastructure.", createdAt: "2026-07-10T08:01:00.000Z" },
  { id: "artifact-l", title: "A personal algorithm should explain why now", summary: "Recommendations become useful when the pitch is contextual, timely, and distinct from the source summary.", createdAt: "2026-07-10T08:02:00.000Z", thumbnail: "/demo/library-newsletter.svg" },
  { id: "artifact-m", title: "Briefings as an attention interface", summary: "A briefing should direct attention with judgment and context, not restate system health counters.", createdAt: "2026-07-10T08:03:00.000Z" },
  { id: "artifact-n", title: "Feedback loops for recommendation quality", summary: "Dismissal reasons, comments, and observed opens provide different evidence and should stay distinct.", createdAt: "2026-07-10T08:04:00.000Z", thumbnail: "/demo/library-video.svg" },
];

async function main(): Promise<void> {
  const originalData = process.env.DATA_DIR;
  const realVault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || null;
  const realBefore = realVault ? snapshotLibraryTree(realVault) : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-recommendations-e2e-"));
  const home = path.join(root, "home");
  const vault = path.join(root, "vault");
  const data = path.join(root, "data");
  const shots = path.join(root, "screenshots");
  const workspace = path.join(root, "workspace");
  const distName = ".next-library-recommendations-e2e";
  let app: RunningProcess | null = null;
  let ws: RunningProcess | null = null;
  let browser: Browser | null = null;
  let mobileContext: BrowserContext | null = null;

  for (const dir of [home, vault, data, shots]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(root, SENTINEL), "isolated recommendation E2E\n", "utf-8");
  assertSafe(root, vault);
  prepareWorkspace(workspace);
  process.env.DATA_DIR = data;

  try {
    seedVault(vault);
    const seeded = seedRecommendationDays(vault);
    seedBriefing(vault, seeded.briefingEpisodeIds);
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
      HILT_LIBRARY_WATCHER_POLLING: "1",
      HILT_LIBRARY_INTAKE_DAEMON: "0",
      HILT_GRANOLA_SYNC_DAEMON: "0",
      HILT_CALENDAR_SYNC_DAEMON: "0",
      HILT_GRAPH_ENABLED: "false",
      HILT_SEMANTIC_ENABLED: "false",
      LIBRARY_CONNECTIONS_DISABLED: "1",
      NEXT_TELEMETRY_DISABLED: "1",
    };

    ws = spawnLogged(process.execPath, ["--import", "tsx", "server/ws-server.ts"], env, workspace);
    await waitFor(() => fs.existsSync(path.join(home, ".hilt-ws-port")), 20_000, "WebSocket server", ws);
    app = spawnLogged(process.execPath, ["--import", "tsx", "server/app-server.ts"], env, workspace);
    await waitForHttp(`${baseUrl}/api/library/recommendations?limit=20`, 120_000, app);

    const initial = await recommendationFeed(baseUrl, 30);
    assert.deepEqual(initial.items.map((item) => item.id), seeded.expectedOrder);
    assert.equal(new Set(initial.items.map((item) => item.id)).size, initial.items.length, "projection contains one card per artifact");
    assert.equal(initial.items[0].recommendation.why_now, seeded.resurfacedWhy);
    assert.equal(initial.items[0].recommendation.is_resurface, true);

    browser = await chromium.launch({ headless: true });
    const desktop = await browser.newContext({ viewport: { width: 1440, height: 1050 }, colorScheme: "light" });
    const page = await desktop.newPage();
    let navigationCount = await openBriefing(page, baseUrl);
    const libraryModules = page.locator("[data-briefing-library-module]");
    assert.deepEqual(
      await libraryModules.evaluateAll((modules) => modules.map((module) => module.getAttribute("data-briefing-library-module"))),
      ["recommendations", "memo", "health"],
      "weekend Library briefing clusters recommendations, memo, and health in editorial order",
    );
    assert.match(await page.locator("[data-briefing-recommendation-lead]").innerText(), /accountable for it/i);
    assert.match(await page.locator('[data-briefing-library-module="memo"]').innerText(), /Weekly editor's memo/i);
    assert.match(await page.locator('[data-briefing-library-module="health"]').innerText(), /processing is healthy/i);
    assert.equal(await page.getByRole("button", { name: "View all", exact: true }).count(), 1);
    assert.equal(await page.getByRole("link", { name: "Read the memo", exact: true }).count(), 1);
    assert.equal(await page.getByRole("link", { name: "Daily library report", exact: true }).count(), 1);
    let briefingRows = page.locator("[data-recommendation-episode-id]");
    await expectCount(briefingRows, 3, 30_000);
    await expectCount(briefingRows.locator("[data-briefing-recommendation-description]"), 3, 30_000);
    assert.deepEqual(await briefingRows.evaluateAll((rows) => rows.map((row) => row.getAttribute("data-recommendation-episode-id"))), seeded.briefingEpisodeIds);
    assert.equal(await briefingRows.evaluateAll((rows) => rows.every((row) => row.classList.contains("hilt-card"))), true, "briefing recommendations render as cards");
    assert.equal(await briefingRows.locator("[data-briefing-recommendation-description]").count(), 3, "each briefing card renders one editorial description");
    assert.doesNotMatch(await briefingRows.first().innerText(), /Why now:/, "briefing pitch is styled as the description without a label");
    assert.doesNotMatch(await briefingRows.first().innerText(), new RegExp(ITEMS[0].summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "briefing card does not repeat the source summary");
    await page.screenshot({ path: path.join(shots, "desktop-briefing-light.png"), fullPage: true });
    await page.locator("[data-briefing-library-modules]").screenshot({ path: path.join(shots, "desktop-library-modules-light.png") });

    await briefingRows.first().click();
    await page.waitForURL(new RegExp(`\\brec=${seeded.briefingEpisodeIds[0]}\\b`));
    await page.getByTestId("library-artifact-detail").waitFor({ timeout: 30_000 });
    assert.equal((await page.locator("[data-library-recommendation-pitch]").innerText()).trim(), seeded.frozenWhy);
    assert.notEqual(seeded.frozenWhy, seeded.resurfacedWhy, "fixture must distinguish frozen and active pitches");
    assert.match(await page.getByTestId("library-artifact-detail").innerText(), new RegExp(ITEMS[0].summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

    navigationCount = await openBriefing(page, baseUrl);
    briefingRows = page.locator("[data-recommendation-episode-id]");
    await expectCount(briefingRows, 3, 30_000);
    await expectCount(briefingRows.locator("[data-briefing-recommendation-description]"), 3, 30_000);

    const firstBriefingRow = briefingRows.first();
    await firstBriefingRow.getByTitle("Dismiss recommendation").click();
    await page.getByLabel("Optional recommendation feedback").fill("The timing is wrong for this recommendation fixture.");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/recommendations/") && response.url().endsWith("/dismiss") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Dismiss", exact: true }).click(),
    ]);
    await page.getByText("Recommendation dismissed", { exact: true }).waitFor();
    await page.screenshot({ path: path.join(shots, "desktop-briefing-dismissed-light.png"), fullPage: true });
    assertThreadFeedback(data, "The timing is wrong for this recommendation fixture.");
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/recommendations/") && response.url().endsWith("/restore") && response.request().method() === "POST"),
      page.getByRole("button", { name: "Undo", exact: true }).click(),
    ]);
    await expectCount(page.locator("[data-recommendation-episode-id]"), 3, 10_000);

    await page.getByRole("button", { name: "View all", exact: true }).click();
    await page.waitForURL(/\/library\?rank=for-you/);
    await page.getByTestId("library-feed-list").waitFor({ timeout: 30_000 });
    assert.equal(await navigationEntries(page), navigationCount, "briefing View all navigates natively without reloading");
    const topCard = cardFor(page, "artifact-a");
    await topCard.waitFor();
    assert.match(await topCard.innerText(), /Recommended again/);
    assert.equal(await topCard.getAttribute("data-library-card-copy"), "recommendation");
    assert.equal((await topCard.locator("[data-library-card-description]").innerText()).trim(), seeded.resurfacedWhy);
    assert.doesNotMatch(await topCard.innerText(), /Why now:/);
    assert.doesNotMatch(await topCard.innerText(), new RegExp(ITEMS[0].summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "For You must not duplicate the source description");
    assert.equal(await page.locator('article[data-library-artifact-id="artifact-a"]').count(), 1);
    await page.screenshot({ path: path.join(shots, "desktop-for-you-light.png"), fullPage: false });

    await page.goto(`${baseUrl}/library?rank=recent`, { waitUntil: "domcontentloaded" });
    const recentFixture = ITEMS.find((item) => item.id === "artifact-n")!;
    const recentRecommendation = initial.items.find((item) => item.id === recentFixture.id)!.recommendation;
    const recentCard = cardFor(page, recentFixture.id);
    await recentCard.waitFor({ timeout: 30_000 });
    assert.equal(await recentCard.getAttribute("data-library-card-copy"), "standard");
    assert.equal((await recentCard.locator("[data-library-card-description]").innerText()).trim(), recentFixture.summary);
    assert.equal(await recentCard.locator('[aria-label="In For You"]').count(), 1);
    assert.doesNotMatch(await recentCard.innerText(), new RegExp(recentRecommendation.why_now.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "Recent keeps the pitch out of standard card copy");
    await page.screenshot({ path: path.join(shots, "desktop-recent-recommended-light.png"), fullPage: false });

    await page.goto(`${baseUrl}/library?rank=for-you`, { waitUntil: "domcontentloaded" });
    await topCard.waitFor({ timeout: 30_000 });
    const libraryNavigationCount = await navigationEntries(page);

    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(shots, "desktop-for-you-dark.png"), fullPage: false });

    const candidateCard = cardFor(page, "artifact-j");
    await candidateCard.scrollIntoViewIfNeeded();
    assert.match(await candidateCard.innerText(), /Candidate/);
    await candidateCard.getByTitle("Dismiss recommendation").click();
    await page.screenshot({ path: path.join(shots, "desktop-dismiss-popover-dark.png"), fullPage: false });
    await page.keyboard.press("Escape");

    await topCard.scrollIntoViewIfNeeded();
    await topCard.click();
    await page.getByTestId("library-artifact-detail").waitFor();
    assert.equal((await page.locator("[data-library-recommendation-pitch]").innerText()).trim(), seeded.resurfacedWhy);
    assert.match(await page.getByTestId("library-artifact-detail").innerText(), new RegExp(ITEMS[0].summary.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "detail keeps the source digest below recommendation context");
    assert.match(page.url(), new RegExp(`\\brec=${initial.items[0].recommendation.episode_id}\\b`));
    await page.screenshot({ path: path.join(shots, "desktop-detail-both-dark.png"), fullPage: false });
    const readResponse = page.waitForResponse((response) => response.url().includes("/api/library/read") && response.request().method() === "POST");
    await topCard.click();
    await readResponse;
    const afterRead = await recommendationFeed(baseUrl, 30);
    assert.deepEqual(afterRead.items.map((item) => item.id), seeded.expectedOrder, "read state does not alter feed position");
    assert.equal(afterRead.items[0].is_unread, false);

    const feed = page.getByTestId("library-feed-list");
    await page.waitForTimeout(300);
    await feed.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      node.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(350);
    const deepScrollTop = await feed.evaluate((node) => node.scrollTop);
    assert.ok(deepScrollTop >= 160, `fixture must establish a deep feed scroll before insertion (scrollTop=${deepScrollTop})`);
    const anchor = await visibleAnchor(page);
    assert.ok(anchor, "deep feed exposes a visible anchor");
    const day4Items: FixtureItem[] = [
      { id: "artifact-o", title: "A deliberately long recommendation title that must stay readable across compact mobile cards without colliding with controls", summary: "A newly selected item used to prove live insertion and long-title containment in the recommendation feed.", createdAt: "2026-07-10T20:00:00.000Z", thumbnail: "/demo/library-ai-loop.svg" },
      { id: "artifact-p", title: "Live editorial refresh", summary: "A second new item proves that the quiet insertion affordance reports the actual number of episodes.", createdAt: "2026-07-10T20:01:00.000Z" },
    ];
    for (const item of day4Items) writeArtifact(vault, item);
    writeRecommendationBatch(vault, {
      kind: "fixture",
      generated_at: "2026-07-10T20:20:00.000Z",
      context_window: { start: "2026-07-10T17:20:00.000Z", end: "2026-07-10T20:20:00.000Z" },
      pool_size: 2,
      picks: day4Items.map((item, index) => ({
        artifact_id: item.id,
        why_now: index === 0
          ? "A newly changed mobile release task makes this implementation pattern immediately useful; inspect the containment and review controls before the next interface pass."
          : "The refresh itself is now observable, so this is the right moment to verify the attention feed rather than its underlying score.",
        triggers: [{ id: `task:live-${index}`, kind: "task", label: "Live E2E task", occurred_at: "2026-07-10T20:10:00.000Z", fingerprint: `live-${index}` }],
        scores: score(index),
      })),
    });

    const newItems = page.getByRole("button", { name: /^\d+ new items?$/ }).first();
    await newItems.waitFor({ timeout: 10_000 }).catch(async (error) => {
      const diagnostics = await page.evaluate(() => ({
        scrollTop: document.querySelector<HTMLElement>('[data-testid="library-feed-list"]')?.scrollTop ?? null,
        visibleIds: Array.from(document.querySelectorAll<HTMLElement>("article[data-library-artifact-id]")).map((node) => node.dataset.libraryArtifactId),
        buttons: Array.from(document.querySelectorAll("button")).map((button) => button.textContent?.trim()).filter(Boolean).filter((text) => /new/i.test(text || "")),
      }));
      throw new Error(`${error instanceof Error ? error.message : String(error)}\nDiagnostics: ${JSON.stringify(diagnostics)}`);
    });
    assert.equal((await newItems.innerText()).trim(), "2 new items");
    const anchored = await anchorPosition(page, anchor!.id);
    const anchoredScrollTop = await feed.evaluate((node) => node.scrollTop);
    assert.ok(
      anchored !== null && Math.abs(anchored - anchor!.top) < 8,
      `live insertion preserves the visible card anchor (id=${anchor!.id}, before=${anchor!.top}, after=${anchored}, scrollTop=${anchoredScrollTop})`,
    );
    assert.equal(await navigationEntries(page), libraryNavigationCount, "live insertion never reloads the page");
    await newItems.click();
    await cardFor(page, "artifact-o").waitFor({ timeout: 10_000 });
    const liveFeed = await recommendationFeed(baseUrl, 30);
    assert.deepEqual(liveFeed.items.slice(0, 2).map((item) => item.id), ["artifact-o", "artifact-p"]);

    mobileContext = await browser.newContext({ viewport: { width: 393, height: 852 }, colorScheme: "dark", isMobile: true, hasTouch: true });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${baseUrl}/library?rank=for-you`, { waitUntil: "domcontentloaded" });
    await cardFor(mobile, "artifact-o").waitFor({ timeout: 30_000 });
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile feed has no horizontal overflow");
    await mobile.screenshot({ path: path.join(shots, "mobile-for-you-dark.png"), fullPage: false });
    await assertMobileControlsClearNavigation(mobile, cardFor(mobile, "artifact-o"));
    await mobile.emulateMedia({ colorScheme: "light" });
    await mobile.waitForTimeout(150);
    await mobile.screenshot({ path: path.join(shots, "mobile-for-you-light.png"), fullPage: false });

    await mobile.goto(`${baseUrl}/briefings`, { waitUntil: "domcontentloaded" });
    await expectCount(mobile.locator("[data-recommendation-episode-id]"), 3, 30_000);
    await expectCount(mobile.locator("[data-briefing-recommendation-description]"), 3, 30_000);
    assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, "mobile briefing rows have no horizontal overflow");
    await mobile.screenshot({ path: path.join(shots, "mobile-briefing-light.png"), fullPage: true });
    await mobile.locator("[data-briefing-library-modules]").screenshot({ path: path.join(shots, "mobile-library-modules-light.png") });
    await mobile.locator('[data-briefing-library-module="memo"]').screenshot({ path: path.join(shots, "mobile-library-memo-light.png") });
    await mobile.locator('[data-briefing-library-module="health"]').screenshot({ path: path.join(shots, "mobile-library-health-light.png") });
    await assertMobileControlsClearNavigation(mobile, mobile.locator("[data-recommendation-episode-id]").first());
    await mobile.emulateMedia({ colorScheme: "dark" });
    await mobile.waitForTimeout(150);
    await mobile.screenshot({ path: path.join(shots, "mobile-briefing-dark.png"), fullPage: true });
    await mobile.locator("[data-briefing-library-modules]").screenshot({ path: path.join(shots, "mobile-library-modules-dark.png") });
    await mobile.locator('[data-briefing-library-module="memo"]').screenshot({ path: path.join(shots, "mobile-library-memo-dark.png") });
    await mobile.locator('[data-briefing-library-module="health"]').screenshot({ path: path.join(shots, "mobile-library-health-dark.png") });

    await selectDailyBriefing(mobile);
    await mobile.locator('[data-briefing-library-module="recommendations"]').getByText("Nothing new was selected for this briefing.", { exact: true }).waitFor();
    await mobile.screenshot({ path: path.join(shots, "mobile-briefing-empty-dark.png"), fullPage: true });
    await mobile.locator("[data-briefing-library-modules]").screenshot({ path: path.join(shots, "mobile-library-modules-empty-dark.png") });
    await mobile.emulateMedia({ colorScheme: "light" });
    await mobile.waitForTimeout(150);
    await mobile.screenshot({ path: path.join(shots, "mobile-briefing-empty-light.png"), fullPage: true });
    await mobile.locator("[data-briefing-library-modules]").screenshot({ path: path.join(shots, "mobile-library-modules-empty-light.png") });

    await page.emulateMedia({ colorScheme: "light" });
    await openBriefing(page, baseUrl);
    await selectDailyBriefing(page);
    await page.screenshot({ path: path.join(shots, "desktop-briefing-empty-light.png"), fullPage: true });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.waitForTimeout(150);
    await page.screenshot({ path: path.join(shots, "desktop-briefing-empty-dark.png"), fullPage: true });

    await desktop.close();
    await mobileContext.close();
    mobileContext = null;
    console.log(`[library-recommendations-e2e] PASS. Screenshots: ${shots}`);
  } catch (error) {
    console.error(`[library-recommendations-e2e] WebSocket log tail:\n${ws?.logs() || "(stopped)"}`);
    console.error(`[library-recommendations-e2e] App log tail:\n${app?.logs() || "(stopped)"}`);
    throw error;
  } finally {
    if (mobileContext) await mobileContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (ws) await stopProcess(ws, "SIGINT");
    if (app) await stopProcess(app, "SIGTERM");
    if (realVault && realBefore) assert.deepEqual(snapshotLibraryTree(realVault), realBefore, `Real Library tree changed: ${realVault}`);
    if (originalData === undefined) delete process.env.DATA_DIR; else process.env.DATA_DIR = originalData;
    if (process.env.KEEP_E2E === "1") console.log(`[library-recommendations-e2e] KEEP_E2E=1 retained ${root}`);
    else {
      assertSafe(root, vault);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function seedVault(vault: string): void {
  for (const dir of ["references/.cache/library-candidates", "briefings/weekend", "lists/now", "meta/sources"]) {
    fs.mkdirSync(path.join(vault, dir), { recursive: true });
  }
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-06.md"), "# Week\n\n- [ ] Verify the unified recommendation feed\n", "utf-8");
  for (const item of ITEMS) writeArtifact(vault, item);
}

function writeArtifact(vault: string, item: FixtureItem): void {
  const common = {
    artifact_uid: item.id,
    title: item.title,
    description: item.summary,
    url: `https://example.com/${item.id}`,
    format: item.id.endsWith("d") ? "video" : "article",
    author: item.candidate ? "Fixture Candidate Author" : "Fixture Author",
    channel: item.candidate ? "newsletter" : "manual",
    source_id: item.candidate ? "fixture-discovery" : "manual",
    source_name: item.candidate ? "Fixture Discovery" : "Fixture Saves",
    thumbnail: item.thumbnail || null,
    library_mode: "study",
    tags: ["agents", "product"],
    source_tags: ["e2e"],
    extracted_chars: 2800,
    substance: 0.82,
    reconnected_at: item.createdAt,
    digestion_status: "hot",
    digested_with: "source-metadata",
    digested_at: item.createdAt,
  };
  const body = `# ${item.title}\n\n## Summary\n\n${item.summary}\n\n## Connections\n\n- [[projects/hilt|Hilt]] - Relevant to the recommendation feed work.\n\n## Raw Content\n\nA deterministic source cache with enough prose to remain evaluable.`;
  if (item.candidate) {
    fs.writeFileSync(path.join(vault, "references", ".cache", "library-candidates", `${item.id}.md`), stringifyMarkdown({
      ...common,
      type: "reference-candidate",
      status: "candidate",
      intent: "discovery",
      published: item.createdAt,
      digested: item.createdAt,
      expires: "2027-01-01",
      save_recommendation: "review",
      score: { relevance: 0.8, novelty: 0.8, confidence: 0.8, total: 0.8 },
    }, body), "utf-8");
  } else {
    fs.writeFileSync(path.join(vault, "references", `${item.id}.md`), stringifyMarkdown({
      ...common,
      type: "reference",
      captured: item.createdAt.slice(0, 10),
      captured_at: item.createdAt,
      published: item.createdAt,
    }, body), "utf-8");
  }
}

function seedRecommendationDays(vault: string) {
  const byId = new Map(ITEMS.map((item) => [item.id, item]));
  const writeDay = (at: string, ids: string[], day: string) => writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: at,
    context_window: { start: `${day}T06:00:00.000Z`, end: at },
    pool_size: ids.length,
    picks: ids.map((id, index) => ({
      artifact_id: id,
      why_now: `A changed planning signal on day ${day.slice(-2)} puts recommendation ${index + 1} in front of a concrete review; inspect its evidence before the next implementation decision.`,
      triggers: [{ id: `artifact:${id}`, kind: "artifact", label: byId.get(id)!.title, occurred_at: byId.get(id)!.createdAt, fingerprint: `${day}-${id}` }],
      scores: score(index),
    })),
  });
  const day1 = writeDay("2026-07-08T09:20:00.000Z", ["artifact-a", "artifact-b", "artifact-c", "artifact-d", "artifact-e"], "2026-07-08");
  const day2 = writeDay("2026-07-09T09:20:00.000Z", ["artifact-f", "artifact-g", "artifact-h", "artifact-i"], "2026-07-09");
  const resurfacedWhy = "Yesterday's release-planning decision now needs the operating model in this reference; use its review checkpoints to shape the implementation before the next handoff.";
  const day3 = writeRecommendationBatch(vault, {
    kind: "fixture",
    generated_at: "2026-07-10T09:20:00.000Z",
    context_window: { start: "2026-07-10T06:00:00.000Z", end: "2026-07-10T09:20:00.000Z" },
    pool_size: 6,
    picks: ["artifact-a", "artifact-j", "artifact-k", "artifact-l", "artifact-m", "artifact-n"].map((id, index) => ({
      artifact_id: id,
      why_now: id === "artifact-a"
        ? resurfacedWhy
        : `A changed recommendation task makes ${byId.get(id)!.title} useful before the next review; inspect its consequences while the interface decision is still open.`,
      triggers: [{ id: `task:day3-${id}`, kind: "task", label: "Recommendation E2E task", occurred_at: "2026-07-10T08:30:00.000Z", fingerprint: `day3-${id}` }],
      scores: score(index),
    })),
  });
  return {
    expectedOrder: ["artifact-a", "artifact-j", "artifact-k", "artifact-l", "artifact-m", "artifact-n", "artifact-f", "artifact-g", "artifact-h", "artifact-i", "artifact-b", "artifact-c", "artifact-d", "artifact-e"],
    briefingEpisodeIds: [day1.episodes[0].id, day3.episodes[1].id, day3.episodes[2].id],
    frozenWhy: day1.episodes[0].why_now,
    resurfacedWhy,
    day1,
    day2,
  };
}

function score(index: number) {
  return { worth: 0.9 - index * 0.03, relevance: 0.85 - index * 0.02, substance: 0.82, freshness: 0.95 };
}

function seedBriefing(vault: string, episodeIds: string[]): void {
  fs.writeFileSync(path.join(vault, "briefings", "weekend", "2026-07-11.md"), `---
briefing_kind: weekend
date_range:
  start: 2026-07-11
  end: 2026-07-12
created_at: 2026-07-11T06:00:00-04:00
updated_at: 2026-07-11T06:00:00-04:00
title: Weekend Briefing — Jul 11-12, 2026
---

# Weekend Briefing — Jul 11-12, 2026

**The recommendation feed is the attention layer today.**

## 🧭 Direction of travel

- Verify the unified Library recommendation experience.

## 📚 Library & knowledge

### Recommended for you
This weekend's recommendations converge on one practical tension: agents can accelerate delivery only when their work remains legible to the people accountable for it. The set makes that tradeoff concrete across operating models, evaluation, and reviewable artifacts rather than treating automation as an end in itself.

${episodeIds.map((id) => `- \`rec:${id}\``).join("\n")}

### Editor's memo
**Reviewable work is the operating advantage**

The weekly memo connects the strongest sources to the product decisions now in motion, with a practical emphasis on evidence and accountability.

[Read the memo](/api/reports/memo)

### Library health
Library processing is healthy; two steering proposals await review, and judge agreement is 74%.

[Daily library report](/api/reports/morning)

---
*Generated by the \`briefing\` skill. To change this, edit the skill.*
`, "utf-8");

  fs.writeFileSync(path.join(vault, "briefings", "2026-07-10.md"), `# Morning Briefing — Friday, July 10, 2026

## 📅 Today

- A quiet fixture day with no selected recommendations.

## 📚 Library & knowledge

### Recommended for you
Nothing new was selected for this briefing.

### Library health
Library processing is healthy; no steering proposals need attention today. Today's daily library report is unavailable.

---
*Generated by the \`briefing\` skill. To change this, edit the skill.*
`, "utf-8");
}

async function recommendationFeed(baseUrl: string, limit: number) {
  const response = await fetch(`${baseUrl}/api/library/recommendations?limit=${limit}`);
  const body = await response.json() as { items: Array<{ id: string; is_unread: boolean; recommendation: { episode_id: string; why_now: string; is_resurface: boolean } }> };
  assert.ok(response.ok, JSON.stringify(body));
  return body;
}

async function openBriefing(page: Page, baseUrl: string): Promise<number> {
  await page.goto(`${baseUrl}/briefings`, { waitUntil: "domcontentloaded" });
  await page.getByText("📚 Library & knowledge", { exact: true }).waitFor({ timeout: 30_000 });
  return navigationEntries(page);
}

async function selectDailyBriefing(page: Page): Promise<void> {
  await page.locator("[data-briefing-selector]").click();
  await page.locator('[data-briefing-option-id="2026-07-10"]').click();
  await page.locator('[data-briefing-library-module="recommendations"]').waitFor();
}

function cardFor(page: Page, id: string) {
  return page.locator(`article[data-library-artifact-id="${id}"]`).first();
}

async function expectCount(locator: ReturnType<Page["locator"]>, count: number, timeout: number) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await locator.count() === count) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(await locator.count(), count);
}

function assertThreadFeedback(data: string, expected: string): void {
  const dir = path.join(data, "threads");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => name.endsWith(".json")) : [];
  assert.equal(files.length, 1);
  const thread = JSON.parse(fs.readFileSync(path.join(dir, files[0]), "utf-8")) as { target: { kind: string; id: string }; messages: Array<{ text: string }> };
  assert.deepEqual(thread.target, { kind: "library", id: "artifact-a" });
  assert.equal(thread.messages.at(-1)?.text, expected);
}

async function navigationEntries(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

async function visibleAnchor(page: Page): Promise<{ id: string; top: number } | null> {
  return page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>('[data-testid="library-feed-list"]');
    if (!feed) return null;
    const bounds = feed.getBoundingClientRect();
    for (const card of Array.from(feed.querySelectorAll<HTMLElement>("article[data-library-artifact-id]"))) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > bounds.top + 8 && rect.top < bounds.bottom) return { id: card.dataset.libraryArtifactId || "", top: rect.top - bounds.top };
    }
    return null;
  });
}

async function anchorPosition(page: Page, id: string): Promise<number | null> {
  await page.waitForTimeout(500);
  return page.evaluate((artifactId) => {
    const feed = document.querySelector<HTMLElement>('[data-testid="library-feed-list"]');
    const card = document.querySelector<HTMLElement>(`article[data-library-artifact-id="${CSS.escape(artifactId)}"]`);
    return feed && card ? card.getBoundingClientRect().top - feed.getBoundingClientRect().top : null;
  }, id);
}

async function assertMobileControlsClearNavigation(page: Page, card: ReturnType<Page["locator"]>): Promise<void> {
  await card.scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const action = await card.getByTitle("Dismiss recommendation").boundingBox();
  const nav = await page.locator("[data-mobile-chrome-bottom] nav").boundingBox();
  assert.ok(action && nav, "mobile action and navigation are measurable");
  assert.ok(action.y + action.height <= nav.y || action.y >= nav.y + nav.height, "recommendation actions do not overlap mobile navigation");
}

function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv, cwd = REPO): RunningProcess {
  const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-40_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-40_000); });
  return { child, logs: () => output };
}

function prepareWorkspace(workspace: string): void {
  const excluded = new Set([".git", ".next", ".next-prod", ".gate-shots", "data", "dist", "node_modules", "worktrees"]);
  fs.cpSync(REPO, workspace, {
    recursive: true,
    filter: (source) => {
      const relative = path.relative(REPO, source);
      if (!relative) return true;
      const top = relative.split(path.sep)[0];
      return !excluded.has(top)
        && !top.startsWith(".next-library-")
        && !top.startsWith(".env");
    },
  });
  fs.symlinkSync(path.join(REPO, "node_modules"), path.join(workspace, "node_modules"), "dir");
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

async function waitFor(check: () => boolean, timeoutMs: number, label: string, process?: RunningProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process?.child.exitCode !== null) throw new Error(`${label} exited early.\n${process?.logs()}`);
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}.\n${process?.logs() || ""}`);
}

async function waitForHttp(url: string, timeoutMs: number, process: RunningProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process.child.exitCode !== null) throw new Error(`App exited early.\n${process.logs()}`);
    try {
      if ((await fetch(url, { cache: "no-store" })).ok) return;
    } catch { /* wait while Next compiles */ }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for app.\n${process.logs()}`);
}

function assertSafe(root: string, vault: string): void {
  const resolvedRoot = path.resolve(root);
  assert.ok(path.basename(resolvedRoot).startsWith("hilt-library-recommendations-e2e-"));
  assert.ok(path.resolve(vault).startsWith(`${resolvedRoot}${path.sep}`));
  assert.ok(fs.existsSync(path.join(resolvedRoot, SENTINEL)));
}

function snapshotLibraryTree(vaultPath: string): Array<{ path: string; size: number; hash: string }> {
  const root = path.join(vaultPath, "references");
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(root);
  return files.sort().map((filePath) => {
    const content = fs.readFileSync(filePath);
    return { path: path.relative(root, filePath).split(path.sep).join("/"), size: content.length, hash: crypto.createHash("sha256").update(content).digest("hex") };
  });
}

main().catch((error) => {
  console.error("[library-recommendations-e2e] FAIL", error);
  process.exitCode = 1;
});
