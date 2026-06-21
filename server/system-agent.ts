/**
 * Hilt System Agent — a lightweight, read-only Node HTTP runtime that lets an
 * observer machine (e.g. Hestia) appear in another machine's Hilt System views
 * without running the full Hilt stack (Next.js UI, ws-server, Bridge/Library
 * write routes, Granola/calendar daemons, graph/semantic runners).
 *
 * Design + scope: docs/plans/system-agent-mode.md.
 *
 * - Binds 127.0.0.1:${HILT_SYSTEM_AGENT_PORT:-3200}; exposed via Tailscale Serve
 *   (origin root -> 127.0.0.1:3200). It never listens on a tailnet interface.
 * - Serves ONLY the allowlisted local-snapshot routes below; every other path is
 *   a compact JSON 404. No HTML, no static assets, no peer fan-out, no daemons.
 * - Handlers are thin wrappers over the same `@/lib` functions the full Hilt
 *   routes call, so agent output is byte-identical to full Hilt local output
 *   (see scripts/system-agent-parity.ts).
 */
import http from "node:http";
import { fileURLToPath } from "node:url";
import fs from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { localSystemMachineResponse } from "@/lib/system/peers";
import { readLocalSystemSync, readLocalSystemSyncConflicts } from "@/lib/system/sync";
import { getLocalAppsResponse, refreshLocalApps } from "@/lib/local-apps/scanner";
import { isSafePreviewFilename } from "@/lib/local-apps/preview";
import { isLocalAppsEnabled, isPreviewCaptureEnabled, previewDir } from "@/lib/local-apps/settings";
import { readLocalSystemStack, readLocalSystemStackFile } from "@/lib/system/stack";
import { isLocalMapEnabled, isMapHistoryPreviewEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh, refreshMapIndex } from "@/lib/map/local-indexer";
import { buildIndexedWorkGraph, queryIndexedSessionPage } from "@/lib/map/local-query";
import { readLocalSessionDetail } from "@/lib/map/local-session-detail";
import {
  graphQuerySchema,
  graphResponseSchema,
  sessionsQuerySchema,
  sessionsResponseSchema,
  sessionDetailQuerySchema,
} from "@/lib/map/local-contracts";
import { defaultDataDir } from "./server-mode";

loadEnvConfig(process.cwd());

const MAP_FRESH_MS = 15_000;
const MAP_DISABLED = {
  disabled: true,
  error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
} as const;

type ServerResponse = http.ServerResponse;

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
  res.end(JSON.stringify(body));
}

async function handleStackFile(res: ServerResponse, url: URL): Promise<void> {
  const filePath = url.searchParams.get("path");
  const projectPath = url.searchParams.get("project");
  if (!filePath) {
    sendJson(res, 400, { error: "path parameter required" });
    return;
  }
  // readOnly = true -> stack file content is always returned with isEditable: false.
  const file = await readLocalSystemStackFile(filePath, projectPath, true);
  if (!file) {
    sendJson(res, 404, { error: "File is not part of the discovered stack" });
    return;
  }
  sendJson(res, 200, { file });
}

async function handlePreview(res: ServerResponse, filename: string): Promise<void> {
  if (!isSafePreviewFilename(filename)) {
    sendJson(res, 400, { error: "Invalid preview filename" });
    return;
  }
  if (!isLocalAppsEnabled() || !isPreviewCaptureEnabled()) {
    sendJson(res, 403, { error: "Local Apps previews are disabled" });
    return;
  }
  try {
    const bytes = await fs.readFile(path.join(previewDir(), filename));
    res.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "private, max-age=30" });
    res.end(bytes);
  } catch {
    sendJson(res, 404, { error: "Preview not found" });
  }
}

async function handleWorkGraph(res: ServerResponse, url: URL): Promise<void> {
  if (!isLocalMapEnabled()) {
    sendJson(res, 403, MAP_DISABLED);
    return;
  }
  const parsed = graphQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    sendJson(res, 400, { error: "Invalid query parameters", issues: parsed.error.issues });
    return;
  }
  await ensureMapIndexFresh(MAP_FRESH_MS);
  sendJson(res, 200, graphResponseSchema.parse(buildIndexedWorkGraph(parsed.data)));
}

async function handleSessions(res: ServerResponse, url: URL): Promise<void> {
  if (!isLocalMapEnabled()) {
    sendJson(res, 403, MAP_DISABLED);
    return;
  }
  const parsed = sessionsQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    sendJson(res, 400, { error: "Invalid query parameters", issues: parsed.error.issues });
    return;
  }
  await ensureMapIndexFresh(MAP_FRESH_MS);
  sendJson(res, 200, sessionsResponseSchema.parse(queryIndexedSessionPage(parsed.data)));
}

