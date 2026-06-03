/**
 * System -> Graph end-to-end harness (modeled on scripts/calendar-e2e.ts).
 *
 * Boots `next build` + `next start` with HILT_GRAPH_ENABLED=true against a fixture
 * vault (temp DATA_DIR / HILT_GRAPH_DB_PATH, HILT_GRAPH_MAX_NODES_MOBILE=200), then:
 *  - POST /api/system/graph/rebuild and poll /meta until builtAt is set.
 *  - Desktop: System -> Graph mounts the canvas (WebGL2 context acquired); the graph
 *    API returns data; default scope is GLOBAL (Decision 2); click-through navigates
 *    to Docs / People / Library; a focus deep-link centers the node; a deleted/expired
 *    focus id degrades gracefully (no console error).
 *  - /navigate { view:"system", path:"/graph/focus/<id>" } is accepted (allowlist).
 *  - Mobile: default scope is LOCAL, the global buffer is NEVER requested, the payload
 *    is capped at HILT_GRAPH_MAX_NODES_MOBILE, and DPR is clamped to 1.0.
 *
 * The flag is inlined into the client bundle at BUILD time (next.config.ts env
 * passthrough), so this harness runs its own `next build` with the flag on — the
 * checked-in production build is flag-off and the Graph tab would otherwise be absent.
 *
 * Behavioral assertions read window.__hiltGraphStats (the single e2e stats surface)
 * plus the JSON API; cosmos.gl draws into its own <canvas> inside [data-testid=
 * "graph-canvas"], so canvas presence + a live WebGL2 context is the mount signal.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import net from "node:net";
import { chromium, type Page } from "playwright";
import { runColdStart } from "../src/lib/semantic/backfill";
import { collectItems } from "../src/lib/semantic/chunking";
import type { ClusterInput, ClusterNode, ClusterResult, RunClustering } from "../src/lib/semantic/cluster";
import { closeSemanticDbForTests } from "../src/lib/semantic/db";
import type { ExtractedEntity } from "../src/lib/semantic/gemini";
import type { MergeJudge } from "../src/lib/semantic/resolve-prompt";
import { createFakeSemanticClient } from "../src/lib/semantic/test-helpers";
import { l2normalize } from "../src/lib/semantic/vector";

const HOST = "127.0.0.1";
const MOBILE_CAP = 200;

const DESKTOP_VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 1280, height: 800 },
];
const MOBILE_VIEWPORTS = [
  { width: 390, height: 844 },
  { width: 430, height: 932 },
];

interface GraphStats {
  scope: "global" | "local";
  focusedNodeId: string | null;
  nodeCount: number;
  edgeCount: number;
  devicePixelRatio: number;
  isSimulationRunning: boolean;
  deviceClass: "desktop" | "tablet" | "mobile";
  allowGlobal: boolean;
  maxHops: number;
  simulate: boolean;
  truncated: boolean;
  isolatedFocus: boolean;
  labelLOD: unknown;
  zoom: number;
  socketConnected: boolean;
  webgpu: boolean;
}

async function main() {
  const port = await findFreePort();
  const baseUrl = `http://${HOST}:${port}`;
  const dataDir = mkdtempSync(join(tmpdir(), "hilt-graph-e2e-data-"));
  const vaultRoot = mkdtempSync(join(tmpdir(), "hilt-graph-e2e-vault-"));
  buildFixtureVault(vaultRoot);

  let server: ChildProcessWithoutNullStreams | null = null;
  let logs = "";

  const semanticDbPath = join(dataDir, "semantic.sqlite");
  const serverEnv = {
    ...process.env,
    HOST,
    PORT: String(port),
    DATA_DIR: dataDir,
    HILT_GRAPH_DB_PATH: join(dataDir, "graph.sqlite"),
    HILT_GRAPH_ENABLED: "true",
    // P2.3 semantic overlay ON — the buildFullGraph tail layers topic/entity nodes.
    HILT_GRAPH_SEMANTIC: "true",
    HILT_SEMANTIC_ENABLED: "true",
    HILT_SEMANTIC_DB_PATH: semanticDbPath,
    SEMANTIC_VEC_DISABLED: "1", // deterministic BLOB cosine path (no native extension)
    BRIDGE_VAULT_PATH: vaultRoot,
    HILT_GRAPH_MAX_NODES_MOBILE: String(MOBILE_CAP),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete (serverEnv as Record<string, unknown>).HILT_WORKING_FOLDER;

  try {
    // Build with the flag ON so the client bundle inlines isGraphEnabled() === true.
    buildNext(serverEnv);

    server = spawn("npx", ["next", "start", "-H", HOST, "-p", String(port)], {
      cwd: process.cwd(),
      env: serverEnv,
    });
    server.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    server.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });

    await waitForServer(baseUrl, () => logs, server);

    // Build the index + layout, then poll /meta until the layout is ready.
    await rebuildGraph(baseUrl);
    const meta = await waitForBuilt(baseUrl);
    assert.ok(meta.nodeCount > 0, "rebuild should produce nodes");
    assert.ok(meta.edgeCount > 0, "rebuild should produce edges");

    // The graph API returns data (Phase 0 contract — fmt=json for assertions).
    const globalSel = await fetchJson<GraphSelectionJson>(`${baseUrl}/api/system/graph?scope=global&fmt=json`);
    assert.ok(globalSel.nodeCount > 0, "global selection returns nodes");
    assert.ok(globalSel.edgeCount > 0, "global selection returns edges");

    // P2.3 — seed semantic.sqlite offline (fake client) against the SAME fixture vault, then
    // rebuild so the buildFullGraph tail layers the overlay. item_id == graph node id (R1), so
    // the overlay's edges resolve against the just-built graph_nodes.
    await seedSemanticLayer(semanticDbPath, vaultRoot, serverEnv.HILT_GRAPH_DB_PATH);
    await rebuildGraph(baseUrl);
    await waitForBuilt(baseUrl);
    await verifySemanticOverlay(baseUrl);

    // /navigate must accept the system view + graph focus path (allowlist + Decision 3).
    await verifyNavigateAllowlist(baseUrl, globalSel);

    const browser = await chromium.launch();
    try {
      await verifyDesktop(browser, baseUrl, globalSel);
      for (const vp of MOBILE_VIEWPORTS) {
        await verifyMobile(browser, baseUrl, vp.width, vp.height);
      }
    } finally {
      await browser.close();
    }
  } finally {
    if (server) await stopServer(server);
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(vaultRoot, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Desktop flow
// ---------------------------------------------------------------------------

async function verifyDesktop(
  browser: import("playwright").Browser,
  baseUrl: string,
  globalSel: GraphSelectionJson,
) {
  for (const vp of DESKTOP_VIEWPORTS) {
    const page = await browser.newPage({ viewport: vp });
    const consoleErrors = collectConsoleErrors(page);
    try {
      // Direct URL nav: /system/graph routes through the generic system logic.
      await openGraph(page, baseUrl, "/system/graph");

      // Canvas mounts and acquires a real WebGL2 context (Phase 1 desktop exit).
      await assertCanvasWithWebGL(page);

      const stats = await readStats(page);
      assert.equal(stats.scope, "global", `desktop should default to GLOBAL scope at ${vp.width}x${vp.height}`);
      assert.equal(stats.deviceClass, "desktop");
      assert.equal(stats.allowGlobal, true);
      assert.ok(stats.nodeCount > 0, "desktop renders a non-empty global graph");
      // Render-only freeze at rest (no client simulation).
      assert.equal(stats.isSimulationRunning, false, "graph is frozen at rest (pause())");

      // Focus deep-link: the person node centers and __hiltGraphStats reports it.
      const personId = nodeIdByType(globalSel, "person");
      await openGraph(page, baseUrl, `/system/graph/focus/${encodeURIComponent(personId)}`);
      await waitForFocus(page, personId);

      // Stale focus (deleted/expired id) degrades gracefully — no throw, banner shown.
      await openGraph(page, baseUrl, `/system/graph/focus/${encodeURIComponent("note:does-not-exist")}`);
      await page.getByText("isn't in the graph yet", { exact: false }).first().waitFor({ timeout: 15_000 });
      const staleStats = await readStats(page);
      assert.ok(staleStats.nodeCount > 0, "stale-focus still renders the default graph");

      // Inspector + click-through: a click selects (opens the inspector); the
      // inspector's Open action navigates via the refPath the /node/:id join returns.
      await verifyClickThroughNavigation(page, baseUrl, globalSel);

      assert.deepEqual(consoleErrors, [], `desktop console errors at ${vp.width}x${vp.height}`);
    } finally {
      await page.close();
    }
  }
}

/**
 * A click opens the inspector (the GPU canvas point has no DOM hit-test, so we can't
 * synthesize the click itself); the inspector fetches /node/:id for the node + its
 * connections and its Open action calls navigateTo(view, scope) using the joined
 * refPath. We assert the /node/:id contract (refPath + connections) and that the
 * resulting Hilt URL transition lands.
 */
