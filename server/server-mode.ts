/**
 * Shared app-server mode + supervisor protocol (docs/plans/supervisor-v1.md).
 *
 * ONE implementation consumed by three parties:
 *  - electron/main.ts        — Electron-as-supervisor (laptops / fallback servers)
 *  - server/supervisor.ts    — the headless launchd daemon (server machines)
 *  - src/lib/system/*        — the Next server reporting its own supervision state
 *
 * The protocol is four JSON files under DATA_DIR:
 *  - app-mode.json                 durable mode choice ("dev" | "prod")
 *  - app-mode-intent.json          switch request written by POST /api/system/app-mode
 *  - app-supervisor.json           supervisor heartbeat (freshness gates the switch UI)
 *  - app-supervisor-children.json  child pids for crash re-adoption (daemon only)
 *
 * Everything here is plain Node — no Electron, no Next imports — so all three
 * consumers (tsc for electron, Next's bundler, tsx) can share it.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type AppMode = "dev" | "prod";
export type SupervisorState = "idle" | "rebuilding" | "switching" | "reverting";
export type SupervisorKind = "electron" | "daemon";

export const PROD_DIST_DIR = ".next-prod";
export const REBUILD_STAMP_RELPATH = path.join(PROD_DIST_DIR, ".hilt-rebuild-stamp");
/** Heartbeat cadence; a supervisor must beat at least this often. */
export const HEARTBEAT_INTERVAL_MS = 30_000;
/** Heartbeat older than this (3 missed beats) ⇒ unsupervised. */
export const HEARTBEAT_FRESH_MS = 90_000;

export interface SupervisorHeartbeat {
  kind: SupervisorKind;
  pid: number;
  started_at: string;
  beat_at: string;
  state: SupervisorState;
  detail?: string;
  children?: Record<string, number>;
}

export interface AppModeIntent {
  mode: AppMode;
  ts: number;
  requested_by?: string;
}

export interface ChildRecord {
  pid: number;
  port?: number;
}

export type ChildrenRecord = Partial<Record<"appServer" | "wsServer" | "eventServer", ChildRecord>>;

// ─── Paths ───

export function defaultDataDir(): string {
  return process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data");
}

export function appModeStatePath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "app-mode.json");
}

export function appModeIntentPath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "app-mode-intent.json");
}

export function supervisorHeartbeatPath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "app-supervisor.json");
}

export function supervisorChildrenPath(dataDir = defaultDataDir()): string {
  return path.join(dataDir, "app-supervisor-children.json");
}

function writeJson(filePath: string, value: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
}

function readJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

// ─── Mode state ───

export function readPersistedAppMode(dataDir = defaultDataDir()): AppMode | null {
  const data = readJson<{ mode?: unknown }>(appModeStatePath(dataDir));
  if (data?.mode === "prod" || data?.mode === "dev") return data.mode;
  return null;
}

export function persistAppMode(mode: AppMode, dataDir = defaultDataDir()): void {
  writeJson(appModeStatePath(dataDir), { mode, updated_at: new Date().toISOString() });
}

/** Resolution order: persisted state file > HILT_APP_MODE env > dev. */
export function initialAppMode(
  dataDir = defaultDataDir(),
  env: Record<string, string | undefined> = process.env
): AppMode {
  return readPersistedAppMode(dataDir) ?? (env.HILT_APP_MODE === "prod" ? "prod" : "dev");
}

export function prodBuildAvailable(projectDir: string): boolean {
  return fs.existsSync(path.join(projectDir, PROD_DIST_DIR, "BUILD_ID"));
}

/** Effective server mode: prod requires a completed `npm run rebuild` build. */
export function resolveServerMode(projectDir: string, currentMode: AppMode): AppMode {
  if (currentMode !== "prod") return "dev";
  if (prodBuildAvailable(projectDir)) return "prod";
  console.warn(
    `App mode is prod but ${PROD_DIST_DIR}/BUILD_ID is missing — run \`npm run rebuild\`. Falling back to the dev server.`
  );
  return "dev";
}

export interface NextSpawnSpec {
  args: string[];
  env: Record<string, string>;
  label: string;
}

export function nextSpawnSpec(projectDir: string, port: number, currentMode: AppMode): NextSpawnSpec {
  if (resolveServerMode(projectDir, currentMode) === "prod") {
    return {
      args: ["run", "start", "--", "--port", String(port)],
      env: { HILT_DIST_DIR: PROD_DIST_DIR, NODE_ENV: "production" },
      label: "production",
    };
  }
  return { args: ["run", "dev", "--", "--port", String(port)], env: {}, label: "dev" };
}

// ─── Supervisor heartbeat ───

export function writeSupervisorHeartbeat(
  heartbeat: Omit<SupervisorHeartbeat, "beat_at">,
  dataDir = defaultDataDir()
): void {
  writeJson(supervisorHeartbeatPath(dataDir), { ...heartbeat, beat_at: new Date().toISOString() });
}

export function readSupervisorHeartbeat(dataDir = defaultDataDir()): SupervisorHeartbeat | null {
  const data = readJson<SupervisorHeartbeat>(supervisorHeartbeatPath(dataDir));
  if (!data || (data.kind !== "electron" && data.kind !== "daemon")) return null;
  return data;
}

export function isHeartbeatFresh(
  heartbeat: SupervisorHeartbeat | null,
  now: number = Date.now()
): heartbeat is SupervisorHeartbeat {
  if (!heartbeat) return false;
  const beat = new Date(heartbeat.beat_at).getTime();
  if (!Number.isFinite(beat) || now - beat > HEARTBEAT_FRESH_MS) return false;
  // Belt and braces: a fresh-looking file from a dead supervisor must not
  // enable the switch. Signal 0 = existence check only.
  try {
    process.kill(heartbeat.pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function clearSupervisorHeartbeat(dataDir = defaultDataDir()): void {
  try {
    fs.unlinkSync(supervisorHeartbeatPath(dataDir));
  } catch {
    // Already gone.
  }
}

// ─── Mode-switch intent ───

export function writeAppModeIntent(mode: AppMode, requestedBy?: string, dataDir = defaultDataDir()): void {
  writeJson(appModeIntentPath(dataDir), {
    mode,
    ts: Date.now(),
    ...(requestedBy ? { requested_by: requestedBy } : {}),
  } satisfies AppModeIntent);
}

export function readAppModeIntent(dataDir = defaultDataDir()): AppModeIntent | null {
  const data = readJson<AppModeIntent>(appModeIntentPath(dataDir));
  if (!data || (data.mode !== "dev" && data.mode !== "prod") || typeof data.ts !== "number") return null;
  return data;
}

// ─── Children record (daemon re-adoption) ───

export function readChildrenRecord(dataDir = defaultDataDir()): ChildrenRecord {
  return readJson<ChildrenRecord>(supervisorChildrenPath(dataDir)) ?? {};
}

export function writeChildrenRecord(children: ChildrenRecord, dataDir = defaultDataDir()): void {
  writeJson(supervisorChildrenPath(dataDir), children);
}

export function clearChildrenRecord(dataDir = defaultDataDir()): void {
  try {
    fs.unlinkSync(supervisorChildrenPath(dataDir));
  } catch {
    // Already gone.
  }
}

export function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
