#!/usr/bin/env tsx
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { stringifyMarkdown } from "../src/lib/library/markdown";

const HOST = "127.0.0.1";
const REPO = process.cwd();
const SENTINEL = ".hilt-library-live-e2e";
const READY_TITLE = "OpenAI: Introducing GPT-4.1";
const BLOCKED_TITLE = "OpenAI source unavailable fixture";
const STREAMED_TITLE = "OpenAI: Structured Outputs in the API";
const REDUCED_TITLE = "OpenAI: Responses API processing fixture";
const MOBILE_TITLE = "OpenAI: Mobile processing fixture";
const FALLBACK_TITLE = "OpenAI: WebSocket fallback fixture";

interface FixtureSave {
  url: string;
  title: string;
  content?: string;
}

interface RunningProcess {
  child: ChildProcess;
  logs: () => string;
}

async function main(): Promise<void> {
  loadEnvConfig(REPO);
  const realVault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || null;
  const realBefore = realVault ? snapshotLibraryTree(realVault) : null;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-library-live-e2e-"));
  const home = path.join(root, "home");
  const vault = path.join(root, "vault");
  const data = path.join(root, "data");
  const shots = path.join(root, "screenshots");
  const sentinelPath = path.join(root, SENTINEL);
  const distName = `.next-library-live-e2e-${process.pid}`;
  const distPath = path.join(REPO, distName);
  const tsconfigPath = path.join(REPO, "tsconfig.json");
  const tsconfigBefore = fs.readFileSync(tsconfigPath, "utf-8");
  let app: RunningProcess | null = null;
  let ws: RunningProcess | null = null;
  let browser: Browser | null = null;
  let mobileContext: BrowserContext | null = null;

  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(vault, { recursive: true });
  fs.mkdirSync(data, { recursive: true });
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(sentinelPath, "isolated Hilt Library E2E\n", "utf-8");
  assertSafeE2EVault(root, vault);

  try {
    seedVault(vault);
    writeFixtures(vault, []);
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
      HILT_LIBRARY_WATCHER_POLLING: "1",
      HILT_LIBRARY_INTAKE_DAEMON: "1",
      HILT_GRANOLA_SYNC_DAEMON: "0",
      HILT_CALENDAR_SYNC_DAEMON: "0",
      HILT_GRAPH_ENABLED: "false",
      HILT_SEMANTIC_ENABLED: "false",
      LIBRARY_SUMMARIZE_DISABLED: "1",
      LIBRARY_CONNECTIONS_DISABLED: "1",
      LIBRARY_MEDIA_ENRICHMENT_DISABLED: "1",
      LIBRARY_PROCESSING_START_DELAY_MS: "1800",
      LIBRARY_PROCESSING_RETRY_DELAY_MS: "0",
      NEXT_TELEMETRY_DISABLED: "1",
    };

    ws = spawnLogged(process.execPath, ["--import", "tsx", "server/ws-server.ts"], env);
    await waitFor(() => fs.existsSync(path.join(home, ".hilt-ws-port")), 20_000, "WebSocket port file", ws);
    app = spawnLogged(process.execPath, ["--import", "tsx", "server/app-server.ts"], env);
    await waitForHttp(`${baseUrl}/api/library?limit=1`, 120_000, app);

    browser = await chromium.launch({ headless: true });
    const desktopContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: "dark" });
    const page = await desktopContext.newPage();
    await page.goto(`${baseUrl}/library`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("library-feed-list").waitFor({ timeout: 30_000 });

    const fixtures: FixtureSave[] = [
      {
        url: "https://openai.com/index/introducing-gpt-4-1/",
        title: READY_TITLE,
        content: "OpenAI presents GPT-4.1 with stronger coding, instruction following, long-context reliability, evaluations, deployment guidance, and practical details for developers building production applications.",
      },
      {
        url: "https://openai.com/index/new-models-and-developer-products-announced-at-devday/",
        title: BLOCKED_TITLE,
      },
    ];
    writeFixtures(vault, fixtures);
    const navigationCount = await navigationEntries(page);
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/api/sources/intake") && response.request().method() === "POST"),
      page.getByTestId("library-check-sources-toolbar").click(),
    ]);

    const readyCard = cardFor(page, READY_TITLE);
    await readyCard.waitFor({ timeout: 5_000 });
    await readyCard.locator("[data-processing-state]").waitFor({ timeout: 5_000 });
    const stableId = await readyCard.getAttribute("data-library-artifact-id");
    assert.ok(stableId, "processing card has a stable artifact id");
    const initialImage = await readyCard.locator("img").boundingBox();
    assert.ok(initialImage && initialImage.width > 100 && initialImage.height > 60, "processing card reserves real media dimensions");
    const firstCardText = await page.locator("article[data-library-artifact-id]").first().innerText();
    assert.match(firstCardText, /OpenAI/, "active intake cards are pinned above the baseline feed");

    await readyCard.click();
    const detail = page.getByTestId("library-artifact-detail");
    await detail.getByText(READY_TITLE, { exact: true }).waitFor();
    await detail.locator("[data-processing-state]").waitFor();
    const detailContent = detail.getByTestId("library-artifact-detail-content");
    const placeholderDetailText = await detailContent.innerText();
    assert.ok(placeholderDetailText.trim(), "processing reader exposes available placeholder content");
    const imageBefore = await readyCard.locator("img").boundingBox();
    assert.ok(imageBefore, "processing card media remains visible beside the open reader");
    await page.screenshot({ path: path.join(shots, "desktop-processing.png") });

    const deferredStatus = detail.locator('[data-processing-state="ready"][data-processing-stage="reweave"]');
    await deferredStatus.waitFor({ timeout: 12_000 });
    assert.match(await deferredStatus.innerText(), /Connections pending/, "a readable deferred weave is static and explicit");
    assert.equal(await readyCard.getByTitle(/^Worth:/).count(), 0, "deferred reweaves do not expose provisional worth scores");
    await detailContent.locator("h2").filter({ hasText: "Summary" }).waitFor({ timeout: 5_000 });
    const readyDetailText = await detailContent.innerText();
    assert.notEqual(readyDetailText, placeholderDetailText, "open reader replaces placeholder content with the ready digest");
    const blockedCard = cardFor(page, BLOCKED_TITLE);
    await blockedCard.locator('[data-processing-state="blocked"]').waitFor({ timeout: 15_000 });
    assert.equal(await readyCard.getAttribute("data-library-artifact-id"), stableId, "card identity survives enrichment");
    const imageAfter = await readyCard.locator("img").boundingBox();
    assert.ok(imageAfter);
    assert.ok(Math.abs(imageAfter.width - imageBefore.width) < 1 && Math.abs(imageAfter.height - imageBefore.height) < 1, "media does not shift while content updates");
    assert.equal(await navigationEntries(page), navigationCount, "toolbar intake does not reload the page");
    await page.screenshot({ path: path.join(shots, "desktop-ready-and-blocked.png") });

    await blockedCard.click();
    await detail.getByRole("heading", { name: BLOCKED_TITLE, exact: true }).waitFor();
    const retryButton = detail.getByRole("button", { name: "Retry" });
    await retryButton.waitFor();
    await Promise.all([
      page.waitForResponse((response) => response.url().includes("/processing/retry") && response.request().method() === "POST"),
      retryButton.click(),
    ]);
    await detail.locator('[data-processing-state="queued"], [data-processing-state="active"]').waitFor({ timeout: 5_000 });
    const blockedAgain = detail.locator('[data-processing-state="blocked"]');
    await blockedAgain.waitFor({ timeout: 15_000 });
    const blockedAnimation = await blockedAgain.locator("svg").first().evaluate((node) => getComputedStyle(node).animationName);
    assert.equal(blockedAnimation, "none", "terminal blocked state stops animating");
    await blockedCard.click();
    await page.getByTestId("library-feed-detail").waitFor({ state: "detached", timeout: 5_000 });
    const feed = page.getByTestId("library-feed-list");
    await feed.evaluate((node) => {
      node.scrollTop = 1900;
      node.dispatchEvent(new Event("scroll"));
    });
    await page.waitForTimeout(300);
    const anchor = await visibleAnchor(page);
    assert.ok(anchor, "deep feed has a visible anchor");

    fixtures.push({
      url: "https://openai.com/index/introducing-structured-outputs-in-the-api/",
      title: STREAMED_TITLE,
      content: "Structured Outputs gives developers dependable schema adherence for tool calls and JSON responses, reducing defensive parsing and making application workflows more reliable.",
    });
    writeFixtures(vault, fixtures);
    await forceIntake(baseUrl);
    const newItemsButton = page.getByRole("button", { name: /^\d+ new items?$/ });
    await newItemsButton.waitFor({ timeout: 5_000 });
    const afterAnchor = await anchorPosition(page, anchor!.id);
    assert.ok(afterAnchor !== null && Math.abs(afterAnchor - anchor!.top) < 6, "deep-scroll visible card stays anchored");
    await newItemsButton.click();
    await cardFor(page, STREAMED_TITLE).waitFor({ timeout: 5_000 });
    assert.match(await page.locator("article[data-library-artifact-id]").first().innerText(), /Structured Outputs/, "new active item pins in Recent");
    await cardFor(page, STREAMED_TITLE).locator('[data-processing-state="ready"][data-processing-stage="reweave"]').waitFor({ timeout: 8_000 });

    await page.emulateMedia({ reducedMotion: "reduce" });
    fixtures.push({
      url: "https://openai.com/index/new-tools-for-building-agents/",
      title: REDUCED_TITLE,
      content: "The Responses API and agent tools provide a unified foundation for model calls, tools, tracing, and durable application workflows across production systems.",
    });
    writeFixtures(vault, fixtures);
    await forceIntake(baseUrl);
    const reducedCard = cardFor(page, REDUCED_TITLE);
    await reducedCard.locator("[data-processing-state]").waitFor({ timeout: 5_000 });
    const animationName = await reducedCard.locator("[data-processing-state] svg").evaluate((node) => getComputedStyle(node).animationName);
    assert.equal(animationName, "none", "reduced-motion disables the processing rotation");
    await reducedCard.locator('[data-processing-state="ready"][data-processing-stage="reweave"]').waitFor({ timeout: 8_000 });

    mobileContext = await browser.newContext({
      viewport: { width: 393, height: 852 },
      colorScheme: "dark",
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobileContext.newPage();
    await mobile.goto(`${baseUrl}/library`, { waitUntil: "domcontentloaded" });
    await mobile.getByTestId("library-feed-list").waitFor({ timeout: 30_000 });
    fixtures.push({
      url: "https://openai.com/index/introducing-improvements-to-the-fine-tuning-api-and-expanding-our-custom-models-program/",
      title: MOBILE_TITLE,
      content: "OpenAI describes model customization improvements, better controls, evaluation support, and practical workflows for teams adapting models to focused production tasks.",
    });
    writeFixtures(vault, fixtures);
    await forceIntake(baseUrl);
    const mobileCard = cardFor(mobile, MOBILE_TITLE);
    const mobileStatus = mobileCard.locator("[data-processing-state]");
    await mobileStatus.waitFor({ timeout: 5_000 });
    await assertNoMobileOverlap(mobile, mobileStatus);
    await mobile.screenshot({ path: path.join(shots, "mobile-processing.png") });
    const mobileNavigationCount = await navigationEntries(mobile);
    const pullTarget = mobile.getByTestId("pull-to-refresh");
    await Promise.all([
      mobile.waitForResponse(
        (response) => response.url().includes("/api/sources/intake") && response.request().method() === "POST",
        { timeout: 7_000 },
      ),
      (async () => {
        await pullTarget.evaluate((node) => {
          const target = node as HTMLElement;
          const startTouch = new Touch({ identifier: 1, target, clientX: 180, clientY: 20, radiusX: 4, radiusY: 4, rotationAngle: 0, force: 1 });
          const moveTouch = new Touch({ identifier: 1, target, clientX: 180, clientY: 220, radiusX: 4, radiusY: 4, rotationAngle: 0, force: 1 });
          target.dispatchEvent(new TouchEvent("touchstart", { bubbles: true, cancelable: true, touches: [startTouch], changedTouches: [startTouch] }));
          target.dispatchEvent(new TouchEvent("touchmove", { bubbles: true, cancelable: true, touches: [moveTouch], changedTouches: [moveTouch] }));
        });
        await mobile.waitForTimeout(100);
        await pullTarget.evaluate((node) => {
          const target = node as HTMLElement;
          const touch = new Touch({ identifier: 1, target, clientX: 180, clientY: 220, radiusX: 4, radiusY: 4, rotationAngle: 0, force: 1 });
          target.dispatchEvent(new TouchEvent("touchend", { bubbles: true, cancelable: true, touches: [], changedTouches: [touch] }));
        });
      })(),
    ]);
    assert.equal(await navigationEntries(mobile), mobileNavigationCount, "mobile pull-to-refresh runs intake without reload");
    const mobileReadyStatus = mobileCard.locator('[data-processing-state="ready"][data-processing-stage="reweave"]');
    await mobileReadyStatus.waitFor({ timeout: 8_000 });
    await mobile.waitForFunction(() => {
      const container = document.querySelector('[data-testid="pull-to-refresh"]');
      const content = container?.children.item(1);
      if (!(content instanceof HTMLElement)) return false;
      const transform = getComputedStyle(content).transform;
      if (transform === "none") return true;
      return Math.abs(new DOMMatrixReadOnly(transform).m42) < 0.5;
    }, undefined, { timeout: 5_000 });
    const mobileReadyImage = mobileCard.locator("img").first();
    await mobileReadyImage.waitFor({ timeout: 5_000 });
    const readyImageWidth = await mobileReadyImage.evaluate(async (node) => {
      const image = node as HTMLImageElement;
      if (!image.complete) {
        await new Promise<void>((resolve, reject) => {
          image.addEventListener("load", () => resolve(), { once: true });
          image.addEventListener("error", () => reject(new Error("mobile ready image failed to load")), { once: true });
        });
      }
      await image.decode();
      return image.naturalWidth;
    });
    assert.ok(readyImageWidth > 0, "mobile ready card preserves painted source media");
    await assertNoMobileOverlap(mobile, mobileReadyStatus);
    await mobile.waitForTimeout(100);
    await mobile.screenshot({ path: path.join(shots, "mobile-ready.png") });

    const liveSmoke = await liveOpenAISmoke(baseUrl, vault, fixtures);
    if (liveSmoke.ok) console.log(`[library-live-e2e] Live OpenAI smoke ready: ${liveSmoke.title}`);
    else console.warn(`[library-live-e2e] Live OpenAI smoke unavailable: ${liveSmoke.error}`);

    await stopProcess(ws, "SIGINT");
    ws = null;
    await page.waitForTimeout(1_500);
    writeFallbackReference(vault);
    await cardFor(page, FALLBACK_TITLE).waitFor({ timeout: 9_000 });
    assert.equal(await navigationEntries(page), navigationCount, "disconnected five-second fallback does not reload");

    await desktopContext.close();
    await mobileContext.close();
    mobileContext = null;
    console.log(`[library-live-e2e] PASS. Screenshots: ${shots}`);
  } catch (error) {
    console.error(`[library-live-e2e] Queue files: ${JSON.stringify(listFiles(data).filter((file) => file.includes("library-processing")))}`);
    console.error(`[library-live-e2e] WebSocket log tail:\n${ws?.logs() || "(stopped)"}`);
    console.error(`[library-live-e2e] App log tail:\n${app?.logs() || "(stopped)"}`);
    throw error;
  } finally {
    if (mobileContext) await mobileContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    if (ws) await stopProcess(ws, "SIGINT");
    if (app) await stopProcess(app, "SIGTERM");
    if (distName.startsWith(".next-library-live-e2e-")) fs.rmSync(distPath, { recursive: true, force: true });
    if (fs.readFileSync(tsconfigPath, "utf-8") !== tsconfigBefore) fs.writeFileSync(tsconfigPath, tsconfigBefore, "utf-8");
    if (realVault && realBefore) {
      const realAfter = snapshotLibraryTree(realVault);
      assert.deepEqual(realAfter, realBefore, `Real Library tree changed during isolated E2E: ${realVault}`);
    }
    if (process.env.KEEP_E2E === "1") {
      console.log(`[library-live-e2e] KEEP_E2E=1 retained ${root}`);
    } else {
      assertSafeE2EVault(root, vault);
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
}

function listFiles(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files.push(path.relative(root, full).split(path.sep).join("/"));
    }
  };
  walk(root);
  return files.sort();
}

