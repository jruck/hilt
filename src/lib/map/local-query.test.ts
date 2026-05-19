import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { graphQuerySchema, graphResponseSchema, sessionDetailQuerySchema, sessionsQuerySchema, sessionsResponseSchema } from "./local-contracts";
import { closeMapDbForTests, getMapDb, upsertMapOverride, upsertMapSessions } from "./local-index-db";
import { readLocalSessionDetail } from "./local-session-detail";
import type { LocalSession } from "./local-types";
import { buildIndexedWorkGraph, queryIndexedSessionPage } from "./local-query";

function sampleSession(id: string, overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    id,
    provider: "codex",
    harness: "cli",
    externalId: id,
    externalKey: id,
    title: `Session ${id}`,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    workspaceLabel: "project",
    spaceLabel: "tmp",
    role: "peer",
    observedState: "idle",
    trackingState: "foreground",
    lastSeenAt: Date.now(),
    lastActivityAt: Date.now(),
    eventCount: 3,
    activity: { heat24h: 2, heat7d: 2, heat30d: 2, heatAll: 2 },
    signals: [],
    ignoreReasons: [],
    ...overrides,
  };
}

async function withTempMapDb(run: (dbPath: string) => void | Promise<void>) {
  const previousPath = process.env.HILT_MAP_DB_PATH;
  const dir = mkdtempSync(join(tmpdir(), "hilt-map-test-"));
  process.env.HILT_MAP_DB_PATH = join(dir, "map.sqlite");
  closeMapDbForTests();
  try {
    await run(process.env.HILT_MAP_DB_PATH);
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

test("indexed graph filters by status, source, and activity window", async () => {
  await withTempMapDb(() => {
    upsertMapSessions(getMapDb(), [
      sampleSession("recent-codex", { provider: "codex", trackingState: "foreground" }),
      sampleSession("recent-claude", { provider: "claude", harness: "project-jsonl", trackingState: "background" }),
      sampleSession("old-background", {
        provider: "claude",
        harness: "project-jsonl",
        trackingState: "background",
        observedState: "archived",
        activity: { heat24h: 0, heat7d: 0, heat30d: 0, heatAll: 0.5 },
      }),
    ]);

    const codexForeground = buildIndexedWorkGraph(graphQuerySchema.parse({
      window: "24h",
      status: "foreground",
      source: "codex",
    }));

    assert.equal(codexForeground.summary.totalSessions, 1);
    assert.equal(codexForeground.sourceCounts.codex, 1);
    assert.equal(codexForeground.statusCounts.foreground, 1);

    const backgroundAllTime = buildIndexedWorkGraph(graphQuerySchema.parse({
      window: "all",
      status: "background",
      source: "all",
    }));

    assert.equal(backgroundAllTime.summary.totalSessions, 2);
    assert.equal(backgroundAllTime.summary.backgroundSessions, 2);
  });
});

test("graph response omits full sessions and strips node session ids", async () => {
  await withTempMapDb(() => {
    upsertMapSessions(getMapDb(), [sampleSession("visible", { sourcePath: "/private/source.jsonl" })]);

    const graph = graphResponseSchema.parse(buildIndexedWorkGraph(graphQuerySchema.parse({
      window: "7d",
      status: "all",
      source: "all",
    })));
    const serialized = JSON.stringify(graph);

    assert.equal("sessions" in graph, false);
    assert.equal(serialized.includes("/private/source.jsonl"), false);
    assert.deepEqual(graph.root.sessionIds, []);
    assert.deepEqual(graph.root.children[0].sessionIds, []);
  });
});

test("overrides take precedence for tracking and workspace grouping", async () => {
  await withTempMapDb(() => {
    upsertMapSessions(getMapDb(), [
      sampleSession("needs-override", {
        trackingState: "background",
        workspaceRoot: undefined,
        workspaceLabel: undefined,
        spaceLabel: undefined,
      }),
    ]);
    upsertMapOverride(getMapDb(), {
      externalKey: "needs-override",
      trackingState: "foreground",
      workspaceRoot: "/work/quality/magnet",
      workspaceLabel: "magnet",
      spaceLabel: "work/quality",
    });

    const graph = buildIndexedWorkGraph(graphQuerySchema.parse({
      window: "7d",
      status: "foreground",
      source: "all",
    }));

    assert.equal(graph.summary.totalSessions, 1);
    assert.equal(graph.root.children[0].title, "work/quality");
    assert.equal(graph.root.children[0].children[0].title, "magnet");
  });
});

test("session pages paginate and do not expose source paths", async () => {
  await withTempMapDb(() => {
    upsertMapSessions(getMapDb(), Array.from({ length: 5 }, (_, index) => sampleSession(`page-${index}`, {
      sourcePath: `/private/page-${index}.jsonl`,
      activity: { heat24h: 5 - index, heat7d: 5 - index, heat30d: 5 - index, heatAll: 5 - index },
    })));

    const first = sessionsResponseSchema.parse(queryIndexedSessionPage(sessionsQuerySchema.parse({
      window: "7d",
      status: "all",
      source: "all",
      limit: 2,
    })));
    const second = queryIndexedSessionPage(sessionsQuerySchema.parse({
      window: "7d",
      status: "all",
      source: "all",
      limit: 2,
      cursor: first.nextCursor,
    }));

    assert.equal(first.items.length, 2);
    assert.equal(first.total, 5);
    assert.equal(first.nextCursor, "2");
    assert.equal(second.items[0].id, "page-2");
    assert.equal(JSON.stringify(first).includes("/private/"), false);
  });
});

test("session search can find copied map ids and provider ids", async () => {
  await withTempMapDb(() => {
    upsertMapSessions(getMapDb(), [
      sampleSession("codex:copied-session-id", {
        externalId: "provider-session-id",
        externalKey: "codex:cli:provider-session-id",
        title: "Referenceable session",
      }),
      sampleSession("codex:other-session", {
        externalId: "other-provider-id",
        externalKey: "codex:cli:other-provider-id",
        title: "Other session",
      }),
    ]);

    const byMapId = queryIndexedSessionPage(sessionsQuerySchema.parse({
      window: "7d",
      status: "all",
      source: "all",
      q: "copied-session-id",
    }));
    const byProviderId = queryIndexedSessionPage(sessionsQuerySchema.parse({
      window: "7d",
      status: "all",
      source: "all",
      q: "provider-session-id",
    }));

    assert.equal(byMapId.total, 1);
    assert.equal(byMapId.items[0].id, "codex:copied-session-id");
    assert.equal(byProviderId.total, 1);
    assert.equal(byProviderId.items[0].externalId, "provider-session-id");
  });
});

test("session detail rejects arbitrary path parameters through the contract", () => {
  assert.equal(sessionDetailQuerySchema.safeParse({ id: "abc", sourcePath: "/tmp/source.jsonl" }).success, false);
  assert.equal(sessionDetailQuerySchema.safeParse({ limit: 100 }).success, false);
});

test("history preview is capped, redacted, and pathless", async () => {
  await withTempMapDb(async (dbPath) => {
    const historyPath = join(dbPath, "..", "history.jsonl");
    const rows = Array.from({ length: 80 }, (_, index) => JSON.stringify({
      type: "assistant",
      timestamp: new Date(Date.UTC(2026, 4, 19, 1, index % 60)).toISOString(),
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "private chain of thought" },
          { type: "text", text: `Visible answer ${index}` },
        ],
      },
    }));
    writeFileSync(historyPath, `${rows.join("\n")}\n`);

    upsertMapSessions(getMapDb(), [
      sampleSession("history-session", {
        provider: "claude",
        harness: "project-jsonl",
        sourcePath: historyPath,
      }),
    ]);

    const detail = await readLocalSessionDetail("history-session", 20);

    assert.ok(detail);
    assert.equal(detail.sourcePath, undefined);
    assert.equal(detail.session.sourcePath, undefined);
    assert.equal(detail.stats.entriesReturned, 20);
    assert.ok(detail.stats.omittedEntries > 0);
    assert.equal(JSON.stringify(detail.entries).includes("private chain of thought"), false);
  });
});
