import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { graphQuerySchema, graphResponseSchema, sessionsQuerySchema, sessionsResponseSchema } from "./local-contracts";
import { closeMapDbForTests, getMapDb, upsertMapSessions } from "./local-index-db";
import type { LocalSession } from "./local-types";
import { buildIndexedWorkGraph, queryIndexedSessionPage } from "./local-query";

const SESSION_COUNT = 50_000;
const WORKSPACE_COUNT = 1_000;

function syntheticSession(index: number): LocalSession {
  const workspaceIndex = index % WORKSPACE_COUNT;
  const provider = index % 3 === 0 ? "claude" : "codex";
  const trackingState = index % 13 === 0 || index % 19 === 0 ? "background" : "foreground";
  const heat = 1 + ((SESSION_COUNT - index) % 500) / 100;
  const lastActivityAt = Date.now() - (index % 7) * 60 * 60 * 1000;

  return {
    id: `${provider}:synthetic:${index}`,
    provider,
    harness: provider === "codex" ? "cli" : "project-jsonl",
    externalId: `synthetic-${index}`,
    externalKey: `${provider}:synthetic:${index}`,
    title: `Synthetic session ${index}`,
    cwd: `/work/space-${workspaceIndex % 20}/workspace-${workspaceIndex}/src`,
    workspaceRoot: `/work/space-${workspaceIndex % 20}/workspace-${workspaceIndex}`,
    workspaceLabel: `workspace-${workspaceIndex}`,
    spaceLabel: `space-${workspaceIndex % 20}`,
    gitBranch: index % 23 === 0 ? `feature-${index % 97}` : "main",
    role: "peer",
    observedState: index % 31 === 0 ? "active" : "idle",
    trackingState,
    sourcePath: `/private/source-${index}.jsonl`,
    createdAt: lastActivityAt - 60_000,
    lastSeenAt: lastActivityAt,
    lastActivityAt,
    eventCount: 5 + (index % 30),
    tokenEstimate: 1_000 + index,
    activity: {
      heat24h: heat,
      heat7d: heat,
      heat30d: heat,
      heatAll: heat,
    },
    signals: [],
    ignoreReasons: trackingState === "background" && index % 19 === 0 ? ["synthetic background"] : [],
  };
}

async function withPerfDb(run: () => void | Promise<void>) {
  const previousPath = process.env.HILT_MAP_DB_PATH;
  const dir = mkdtempSync(join(tmpdir(), "hilt-map-perf-"));
  process.env.HILT_MAP_DB_PATH = join(dir, "map.sqlite");
  closeMapDbForTests();
  try {
    await run();
  } finally {
    closeMapDbForTests();
    if (previousPath === undefined) {
      delete process.env.HILT_MAP_DB_PATH;
    } else {
      process.env.HILT_MAP_DB_PATH = previousPath;
    }
    rmSync(dir, { recursive: true, force: true });
  }
}

test("local map index meets 50k-session warm query targets", async () => {
  await withPerfDb(() => {
    const db = getMapDb();
    const sessions = Array.from({ length: SESSION_COUNT }, (_, index) => syntheticSession(index));
    upsertMapSessions(db, sessions);

    const graphQuery = graphQuerySchema.parse({ window: "7d", status: "all", source: "all" });
    buildIndexedWorkGraph(graphQuery);

    const graphStart = performance.now();
    const graph = graphResponseSchema.parse(buildIndexedWorkGraph(graphQuery));
    const graphMs = performance.now() - graphStart;
    const graphBytes = Buffer.byteLength(JSON.stringify(graph), "utf-8");

    const pageQuery = sessionsQuerySchema.parse({ window: "7d", status: "all", source: "all", limit: 80 });
    const pageStart = performance.now();
    const page = sessionsResponseSchema.parse(queryIndexedSessionPage(pageQuery));
    const pageMs = performance.now() - pageStart;
    const pageBytes = Buffer.byteLength(JSON.stringify(page), "utf-8");

    const changed = Array.from({ length: 100 }, (_, index) => ({
      ...syntheticSession(index),
      title: `Changed synthetic session ${index}`,
      lastSeenAt: Date.now(),
      lastActivityAt: Date.now(),
    }));
    const refreshStart = performance.now();
    upsertMapSessions(db, changed);
    const refreshMs = performance.now() - refreshStart;

    assert.equal(graph.summary.totalSessions, SESSION_COUNT);
    assert.equal(graph.summary.workspaceCount, WORKSPACE_COUNT);
    assert.equal(page.items.length, 80);
    assert.ok(graphMs < 500, `warm graph query took ${graphMs.toFixed(1)}ms`);
    assert.ok(pageMs < 250, `session page query took ${pageMs.toFixed(1)}ms`);
    assert.ok(graphBytes < 1_000_000, `graph payload was ${graphBytes} bytes`);
    assert.ok(pageBytes < 250_000, `session page payload was ${pageBytes} bytes`);
    assert.ok(refreshMs < 2_000, `100-session incremental write took ${refreshMs.toFixed(1)}ms`);
  });
});