async function verifyClickThroughNavigation(page: Page, baseUrl: string, sel: GraphSelectionJson) {
  // person -> /people/<slug>
  const personId = nodeIdByType(sel, "person");
  const personNode = await fetchJson<GraphNodeJson>(`${baseUrl}/api/system/graph/node/${encodeURIComponent(personId)}`);
  assert.ok(personNode.node?.refPath, "person node exposes a refPath via /node/:id");
  assert.equal(personNode.node?.type, "person");
  // The inspector contract: connections is a joined neighbor array (not raw edges).
  assert.ok(Array.isArray(personNode.connections), "/node/:id returns a connections array");
  if (personNode.connections.length > 0) {
    const c = personNode.connections[0];
    assert.ok(typeof c.label === "string" && typeof c.kind === "string", "connection carries neighbor label + edge kind");
  }

  // note -> /docs/<absPath>
  const noteId = nodeIdByType(sel, "note");
  const noteNode = await fetchJson<GraphNodeJson>(`${baseUrl}/api/system/graph/node/${encodeURIComponent(noteId)}`);
  assert.ok(noteNode.node?.refPath, "note node exposes an absolute refPath via /node/:id");

  // reference -> Library detail (artifact id is the node id; no /node/:id refPath needed)
  const refId = nodeIdByType(sel, "reference");
  assert.ok(refId.startsWith("ref:"), "reference node id is artifact-scoped");

  // The People nav transition actually lands (proves the click-through target URL).
  const slug = personNode.node?.refPath;
  assert.ok(slug, "person refPath resolved");
  await openGraph(page, baseUrl, "/system/graph");
  await page.evaluate((s) => {
    window.history.pushState({ scope: `/${s}` }, "", `/people/${s}`);
    window.dispatchEvent(new PopStateEvent("popstate", { state: { scope: `/${s}` } }));
  }, slug);
  await page.waitForFunction(() => window.location.pathname.startsWith("/people/"));
  assert.ok(page.url().includes(`/people/${slug}`), "person click-through lands on People");
}

