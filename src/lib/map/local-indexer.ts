import { existsSync, statSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { readClaudeCodeSession, readClaudeProjectSession, walkFiles } from "./local-adapters/claude";
import { readCodexSessions } from "./local-adapters/codex";
import {
  countAllIndexedSessions,
  countIndexedSessions,
  deleteProviderSessions,
  deleteSessionsBySourcePaths,
  getMapDb,
  getMapMeta,
  getSourceFileRecord,
  removeMissingSourceFiles,
  setMapMeta,
  upsertMapSessions,
  upsertSourceFileRecord,
} from "./local-index-db";
import type { LocalMapScanDiagnostics, LocalSession, LocalSourceStatus } from "./local-types";

const LAST_SCAN_AT_KEY = "last_scan_at";
const LAST_SCAN_DIAGNOSTICS_KEY = "last_scan_diagnostics";

let activeScan: Promise<LocalMapScanDiagnostics> | undefined;

interface ScanCounters {
  filesScanned: number;
  filesChanged: number;
  errors: LocalMapScanDiagnostics["errors"];
  sourceStatuses: LocalSourceStatus[];
}

function fileStamp(path: string): { mtimeMs: number; sizeBytes: number } | undefined {
  try {
    const stat = statSync(path);
    return { mtimeMs: stat.mtimeMs, sizeBytes: stat.size };
  } catch {
    return undefined;
  }
}

function hasChanged(previous: { mtimeMs: number; sizeBytes: number } | undefined, next: { mtimeMs: number; sizeBytes: number } | undefined, force: boolean) {
  if (!next) return false;
  if (force || !previous) return true;
  return previous.mtimeMs !== next.mtimeMs || previous.sizeBytes !== next.sizeBytes;
}

function countProviderHarness(provider: string, harness: string): number {
  const row = getMapDb().prepare("SELECT COUNT(*) AS count FROM map_sessions WHERE provider = ? AND harness = ?").get(provider, harness) as { count: number };
  return row.count;
}

async function scanCodex(force: boolean, counters: ScanCounters) {
  const db = getMapDb();
  const dbPath = join(homedir(), ".codex", "state_5.sqlite");
  const readAt = Date.now();
  const stamp = fileStamp(dbPath);
  counters.filesScanned += 1;

  if (!stamp) {
    deleteProviderSessions(db, "codex");
    upsertSourceFileRecord(db, {
      path: dbPath,
      provider: "codex",
      harness: "state-sqlite",
      mtimeMs: 0,
      sizeBytes: 0,
      lastScannedAt: readAt,
      status: "missing",
      error: "Codex sqlite store not found",
    });
    counters.sourceStatuses.push({
      id: "codex-state",
      label: "Codex sessions",
      kind: "codex",
      harness: "state-sqlite",
      path: dbPath,
      ok: false,
      sessionCount: 0,
      lastReadAt: readAt,
      filesScanned: 1,
      filesChanged: 0,
      message: "Codex sqlite store not found",
    });
    return;
  }

  const previous = getSourceFileRecord(db, dbPath);
  const changed = hasChanged(previous, stamp, force);
  let sessionCount = countIndexedSessions(db, { source: "codex" });
  let ok = true;
  let message: string | undefined;

  if (changed) {
    counters.filesChanged += 1;
    const result = await readCodexSessions();
    const status = result.statuses[0];
    ok = status?.ok ?? true;
    message = status?.message;
    if (ok) {
      deleteProviderSessions(db, "codex");
      upsertMapSessions(db, result.sessions);
      sessionCount = result.sessions.length;
    } else {
      counters.errors.push({ provider: "codex", path: dbPath, message: message || "Failed to read Codex sqlite metadata" });
    }
  }

  upsertSourceFileRecord(db, {
    path: dbPath,
    provider: "codex",
    harness: "state-sqlite",
    mtimeMs: stamp.mtimeMs,
    sizeBytes: stamp.sizeBytes,
    lastScannedAt: readAt,
    status: ok ? "ok" : "error",
    error: message,
  });

  counters.sourceStatuses.push({
    id: "codex-state",
    label: "Codex sessions",
    kind: "codex",
    harness: "state-sqlite",
    path: dbPath,
    ok,
    sessionCount,
    lastReadAt: readAt,
    filesScanned: 1,
    filesChanged: changed ? 1 : 0,
    message,
  });
}

function scanClaudeFiles(input: {
  root: string;
  harness: "project-jsonl" | "code-session-json";
  statusId: string;
  label: string;
  files: string[];
  force: boolean;
  counters: ScanCounters;
  parser: (path: string) => LocalSession | undefined;
}) {
  const db = getMapDb();
  const readAt = Date.now();
  const existingRoot = existsSync(input.root);
  const currentPaths = new Set(input.files);
  let filesChanged = 0;

  input.counters.filesScanned += input.files.length;
  removeMissingSourceFiles(db, "claude", input.harness, currentPaths);

  if (!existingRoot) {
    deleteProviderSessions(db, "claude", input.harness);
    input.counters.sourceStatuses.push({
      id: input.statusId,
      label: input.label,
      kind: "claude",
      harness: input.harness,
      path: input.root,
      ok: false,
      sessionCount: 0,
      lastReadAt: readAt,
      filesScanned: 0,
      filesChanged: 0,
      message: "Claude source store not found",
    });
    return;
  }

  for (const path of input.files) {
    const stamp = fileStamp(path);
    if (!stamp) continue;
    const previous = getSourceFileRecord(db, path);
    if (!hasChanged(previous, stamp, input.force)) continue;

    filesChanged += 1;
    input.counters.filesChanged += 1;
    deleteSessionsBySourcePaths(db, [path]);

    try {
      const session = input.parser(path);
      if (session) {
        upsertMapSessions(db, [session]);
        upsertSourceFileRecord(db, {
          path,
          provider: "claude",
          harness: input.harness,
          mtimeMs: stamp.mtimeMs,
          sizeBytes: stamp.sizeBytes,
          lastScannedAt: readAt,
          sessionId: session.id,
          status: "ok",
        });
      } else {
        upsertSourceFileRecord(db, {
          path,
          provider: "claude",
          harness: input.harness,
          mtimeMs: stamp.mtimeMs,
          sizeBytes: stamp.sizeBytes,
          lastScannedAt: readAt,
          status: "error",
          error: "No readable session metadata found",
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to parse Claude session file";
      input.counters.errors.push({ provider: "claude", path, message });
      upsertSourceFileRecord(db, {
        path,
        provider: "claude",
        harness: input.harness,
        mtimeMs: stamp.mtimeMs,
        sizeBytes: stamp.sizeBytes,
        lastScannedAt: readAt,
        status: "error",
        error: message,
      });
    }
  }

  const sessionCount = countProviderHarness("claude", input.harness);
  input.counters.sourceStatuses.push({
    id: input.statusId,
    label: input.label,
    kind: "claude",
    harness: input.harness,
    path: input.root,
    ok: true,
    sessionCount,
    lastReadAt: readAt,
    filesScanned: input.files.length,
    filesChanged,
    message: input.files.length === 0 ? "No session files found" : undefined,
  });
}

function scanClaude(force: boolean, counters: ScanCounters) {
  const projectRoot = join(homedir(), ".claude", "projects");
  const appRoot = join(homedir(), "Library", "Application Support", "Claude");
  const projectFiles = walkFiles(projectRoot, (name) => name.endsWith(".jsonl"))
    .filter((path) => !path.endsWith("skill-injections.jsonl"));
  const appFiles = walkFiles(appRoot, (name) => name.endsWith(".json") && name !== "config.json")
    .filter((path) => path.includes("claude-code-sessions"));

  scanClaudeFiles({
    root: projectRoot,
    harness: "project-jsonl",
    statusId: "claude-projects",
    label: "Claude project JSONL",
    files: projectFiles,
    force,
    counters,
    parser: readClaudeProjectSession,
  });

  scanClaudeFiles({
    root: appRoot,
    harness: "code-session-json",
    statusId: "claude-code-sessions",
    label: "Claude app session JSON",
    files: appFiles,
    force,
    counters,
    parser: readClaudeCodeSession,
  });
}

async function scanMapIndex(force: boolean): Promise<LocalMapScanDiagnostics> {
  const db = getMapDb();
  const startedAt = Date.now();
  const counters: ScanCounters = {
    filesScanned: 0,
    filesChanged: 0,
    errors: [],
    sourceStatuses: [],
  };

  await scanCodex(force, counters);
  scanClaude(force, counters);

  const completedAt = Date.now();
  const diagnostics: LocalMapScanDiagnostics = {
    lastScanAt: completedAt,
    durationMs: completedAt - startedAt,
    filesScanned: counters.filesScanned,
    filesChanged: counters.filesChanged,
    errors: counters.errors,
    indexedSessionCount: countAllIndexedSessions(db),
    sourceStatuses: counters.sourceStatuses,
  };

  setMapMeta(db, LAST_SCAN_AT_KEY, completedAt);
  setMapMeta(db, LAST_SCAN_DIAGNOSTICS_KEY, diagnostics);
  return diagnostics;
}

export async function refreshMapIndex(): Promise<LocalMapScanDiagnostics> {
  if (activeScan) return activeScan;
  activeScan = scanMapIndex(true).finally(() => {
    activeScan = undefined;
  });
  return activeScan;
}

export async function ensureMapIndexFresh(maxAgeMs = 15_000): Promise<LocalMapScanDiagnostics> {
  if (activeScan) return activeScan;

  const db = getMapDb();
  const lastScanAt = getMapMeta<number>(db, LAST_SCAN_AT_KEY);
  if (lastScanAt && Date.now() - lastScanAt <= maxAgeMs) {
    return readMapScanDiagnostics();
  }

  activeScan = scanMapIndex(false).finally(() => {
    activeScan = undefined;
  });
  return activeScan;
}

export function readMapScanDiagnostics(): LocalMapScanDiagnostics {
  const db = getMapDb();
  const diagnostics = getMapMeta<LocalMapScanDiagnostics>(db, LAST_SCAN_DIAGNOSTICS_KEY);
  if (diagnostics) {
    return {
      ...diagnostics,
      indexedSessionCount: countAllIndexedSessions(db),
    };
  }

  return {
    filesScanned: 0,
    filesChanged: 0,
    errors: [],
    indexedSessionCount: countAllIndexedSessions(db),
    sourceStatuses: [],
  };
}