function assertSafeE2EVault(root: string, vault: string): void {
  const resolvedRoot = path.resolve(root);
  const resolvedVault = path.resolve(vault);
  assert.ok(path.basename(resolvedRoot).startsWith("hilt-library-live-e2e-"), "E2E root must use the sentinel prefix");
  assert.ok(resolvedVault.startsWith(`${resolvedRoot}${path.sep}`), "E2E vault must be inside the sentinel root");
  assert.ok(fs.existsSync(path.join(resolvedRoot, SENTINEL)), "E2E sentinel is missing");
}

function seedVault(vault: string): void {
  fs.mkdirSync(path.join(vault, "references"), { recursive: true });
  fs.mkdirSync(path.join(vault, "meta", "sources"), { recursive: true });
  fs.mkdirSync(path.join(vault, "lists", "now"), { recursive: true });
  fs.writeFileSync(path.join(vault, "lists", "now", "2026-07-06.md"), "# Week\n\n- [ ] Verify live Library intake\n", "utf-8");
  for (let index = 0; index < 36; index += 1) {
    const uid = `baseline-${String(index).padStart(2, "0")}`;
    const title = `Baseline library reference ${String(index + 1).padStart(2, "0")}`;
    const capturedAt = `2026-06-${String(28 - Math.floor(index / 2)).padStart(2, "0")}T${String(index % 24).padStart(2, "0")}:00:00.000Z`;
    fs.writeFileSync(path.join(vault, "references", `${uid}.md`), stringifyMarkdown({
      type: "reference",
      artifact_uid: uid,
      title,
      description: "A stable baseline item used to verify virtualized feed anchoring.",
      url: `https://example.com/${uid}`,
      format: "article",
      captured: capturedAt.slice(0, 10),
      captured_at: capturedAt,
      channel: "manual",
      source_id: "manual",
      source_name: "Baseline",
      library_mode: "study",
      tags: ["baseline"],
      digestion_status: "hot",
      digested_with: "source-metadata",
      digested_at: capturedAt,
      extracted_chars: 1200,
    }, `# ${title}\n\n## Summary\n\nA stable baseline item for deep-scroll verification.\n\n## Raw Content\n\nBaseline source content.`), "utf-8");
  }
}