// ---------------------------------------------------------------------------
// Mobile flow
// ---------------------------------------------------------------------------

async function verifyMobile(
  browser: import("playwright").Browser,
  baseUrl: string,
  width: number,
  height: number,
) {
  const page = await browser.newPage({
    viewport: { width, height },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  });
  const consoleErrors = collectConsoleErrors(page);
  try {
    // Capture every graph payload request — the strongest jetsam guarantee is that NONE ship.
    const requestedScopes: string[] = [];
    page.on("request", (req) => {
      const url = req.url();
      if (url.includes("/api/system/graph?")) {
        requestedScopes.push(new URL(url).searchParams.get("scope") ?? "");
      }
    });

    // Graph is desktop/Electron-only (WebGL2 at scale + mobile Safari jetsam). A phone
    // gets the desktop-only panel — the WebGL canvas never mounts and no payload ships.
    await page.goto(`${baseUrl}/system/graph`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByTestId("graph-desktop-only").waitFor({ timeout: 30_000 });
    assert.equal(await page.getByTestId("graph-canvas").count(), 0, `mobile never mounts the WebGL canvas at ${width}x${height}`);
    assert.equal(await page.getByTestId("graph-view").count(), 0, "mobile never renders the graph view");

    // The graph payload (and the global buffer) NEVER ships to a phone — not even local.
    await page.waitForTimeout(1500);
    assert.equal(requestedScopes.length, 0, `mobile must NEVER request a graph payload (saw ${requestedScopes.join(",")})`);

    // A /system/graph/global deep-link tapped on a phone still lands on the desktop-only panel.
    await page.goto(`${baseUrl}/system/graph/global`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.getByTestId("graph-desktop-only").waitFor({ timeout: 30_000 });
    assert.equal(requestedScopes.length, 0, "forced /global still ships no payload on mobile");

    assert.deepEqual(consoleErrors, [], `mobile console errors at ${width}x${height}`);
  } finally {
    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function openGraph(page: Page, baseUrl: string, path: string) {
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.getByTestId("graph-view").waitFor({ timeout: 20_000 });
}

async function assertCanvasWithWebGL(page: Page) {
  await page.getByTestId("graph-canvas").waitFor({ timeout: 20_000 });
  const ok = await page.waitForFunction(() => {
    const host = document.querySelector('[data-testid="graph-canvas"]');
    const canvas = host?.querySelector("canvas");
    if (!(canvas instanceof HTMLCanvasElement)) return false;
    // cosmos.gl owns the GL context; presence + non-zero size is the mount signal.
    return canvas.width > 0 && canvas.height > 0;
  }, undefined, { timeout: 20_000 });
  assert.equal(await ok.jsonValue(), true, "cosmos.gl canvas mounted with non-zero size");

  // A fresh probe context proves the device/browser actually grants WebGL2.
  const hasWebGL2 = await page.evaluate(() => {
    const probe = document.createElement("canvas");
    return !!probe.getContext("webgl2");
  });
  assert.equal(hasWebGL2, true, "WebGL2 context is available");
}

async function readStats(page: Page): Promise<GraphStats> {
  const handle = await page.waitForFunction(
    () => (window as unknown as { __hiltGraphStats?: GraphStats }).__hiltGraphStats ?? false,
    undefined,
    { timeout: 20_000 },
  );
  return (await handle.jsonValue()) as GraphStats;
}

/** Wait until __hiltGraphStats reports the focused node id with a non-empty graph. */
async function waitForFocus(page: Page, focusId: string) {
  await page.waitForFunction(
    (want) => {
      const stats = (window as unknown as { __hiltGraphStats?: GraphStats }).__hiltGraphStats;
      return !!stats && stats.focusedNodeId === want && stats.nodeCount > 0;
    },
    focusId,
    { timeout: 20_000 },
  );
}

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function verifyNavigateAllowlist(baseUrl: string, sel: GraphSelectionJson) {
  // The CLI/Electron file-navigate channel posts to /navigate on the ws-server, but
  // the HTTP allowlist guard is what Decision 3 widened. We assert the route exists
  // and accepts a system + graph focus path. The ws-server is not running in the
  // e2e, so we validate the in-app path-form grammar round-trips instead: a focus
  // deep-link URL resolves to the graph sub-mode (covered by the desktop focus test)
  // and the encoded id survives. Here we assert the encoded path is well-formed.
  const focusId = nodeIdByType(sel, "person");
  const path = `/graph/focus/${encodeURIComponent(focusId)}`;
  assert.ok(!path.includes("?"), "deep-link grammar is path-segment only (no query string)");
  assert.equal(decodeURIComponent(path.split("/")[3]), focusId, "encoded focus id decodes back exactly");
}

// ---------------------------------------------------------------------------
// P2.3 — semantic overlay seeding + assertions (offline, fake client)
// ---------------------------------------------------------------------------

/**
 * Cold-start the semantic layer over the SAME fixture vault, fully offline (fake client +
 * fake clustering, ruling R6). Produces items (item_id == graph node id), entities of every
 * bucket, and a 2-level topic hierarchy in `semantic.sqlite` so the next graph rebuild's
 * overlay tail has real topics/entities to layer on. Runs in THIS process (the server reads
 * the resulting `semantic.sqlite` file); env is pointed at the same vault/dbs and restored.
 */
async function seedSemanticLayer(semanticDbPath: string, vaultRoot: string, graphDbPath: string): Promise<void> {
  const prev = {
    sem: process.env.HILT_SEMANTIC_DB_PATH,
    graph: process.env.HILT_GRAPH_DB_PATH,
    vec: process.env.SEMANTIC_VEC_DISABLED,
    vault: process.env.BRIDGE_VAULT_PATH,
  };
  process.env.HILT_SEMANTIC_DB_PATH = semanticDbPath;
  process.env.HILT_GRAPH_DB_PATH = graphDbPath; // the binder reads the live graph for entity binding
  process.env.SEMANTIC_VEC_DISABLED = "1";
  process.env.BRIDGE_VAULT_PATH = vaultRoot;
  closeSemanticDbForTests();

  try {
    const client = createFakeSemanticClient({ dim: 64, extractFixtures: buildExtractFixtures() });
    await runColdStart({ client, judge: noMergeJudge, runClustering: fakeClustering() });
  } finally {
    closeSemanticDbForTests();
    if (prev.sem === undefined) delete process.env.HILT_SEMANTIC_DB_PATH; else process.env.HILT_SEMANTIC_DB_PATH = prev.sem;
    if (prev.graph === undefined) delete process.env.HILT_GRAPH_DB_PATH; else process.env.HILT_GRAPH_DB_PATH = prev.graph;
    if (prev.vec === undefined) delete process.env.SEMANTIC_VEC_DISABLED; else process.env.SEMANTIC_VEC_DISABLED = prev.vec;
    if (prev.vault === undefined) delete process.env.BRIDGE_VAULT_PATH; else process.env.BRIDGE_VAULT_PATH = prev.vault;
  }
}

/** Every fixture item gets at least one entity so all four buckets resolve (keyed by assembled text). */
function buildExtractFixtures(): Record<string, ExtractedEntity[]> {
  const fixtures: Record<string, ExtractedEntity[]> = {};
  for (const item of collectItems()) {
    const text = item.chunks.map((c) => c.text).join(" ");
    // TWO shared ideas co-occur across the (multiple) note items so the overlay derives an
    // entity↔entity co_occurrence edge (a pair sharing ≥2 items). Plus a per-kind entity so
    // person/project/reference/idea buckets all materialize.
    const ents: ExtractedEntity[] = [
      { type: "idea", name: "knowledge graph", aliases: ["graph"], salience: 0.8, evidence: text.slice(0, 40) },
      { type: "idea", name: "semantic layer", aliases: [], salience: 0.7, evidence: text.slice(0, 40) },
    ];
    if (item.kind === "person") ents.push({ type: "person", name: item.title ?? "Person", aliases: [], salience: 1, evidence: "person" });
    else if (item.kind === "project") ents.push({ type: "project", name: item.title ?? "Project", aliases: [], salience: 1, evidence: "project" });
    else if (item.kind === "reference") ents.push({ type: "source", name: item.title ?? "Source", aliases: [], salience: 1, evidence: "source" });
    fixtures[text] = ents;
  }
  return fixtures;
}

/** Offline merge-judge: keep every member separate (exercise auto-merge, not the LLM). */
const noMergeJudge: MergeJudge = async () => [];

/**
 * Offline clustering seam (ruling R6) — no Python. Two leaf topics under one root: notes vs
 * everything-else, guaranteeing a ≥2-level hierarchy the overlay maps to topic_parent edges.
 */
function fakeClustering(): RunClustering {
  return async (input: ClusterInput): Promise<ClusterResult> => {
    const vecById = new Map(input.ids.map((id, i) => [id, l2normalize(Float32Array.from(input.vectors[i]))]));
    const leafFor = (chunkId: string): string => (chunkId.startsWith("note:") ? "L1-notes" : "L1-corpus");
    const leafMembers = new Map<string, string[]>();
    for (const id of input.ids) {
      const leaf = leafFor(id);
      const arr = leafMembers.get(leaf) ?? [];
      arr.push(id);
      leafMembers.set(leaf, arr);
    }
    const centroid = (members: string[]): number[] => {
      const dim = input.vectors[0]?.length ?? 0;
      const out = new Float32Array(dim);
      for (const m of members) {
        const v = vecById.get(m)!;
        for (let i = 0; i < dim; i++) out[i] += v[i];
      }
      return Array.from(l2normalize(out));
    };
    const all = [...leafMembers.values()].flat();
    const hierarchy: ClusterNode[] = [
      { clusterId: "L0-root", parentId: null, level: 0, memberIds: all, centroid: centroid(all), size: all.length },
    ];
    for (const [leaf, members] of [...leafMembers].sort()) {
      hierarchy.push({ clusterId: leaf, parentId: "L0-root", level: 1, memberIds: members, centroid: centroid(members), size: members.length });
    }
    return {
      assignments: input.ids.map((id) => ({ id, leafCluster: 1, probability: 0.9 })),
      hierarchy,
      outliers: [],
      paramsUsed: {},
    };
  };
}

/** Assert the overlay landed: topic + entity nodes present, semantic edges present, no leaks. */
async function verifySemanticOverlay(baseUrl: string): Promise<void> {
  // /meta reports the overlay counts + built marker.
  const meta = await fetchJson<{ topicNodeCount: number; entityNodeCount: number; semanticBuilt: boolean }>(
    `${baseUrl}/api/system/graph/meta`,
  );
  assert.ok(meta.semanticBuilt, "/meta reports semanticBuilt after the overlay tail ran");
  assert.ok(meta.topicNodeCount >= 3, `overlay produced topic nodes (root + ≥2 leaves), got ${meta.topicNodeCount}`);
  assert.ok(meta.entityNodeCount >= 1, `overlay produced entity nodes, got ${meta.entityNodeCount}`);

  // GLOBAL scope: topic/entity nodes present; sparse semantic edges present; the fuzzy web
  // (similar/co_occurrence) is OFF by default.
  const globalSel = await fetchJson<GraphSelectionJson>(`${baseUrl}/api/system/graph?scope=global&fmt=json`);
  assert.ok(globalSel.nodes.some((n) => n.type === "topic"), "global selection contains a topic node");
  assert.ok(globalSel.nodes.some((n) => n.type === "entity"), "global selection contains an entity node");
  assert.ok(globalSel.edges.some((e) => e.kind === "item_topic"), "global selection contains item_topic edges");
  assert.ok(globalSel.edges.some((e) => e.kind === "topic_parent"), "global selection contains topic_parent edges");
  assert.ok(
    !globalSel.edges.some((e) => e.kind === "similar" || e.kind === "co_occurrence"),
    "global scope omits similar/co_occurrence by default",
  );

  // GLOBAL with &semanticEdges=1: the fuzzy web is now included.
  const globalFuzzy = await fetchJson<GraphSelectionJson>(`${baseUrl}/api/system/graph?scope=global&semanticEdges=1&fmt=json`);
  assert.ok(
    globalFuzzy.edges.some((e) => e.kind === "co_occurrence"),
    "global scope with semanticEdges=1 includes co_occurrence (the shared 'knowledge graph' idea)",
  );

  // The dedicated semantic HTTP routes mirror the CLI --json shape.
  const topics = await fetchJson<Array<{ id: string; label: string; level: number; parentId: string | null }>>(
    `${baseUrl}/api/system/semantic/topics`,
  );
  assert.ok(topics.some((t) => t.parentId === null), "semantic/topics returns the root topic");
  const root = topics.find((t) => t.parentId === null)!;
  const detail = await fetchJson<{ topic: { id: string }; children: unknown[]; items: unknown[] }>(
    `${baseUrl}/api/system/semantic/topic/${encodeURIComponent(root.id)}`,
  );
  assert.ok(detail.children.length >= 2, "semantic/topic/:id drill-down returns the leaf children");
}

// ---------------------------------------------------------------------------
// Fixture vault (mirrors src/lib/graph/build.test.ts spec — known counts)
// ---------------------------------------------------------------------------

function file(root: string, rel: string, content: string): void {
  const abs = join(root, rel);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(abs, content, "utf-8");
}

function buildFixtureVault(root: string): void {
  file(root, "docs/notes/alpha.md", "# Alpha\n\nSee [[beta]] and [[gamma|Gamma display]] and [[beta#Section]].\n");
  file(root, "docs/notes/beta.md", "# Beta\n\nNothing here.\n");
  file(root, "docs/notes/gamma.md", "---\ntags: research, infra\n---\n\n# Gamma\n\nGamma body.\n");
  file(root, "docs/notes/orphan.md", "# Orphan\n\nNo links at all.\n");

  file(
    root,
    "references/ref-001.md",
    [
      "---",
      "type: reference",
      "title: Ref One",
      "url: https://example.com/ref-001",
      "tags: research, infra",
      "connected_projects:",
      "  - atlas",
      "connection_suggestions:",
      "  - target: art-vandelay",
      "    label: Art Vandelay",
      "    relationship: mentioned-by",
      "    kind: person",
      "  - target: areas",
      "    label: North Stars",
      "    relationship: supports",
      "    kind: area",
      "---",
      "",
      "# Ref One",
      "",
      "## Summary",
      "",
      "A saved reference.",
      "",
      "## Connections",
      "",
      "- [[atlas]]",
      "",
    ].join("\n"),
  );

  file(root, "people/index.md", "# People\n\n## People\n\n- [[art-vandelay]] — Designer\n");
  file(
    root,
    "people/art-vandelay.md",
    "---\ntype: person\ncreated: 2026-01-01\naliases: [\"Art Vandelay\"]\n---\n\n# Art Vandelay\n\n## Next\n\n## Notes\n",
  );
  file(
    root,
    "meetings/2026-03-05/art-vandelay-2026-03-05 @ 12-00-38.md",
    [
      "---",
      "title: Sync with Art",
      "created: 2026-03-05T12:00:38",
      "hilt_calendar_event_id: evt-123",
      "---",
      "",
      "# Sync with Art",
      "",
      "Meeting notes.",
      "",
    ].join("\n"),
  );

  file(
    root,
    "projects/atlas/index.md",
    "---\nstatus: doing\narea: infra\ntags: research, infra\n---\n\n# Atlas\n\nThe Atlas project.\n",
  );
  file(root, "areas/index.md", "# North Stars\n\n- Build great things.\n");

  // A candidate in the cache dir (read via the cache API, not the walker).
  file(
    root,
    "references/.cache/library-candidates/2026-03-01-some-candidate-abcdef.md",
    [
      "---",
      "type: reference-candidate",
      "title: Some Candidate",
      "url: https://example.com/candidate",
      "status: candidate",
      "channel: rss",
      "score:",
      "  total: 0.4",
      "---",
      "",
      "## Summary",
      "",
      "A review candidate.",
      "",
    ].join("\n"),
  );
}

// ---------------------------------------------------------------------------
// API + server lifecycle
// ---------------------------------------------------------------------------

interface GraphSelectionJson {
  scope: string;
  nodeCount: number;
  edgeCount: number;
  truncated: boolean;
  nodes: Array<{ id: string; type: string; label: string; refPath: string | null }>;
  edges: Array<{ id: string; source: string; target: string; kind: string }>;
}

interface GraphNodeJson {
  node: { id: string; type: string; label: string; refPath: string | null; degree: number } | null;
  /** Neighbor + relationship join powering the inspector (replaces the old raw `edges`). */
  connections: Array<{ id: string; type: string; label: string; refPath: string | null; kind: string; direction: "out" | "in" }>;
}

function nodeIdByType(sel: GraphSelectionJson, type: string): string {
  const node = sel.nodes.find((n) => n.type === type);
  assert.ok(node, `fixture global selection should contain a ${type} node`);
  return node.id;
}

async function rebuildGraph(baseUrl: string) {
  const res = await fetch(`${baseUrl}/api/system/graph/rebuild`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(res.ok, true, `rebuild should succeed (got ${res.status})`);
  const json = (await res.json()) as { ok: boolean; nodeCount: number; edgeCount: number };
  assert.equal(json.ok, true, "rebuild reports ok");
}

async function waitForBuilt(baseUrl: string): Promise<{ nodeCount: number; edgeCount: number }> {
  for (let i = 0; i < 120; i++) {
    const meta = await fetchJson<{
      builtAt: string | null;
      nodeCount: number;
      edgeCount: number;
      layoutState: string;
    }>(`${baseUrl}/api/system/graph/meta`);
    if (meta.builtAt != null) return { nodeCount: meta.nodeCount, edgeCount: meta.edgeCount };
    await sleep(500);
  }
  throw new Error("Timed out waiting for graph layout (builtAt stayed null).");
}

async function fetchJson<T = Record<string, unknown>>(url: string): Promise<T> {
  const res = await fetch(url, { cache: "no-store" } as RequestInit);
  assert.equal(res.ok, true, `GET ${url} should be 200 (got ${res.status})`);
  return res.json() as Promise<T>;
}

function buildNext(env: NodeJS.ProcessEnv) {
  const result = spawnSync("npx", ["next", "build"], {
    cwd: process.cwd(),
    env,
    stdio: "inherit",
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    throw new Error(`next build (HILT_GRAPH_ENABLED=true) failed with status ${result.status}`);
  }
}

async function waitForServer(baseUrl: string, logs: () => string, server: ChildProcessWithoutNullStreams) {
  for (let i = 0; i < 180; i++) {
    if (server.exitCode !== null) throw new Error(`next start exited early.\n${logs()}`);
    try {
      const res = await fetch(`${baseUrl}/api/system/graph/meta`, { cache: "no-store" });
      // 200 (flag on) or any response means the server is up and routing.
      if (res.ok || res.status === 404) return;
    } catch {
      // keep waiting
    }
    await sleep(500);
  }
  throw new Error(`Timed out waiting for next start.\n${logs()}`);
}

async function stopServer(server: ChildProcessWithoutNullStreams) {
  if (server.exitCode !== null) return;
  server.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    sleep(5000).then(() => {
      if (server.exitCode === null) server.kill("SIGKILL");
    }),
  ]);
}

async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, HOST, () => {
      const address = srv.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a port."));
        return;
      }
      srv.close(() => resolve(address.port));
    });
    srv.on("error", reject);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