async function handleSessionDetail(res: ServerResponse, url: URL): Promise<void> {
  if (!isLocalMapEnabled()) {
    sendJson(res, 403, MAP_DISABLED);
    return;
  }
  if (!isMapHistoryPreviewEnabled()) {
    sendJson(res, 403, {
      disabled: true,
      error: "Hilt Map history preview is disabled. Set HILT_MAP_HISTORY_PREVIEW=true to enable it.",
    });
    return;
  }
  const parsed = sessionDetailQuerySchema.safeParse(Object.fromEntries(url.searchParams.entries()));
  if (!parsed.success) {
    sendJson(res, 400, { error: "Invalid query parameters", issues: parsed.error.issues });
    return;
  }
  await ensureMapIndexFresh(MAP_FRESH_MS);
  const detail = await readLocalSessionDetail(parsed.data.id, parsed.data.limit);
  if (!detail) {
    sendJson(res, 404, { error: "Session not found" });
    return;
  }
  sendJson(res, 200, detail);
}

async function handleMapRefresh(res: ServerResponse): Promise<void> {
  if (!isLocalMapEnabled()) {
    sendJson(res, 403, MAP_DISABLED);
    return;
  }
  sendJson(res, 200, { diagnostics: await refreshMapIndex() });
}

const PREVIEW_PREFIX = "/api/local-apps/previews/";

async function route(req: http.IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? "GET";
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const p = url.pathname;

  if (method === "GET") {
    if (p === "/api/system/machine") {
      sendJson(res, 200, await localSystemMachineResponse({ role: "agent", includeAppServer: false }));
      return;
    }
    if (p === "/api/system/sync") {
      sendJson(res, 200, await readLocalSystemSync({ force: url.searchParams.get("force") === "true" }));
      return;
    }
    if (p === "/api/system/sync/conflicts") {
      const folder = url.searchParams.get("folder") || "work-meta";
      sendJson(res, 200, await readLocalSystemSyncConflicts(folder, { force: url.searchParams.get("force") === "true" }));
      return;
    }
    if (p === "/api/local-apps") {
      sendJson(res, 200, await getLocalAppsResponse({ includePeers: false }));
      return;
    }
    if (p.startsWith(PREVIEW_PREFIX)) {
      await handlePreview(res, decodeURIComponent(p.slice(PREVIEW_PREFIX.length)));
      return;
    }
    if (p === "/api/system/stack") {
      sendJson(res, 200, await readLocalSystemStack(url.searchParams.get("project")));
      return;
    }
    if (p === "/api/system/stack/file") {
      await handleStackFile(res, url);
      return;
    }
    if (p === "/api/map/local/work-graph") {
      await handleWorkGraph(res, url);
      return;
    }
    if (p === "/api/map/local/sessions") {
      await handleSessions(res, url);
      return;
    }
    if (p === "/api/map/local/session-detail") {
      await handleSessionDetail(res, url);
      return;
    }
  }

  if (method === "POST") {
    if (p === "/api/local-apps/refresh") {
      const refreshPreviews = url.searchParams.get("previews") !== "false";
      sendJson(res, 200, await refreshLocalApps({
        includePeers: false,
        forcePreviews: refreshPreviews,
        waitForPreviews: refreshPreviews,
      }));
      return;
    }
    if (p === "/api/map/local/refresh") {
      await handleMapRefresh(res);
      return;
    }
  }

  sendJson(res, 404, { error: "Not found", path: p });
}

export function createSystemAgentServer(): http.Server {
  return http.createServer((req, res) => {
    route(req, res).catch((error) => {
      sendJson(res, 500, { error: error instanceof Error ? error.message : "Internal error" });
    });
  });
}

// ---- Standalone runtime (skipped when imported by tests) ----

export function systemAgentHeartbeatPath(dataDir: string = defaultDataDir()): string {
  return path.join(dataDir, "system-agent.json");
}

async function writeHeartbeat(dataDir: string, port: number, startedAt: string): Promise<void> {
  const target = systemAgentHeartbeatPath(dataDir);
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(
    target,
    JSON.stringify({ kind: "system-agent", pid: process.pid, port, started_at: startedAt, beat_at: new Date().toISOString() }, null, 2),
  );
}

function startStandalone(): void {
  const port = Number(process.env.HILT_SYSTEM_AGENT_PORT) || 3200;
  const dataDir = defaultDataDir();
  const startedAt = new Date().toISOString();
  const server = createSystemAgentServer();

  server.listen(port, "127.0.0.1", () => {
    console.log(`[system-agent] read-only System Agent listening on http://127.0.0.1:${port} (DATA_DIR=${dataDir})`);
  });

  const beat = () => { void writeHeartbeat(dataDir, port, startedAt).catch(() => {}); };
  beat();
  const timer = setInterval(beat, 30_000);
  timer.unref();

  const shutdown = () => {
    clearInterval(timer);
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const invokedDirectly = process.argv[1] !== undefined && process.argv[1] === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  startStandalone();
}