function writeFixtures(vault: string, fixtures: FixtureSave[]): void {
  const lines = [
    "id: openai-external-saves",
    "name: OpenAI external saves",
    "channel: fixture",
    "url: fixture://openai-external-saves",
    "enabled: true",
    "cadence: hourly",
    "intent: explicit_save",
    "signal: external_save_fixture",
    "library_mode: study",
    "retention:",
    "  mode: durable",
    "  candidate_ttl_days: 30",
    "  auto_promote_threshold: 0.85",
    "metadata:",
    "  incremental_mode: window",
    "fixtures:",
  ];
  if (!fixtures.length) lines.push("  []");
  for (const fixture of fixtures) {
    lines.push(`  - url: ${JSON.stringify(fixture.url)}`);
    lines.push(`    title: ${JSON.stringify(fixture.title)}`);
    lines.push(`    author: ${JSON.stringify("OpenAI")}`);
    lines.push(`    date: ${JSON.stringify(new Date().toISOString())}`);
    lines.push(`    thumbnail: ${JSON.stringify("/icon-512.png")}`);
    if (fixture.content) {
      lines.push("    content: |-");
      for (const line of fixture.content.split("\n")) lines.push(`      ${line}`);
    }
    lines.push("    metadata:");
    lines.push("      format: article");
  }
  fs.writeFileSync(path.join(vault, "meta", "sources", "openai-external-saves.yaml"), `${lines.join("\n")}\n`, "utf-8");
}

function writeFallbackReference(vault: string): void {
  const now = new Date().toISOString();
  fs.writeFileSync(path.join(vault, "references", "websocket-fallback.md"), stringifyMarkdown({
    type: "reference",
    artifact_uid: "websocket-fallback",
    title: FALLBACK_TITLE,
    description: "A ready item written while WebSocket delivery is unavailable.",
    url: "https://openai.com/index/websocket-fallback-fixture/",
    format: "article",
    captured: now.slice(0, 10),
    captured_at: now,
    channel: "manual",
    source_id: "manual",
    source_name: "Fallback fixture",
    library_mode: "study",
    digestion_status: "hot",
    digested_with: "source-metadata",
    digested_at: now,
    extracted_chars: 900,
  }, `# ${FALLBACK_TITLE}\n\n## Summary\n\nFallback polling discovered this item without a WebSocket event.`), "utf-8");
}

async function liveOpenAISmoke(baseUrl: string, vault: string, fixtures: FixtureSave[]): Promise<{ ok: true; title: string } | { ok: false; error: string }> {
  if (process.env.LIVE_SMOKE === "0") return { ok: false, error: "disabled by LIVE_SMOKE=0" };
  const url = "https://openai.com/index/introducing-the-responses-api/";
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    const html = await response.text();
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/&nbsp;|&amp;|&#39;|&quot;/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 8_000);
    if (text.length < 500) return { ok: false, error: `only ${text.length} readable characters` };
    const title = "OpenAI live smoke: Responses API";
    fixtures.push({ url, title, content: text });
    writeFixtures(vault, fixtures);
    const report = await forceIntake(baseUrl);
    if (!report.queued) return { ok: false, error: "live source was not queued" };
    return { ok: true, title };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function cardFor(page: Page, title: string) {
  return page.locator("article[data-library-artifact-id]").filter({ hasText: title }).first();
}

async function forceIntake(baseUrl: string): Promise<{ queued: number }> {
  const response = await fetch(`${baseUrl}/api/sources/intake`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ force: true, explicitOnly: true, limit: 50 }),
  });
  const body = await response.json() as { queued?: number; errors?: string[] };
  assert.ok(response.ok, `forced intake failed: ${response.status} ${JSON.stringify(body)}`);
  return { queued: body.queued || 0 };
}

async function navigationEntries(page: Page): Promise<number> {
  return page.evaluate(() => performance.getEntriesByType("navigation").length);
}

async function visibleAnchor(page: Page): Promise<{ id: string; top: number } | null> {
  return page.evaluate(() => {
    const feed = document.querySelector<HTMLElement>('[data-testid="library-feed-list"]');
    if (!feed) return null;
    const feedTop = feed.getBoundingClientRect().top;
    for (const card of Array.from(feed.querySelectorAll<HTMLElement>("article[data-library-artifact-id]"))) {
      const rect = card.getBoundingClientRect();
      if (rect.bottom > feedTop + 8 && rect.top < feed.getBoundingClientRect().bottom) {
        return { id: card.dataset.libraryArtifactId || "", top: rect.top - feedTop };
      }
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

async function assertNoMobileOverlap(page: Page, status: ReturnType<Page["locator"]>): Promise<void> {
  const statusBox = await status.boundingBox();
  const navBox = await page.locator("[data-mobile-chrome-bottom] nav").boundingBox();
  assert.ok(statusBox && navBox, "mobile processing row and navigation are measurable");
  assert.ok(statusBox.y + statusBox.height <= navBox.y || statusBox.y >= navBox.y + navBox.height, "mobile processing row does not overlap navigation");
  const toolbarButton = await page.getByTestId("library-check-sources-toolbar").boundingBox();
  assert.ok(toolbarButton && toolbarButton.x >= 0 && toolbarButton.x + toolbarButton.width <= 393, "mobile refresh control stays within viewport");
}

function spawnLogged(command: string, args: string[], env: NodeJS.ProcessEnv): RunningProcess {
  const child = spawn(command, args, { cwd: REPO, env, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-30_000); });
  child.stderr?.on("data", (chunk: Buffer) => { output = `${output}${chunk.toString("utf-8")}`.slice(-30_000); });
  return { child, logs: () => output };
}

async function stopProcess(process: RunningProcess, signal: NodeJS.Signals): Promise<void> {
  if (process.child.exitCode !== null) return;
  process.child.kill(signal);
  await Promise.race([
    new Promise<void>((resolve) => process.child.once("exit", () => resolve())),
    sleep(5_000).then(() => { if (process.child.exitCode === null) process.child.kill("SIGKILL"); }),
  ]);
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, HOST, () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not allocate a port"));
      server.close(() => resolve(address.port));
    });
    server.on("error", reject);
  });
}

async function waitFor(check: () => boolean, timeoutMs: number, label: string, process?: RunningProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process?.child.exitCode !== null) throw new Error(`${label} process exited early.\n${process?.logs()}`);
    if (check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}.\n${process?.logs() || ""}`);
}

async function waitForHttp(url: string, timeoutMs: number, process: RunningProcess): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (process.child.exitCode !== null) throw new Error(`App server exited early.\n${process.logs()}`);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return;
    } catch {
      // Continue while Next compiles.
    }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for app server.\n${process.logs()}`);
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
    return {
      path: path.relative(root, filePath).split(path.sep).join("/"),
      size: content.length,
      hash: crypto.createHash("sha256").update(content).digest("hex"),
    };
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("[library-live-e2e] FAIL", error);
  process.exitCode = 1;
});
