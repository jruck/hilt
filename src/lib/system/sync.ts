import { createHash } from "crypto";
import { readdir, readFile, stat } from "fs/promises";
import path from "path";
import { discoverSystemMachines, fetchPeerJson } from "./peers";
import { loadSystemSyncSettings, type SystemSyncProvider, type SystemSyncSettings } from "./sync-settings";
import type { SystemMachine } from "./types";

const SHARED_IGNORE_FILENAME = ".hilt-syncthing-ignore";
const LOCAL_IGNORE_FILENAME = ".stignore";
const CONFLICT_PATTERN = ".sync-conflict-";
const MAX_CONFLICTS = 200;
const SKIP_DIRS = new Set([
  ".git",
  ".next",
  ".stfolder",
  ".stversions",
  ".sync-backups",
  "dist",
  "node_modules",
  "target",
]);

interface SyncthingVersion {
  version?: string;
}

interface SyncthingStatus {
  myID?: string;
  startTime?: string;
}

interface SyncthingConnection {
  connected?: boolean;
  address?: string;
  type?: string;
  clientVersion?: string;
  paused?: boolean;
}

interface SyncthingConnections {
  connections?: Record<string, SyncthingConnection>;
}

interface SyncthingFolderConfig {
  id?: string;
  label?: string;
  path?: string;
  type?: string;
  paused?: boolean;
  devices?: Array<{ deviceID?: string; id?: string; name?: string }>;
  versioning?: {
    type?: string;
    params?: Record<string, string | number>;
    fsPath?: string;
    cleanupIntervalS?: number;
  };
  maxConflicts?: number;
}

interface SyncthingFolderStatus {
  globalBytes?: number;
  globalFiles?: number;
  inSyncBytes?: number;
  inSyncFiles?: number;
  localBytes?: number;
  localFiles?: number;
  needBytes?: number;
  needFiles?: number;
  needDeletes?: number;
  pullErrors?: number;
  state?: string;
  stateChanged?: string;
}

interface SyncthingFolderErrors {
  errors?: Array<{ path?: string; error?: string }>;
}

interface SyncthingIgnores {
  ignore?: string[];
  expanded?: string[];
}

export interface SystemSyncConflict {
  path: string;
  modifiedAt: string | null;
  sizeBytes: number | null;
}

export interface SystemSyncConflictSummary {
  count: number;
  truncated: boolean;
  files: SystemSyncConflict[];
  scannedAt: string;
}

export interface SystemSyncPeerStatus {
  deviceId: string;
  label: string;
  connected: boolean;
  address: string | null;
  clientVersion: string | null;
}

export interface SystemSyncFolderSnapshot {
  id: string;
  label: string | null;
  path: string;
  type: string;
  paused: boolean;
  state: string;
  stateChanged: string | null;
  globalBytes: number;
  globalFiles: number;
  inSyncBytes: number;
  inSyncFiles: number;
  localBytes: number;
  localFiles: number;
  needBytes: number;
  needFiles: number;
  needDeletes: number;
  pullErrors: number;
  versioning: {
    enabled: boolean;
    type: string | null;
    maxAgeDays: number | null;
    path: string | null;
  };
  maxConflicts: number | null;
  ignore: {
    localHash: string | null;
    sharedHash: string | null;
    includePresent: boolean;
    patternCount: number;
    expandedPatternCount: number;
  };
  errors: Array<{ path: string | null; error: string | null }>;
  conflicts: SystemSyncConflictSummary;
}

export interface SystemSyncMachineSnapshot {
  machine: SystemMachine;
  provider: SystemSyncProvider;
  enabled: true;
  readOnly: true;
  daemon: {
    reachable: boolean;
    version: string | null;
    deviceId: string | null;
    startTime: string | null;
    error: string | null;
  };
  folder: SystemSyncFolderSnapshot | null;
  peers: SystemSyncPeerStatus[];
  refreshedAt: string;
  error: string | null;
}

export interface SystemSyncMachineDisabled {
  machine: SystemMachine;
  provider: SystemSyncProvider | null;
  enabled: false;
  readOnly: true;
  reason: string;
  refreshedAt: string;
}

export type SystemSyncMachineResult = SystemSyncMachineSnapshot | SystemSyncMachineDisabled;

export type LocalSystemSyncResponse =
  | {
      app: "hilt-system-sync";
      enabled: true;
      machine: SystemSyncMachineSnapshot;
    }
  | {
      app: "hilt-system-sync";
      enabled: false;
      machine: SystemMachine;
      reason: string;
    };

export interface SystemSyncResponse {
  app: "hilt-system-sync";
  enabled: true;
  machines: SystemSyncMachineResult[];
  summary: {
    machine_count: number;
    healthy_count: number;
    conflict_count: number;
    needed_files: number;
    pull_errors: number;
  };
}

export type LocalSystemSyncConflictsResponse =
  | {
      app: "hilt-system-sync-conflicts";
      enabled: true;
      machine: SystemMachine;
      folder: string;
      conflicts: SystemSyncConflictSummary;
    }
  | {
      app: "hilt-system-sync-conflicts";
      enabled: false;
      machine: SystemMachine;
      folder: string;
      reason: string;
    };

export interface SystemSyncConflictsResponse {
  app: "hilt-system-sync-conflicts";
  enabled: true;
  folder: string;
  machines: Array<{
    machine: SystemMachine;
    enabled: boolean;
    reason?: string;
    conflicts?: SystemSyncConflictSummary;
  }>;
}

let localSnapshotCache: {
  key: string;
  expiresAt: number;
  response: LocalSystemSyncResponse;
  promise: Promise<LocalSystemSyncResponse> | null;
} | null = null;

export async function readLocalSystemSync(options: { force?: boolean; machine?: SystemMachine; settings?: SystemSyncSettings } = {}): Promise<LocalSystemSyncResponse> {
  const settings = options.settings ?? safeSettings();
  const cacheKey = settingsCacheKey(settings);
  const now = Date.now();
  if (!options.force && localSnapshotCache?.key === cacheKey && localSnapshotCache?.response && localSnapshotCache.expiresAt > now) {
    return localSnapshotCache.response;
  }
  if (!options.force && localSnapshotCache?.key === cacheKey && localSnapshotCache?.promise) return localSnapshotCache.promise;

  const promise = buildLocalSystemSync(settings, options.machine).then((response) => {
    localSnapshotCache = {
      key: cacheKey,
      response,
      promise: null,
      expiresAt: Date.now() + settings.cacheMs,
    };
    return response;
  }).catch((error) => {
    localSnapshotCache = null;
    throw error;
  });

  localSnapshotCache = {
    key: cacheKey,
    response: localSnapshotCache?.response as LocalSystemSyncResponse,
    promise,
    expiresAt: now + settings.cacheMs,
  };

  return promise;
}

export async function readSystemSync(options: { includePeers?: boolean; force?: boolean } = {}): Promise<SystemSyncResponse> {
  const machines = await discoverSystemMachines({ includePeers: options.includePeers });
  const results = await Promise.all(machines.map(async (machine) => {
    try {
      if (machine.self) return machineResultFromLocal(await readLocalSystemSync({ force: options.force }));
      if (machine.features?.sync !== true) return disabledMachine(machine, "Sync not available on this Hilt peer");
      const params = options.force ? "?scope=local&force=true" : "?scope=local";
      const response = await fetchPeerJson<LocalSystemSyncResponse>(machine, `/api/system/sync${params}`, { timeoutMs: 8_000 });
      return machineResultFromLocal(response, machine);
    } catch (error) {
      return disabledMachine(machine, error instanceof Error ? error.message : String(error));
    }
  }));

  return {
    app: "hilt-system-sync",
    enabled: true,
    machines: results,
    summary: {
      machine_count: results.length,
      healthy_count: results.filter((result) => result.enabled && result.daemon.reachable && !result.error).length,
      conflict_count: sum(results, (result) => result.enabled ? result.folder?.conflicts.count ?? 0 : 0),
      needed_files: sum(results, (result) => result.enabled ? result.folder?.needFiles ?? 0 : 0),
      pull_errors: sum(results, (result) => result.enabled ? result.folder?.pullErrors ?? 0 : 0),
    },
  };
}

export async function readLocalSystemSyncConflicts(folder: string, options: { force?: boolean } = {}): Promise<LocalSystemSyncConflictsResponse> {
  const response = await readLocalSystemSync(options);
  if (!response.enabled) {
    return {
      app: "hilt-system-sync-conflicts",
      enabled: false,
      machine: response.machine,
      folder,
      reason: response.reason,
    };
  }

  const snapshot = response.machine;
  if (!snapshot.folder || snapshot.folder.id !== folder) {
    return {
      app: "hilt-system-sync-conflicts",
      enabled: false,
      machine: snapshot.machine,
      folder,
      reason: `Folder ${folder} is not configured`,
    };
  }

  return {
    app: "hilt-system-sync-conflicts",
    enabled: true,
    machine: snapshot.machine,
    folder,
    conflicts: snapshot.folder.conflicts,
  };
}

export async function readSystemSyncConflicts(folder: string, options: { includePeers?: boolean; force?: boolean } = {}): Promise<SystemSyncConflictsResponse> {
  const response = await readSystemSync(options);
  return {
    app: "hilt-system-sync-conflicts",
    enabled: true,
    folder,
    machines: response.machines.map((result) => {
      if (!result.enabled) {
        return { machine: result.machine, enabled: false, reason: result.reason };
      }
      if (!result.folder || result.folder.id !== folder) {
        return { machine: result.machine, enabled: false, reason: `Folder ${folder} is not configured` };
      }
      return {
        machine: result.machine,
        enabled: true,
        conflicts: result.folder.conflicts,
      };
    }),
  };
}

export async function collectConflictFiles(rootPath: string, limit = MAX_CONFLICTS): Promise<SystemSyncConflictSummary> {
  const files: SystemSyncConflict[] = [];
  let truncated = false;

  async function walk(dir: string, relativeDir = ""): Promise<void> {
    if (files.length >= limit) {
      truncated = true;
      return;
    }

    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= limit) {
        truncated = true;
        return;
      }
      if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
      const relativePath = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath, relativePath);
      } else if (entry.isFile() && entry.name.includes(CONFLICT_PATTERN)) {
        const fileStat = await stat(fullPath).catch(() => null);
        files.push({
          path: relativePath,
          modifiedAt: fileStat ? new Date(fileStat.mtimeMs).toISOString() : null,
          sizeBytes: fileStat?.size ?? null,
        });
      }
    }
  }

  await walk(rootPath);
  files.sort((a, b) => (Date.parse(b.modifiedAt || "") || 0) - (Date.parse(a.modifiedAt || "") || 0));
  return {
    count: files.length,
    truncated,
    files,
    scannedAt: new Date().toISOString(),
  };
}

export function __resetSystemSyncCacheForTests(): void {
  localSnapshotCache = null;
}

async function buildLocalSystemSync(settings: SystemSyncSettings, inputMachine?: SystemMachine): Promise<LocalSystemSyncResponse> {
  const machine = inputMachine ?? (await discoverSystemMachines({ includePeers: false }))[0];
  if (!settings.enabled) {
    return {
      app: "hilt-system-sync",
      enabled: false,
      machine,
      reason: "Set HILT_SYNC_ENABLED=true to inspect Syncthing sync health.",
    };
  }

  const snapshot = await readLocalSyncthingSnapshot(machine, settings);
  return {
    app: "hilt-system-sync",
    enabled: true,
    machine: snapshot,
  };
}

export async function readLocalSyncthingSnapshot(machine: SystemMachine, settings: SystemSyncSettings): Promise<SystemSyncMachineSnapshot> {
  const refreshedAt = new Date().toISOString();
  try {
    validateLoopbackUrl(settings.url);
    const apiKey = (await readFile(settings.apiKeyFile, "utf-8")).trim();
    if (!apiKey) throw new Error("Syncthing API key file is empty");

    const [version, status, connections, folderConfig, folderStatus, folderErrors, ignores] = await Promise.all([
      readSyncthingJson<SyncthingVersion>("/rest/system/version", settings, apiKey),
      readSyncthingJson<SyncthingStatus>("/rest/system/status", settings, apiKey),
      readSyncthingJson<SyncthingConnections>("/rest/system/connections", settings, apiKey),
      readSyncthingJson<SyncthingFolderConfig>(`/rest/config/folders/${encodeURIComponent(settings.folderId)}`, settings, apiKey),
      readSyncthingJson<SyncthingFolderStatus>(`/rest/db/status?folder=${encodeURIComponent(settings.folderId)}`, settings, apiKey),
      readSyncthingJson<SyncthingFolderErrors>(`/rest/folder/errors?folder=${encodeURIComponent(settings.folderId)}`, settings, apiKey),
      readSyncthingJson<SyncthingIgnores>(`/rest/db/ignores?folder=${encodeURIComponent(settings.folderId)}`, settings, apiKey),
    ]);

    if (!folderConfig.path) throw new Error(`Syncthing folder ${settings.folderId} has no path`);
    const conflicts = await collectConflictFiles(folderConfig.path);
    const ignore = await readIgnoreState(folderConfig.path, ignores);

    return {
      machine,
      provider: "syncthing",
      enabled: true,
      readOnly: true,
      daemon: {
        reachable: true,
        version: version.version ?? null,
        deviceId: status.myID ?? null,
        startTime: status.startTime ?? null,
        error: null,
      },
      folder: folderSnapshot(settings.folderId, folderConfig, folderStatus, folderErrors, ignore, conflicts),
      peers: peerStatuses(folderConfig, connections, status.myID),
      refreshedAt,
      error: null,
    };
  } catch (error) {
    return {
      machine,
      provider: "syncthing",
      enabled: true,
      readOnly: true,
      daemon: {
        reachable: false,
        version: null,
        deviceId: null,
        startTime: null,
        error: error instanceof Error ? error.message : String(error),
      },
      folder: null,
      peers: [],
      refreshedAt,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function folderSnapshot(
  folderId: string,
  config: SyncthingFolderConfig,
  status: SyncthingFolderStatus,
  errors: SyncthingFolderErrors,
  ignore: SystemSyncFolderSnapshot["ignore"],
  conflicts: SystemSyncConflictSummary,
): SystemSyncFolderSnapshot {
  return {
    id: config.id || folderId,
    label: config.label || null,
    path: config.path || "",
    type: config.type || "unknown",
    paused: config.paused === true,
    state: status.state || "unknown",
    stateChanged: status.stateChanged || null,
    globalBytes: status.globalBytes ?? 0,
    globalFiles: status.globalFiles ?? 0,
    inSyncBytes: status.inSyncBytes ?? 0,
    inSyncFiles: status.inSyncFiles ?? 0,
    localBytes: status.localBytes ?? 0,
    localFiles: status.localFiles ?? 0,
    needBytes: status.needBytes ?? 0,
    needFiles: status.needFiles ?? 0,
    needDeletes: status.needDeletes ?? 0,
    pullErrors: status.pullErrors ?? 0,
    versioning: {
      enabled: Boolean(config.versioning?.type),
      type: config.versioning?.type || null,
      maxAgeDays: maxAgeDays(config.versioning?.params?.maxAge),
      path: config.versioning?.fsPath || null,
    },
    maxConflicts: typeof config.maxConflicts === "number" ? config.maxConflicts : null,
    ignore,
    errors: normalizeFolderErrors(errors),
    conflicts,
  };
}

async function readIgnoreState(rootPath: string, ignores: SyncthingIgnores): Promise<SystemSyncFolderSnapshot["ignore"]> {
  const localPath = path.join(rootPath, LOCAL_IGNORE_FILENAME);
  const sharedPath = path.join(rootPath, SHARED_IGNORE_FILENAME);
  const [localContent, sharedContent] = await Promise.all([
    readFile(localPath, "utf-8").catch(() => null),
    readFile(sharedPath, "utf-8").catch(() => null),
  ]);

  return {
    localHash: localContent ? sha256(localContent) : null,
    sharedHash: sharedContent ? sha256(sharedContent) : null,
    includePresent: Boolean(localContent?.split(/\r?\n/).some((line) => line.trim() === `#include ${SHARED_IGNORE_FILENAME}`)),
    patternCount: ignores.ignore?.length ?? 0,
    expandedPatternCount: ignores.expanded?.length ?? 0,
  };
}

function peerStatuses(config: SyncthingFolderConfig, connections: SyncthingConnections, selfId?: string): SystemSyncPeerStatus[] {
  const connectionMap = connections.connections || {};
  return (config.devices || [])
    .map((device) => device.deviceID || device.id || "")
    .filter((deviceId) => deviceId && deviceId !== selfId)
    .map((deviceId) => {
      const connection = connectionMap[deviceId] || {};
      return {
        deviceId,
        label: shortDeviceId(deviceId),
        connected: connection.connected === true,
        address: connection.address || null,
        clientVersion: connection.clientVersion || null,
      };
    });
}

async function readSyncthingJson<T>(endpoint: string, settings: SystemSyncSettings, apiKey: string): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(new URL(endpoint, settings.url), {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "X-API-Key": apiKey,
      },
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const message = typeof data?.error === "string" ? data.error : `Syncthing request failed: ${response.status}`;
      throw new Error(message);
    }
    return data as T;
  } finally {
    clearTimeout(timeout);
  }
}

function validateLoopbackUrl(rawUrl: string): void {
  const url = new URL(rawUrl);
  const host = url.hostname.toLowerCase();
  if (host !== "127.0.0.1" && host !== "localhost" && host !== "::1" && host !== "[::1]") {
    throw new Error("Syncthing URL must be loopback-only");
  }
}

function safeSettings(): SystemSyncSettings {
  try {
    return loadSystemSyncSettings();
  } catch {
    return {
      enabled: false,
      provider: "syncthing",
      folderId: "work-meta",
      url: "http://127.0.0.1:8384",
      apiKeyFile: "",
      cacheMs: 10_000,
    };
  }
}

function settingsCacheKey(settings: SystemSyncSettings): string {
  return [
    settings.enabled,
    settings.provider,
    settings.folderId,
    settings.url,
    settings.apiKeyFile,
  ].join("|");
}

function machineResultFromLocal(response: LocalSystemSyncResponse, fallbackMachine?: SystemMachine): SystemSyncMachineResult {
  if (response.enabled) {
    return fallbackMachine ? { ...response.machine, machine: fallbackMachine } : response.machine;
  }
  return disabledMachine(response.machine || fallbackMachine, response.reason);
}

function disabledMachine(machine: SystemMachine | undefined, reason: string): SystemSyncMachineDisabled {
  if (!machine) throw new Error(reason);
  return {
    machine,
    provider: null,
    enabled: false,
    readOnly: true,
    reason,
    refreshedAt: new Date().toISOString(),
  };
}

function normalizeFolderErrors(errors: SyncthingFolderErrors): Array<{ path: string | null; error: string | null }> {
  return (errors.errors || []).map((error) => ({
    path: error.path || null,
    error: error.error || null,
  }));
}

function maxAgeDays(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return null;
  return Math.round(seconds / 86_400);
}

function shortDeviceId(deviceId: string): string {
  return deviceId.split("-").slice(0, 2).join("-");
}

function sha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function sum<T>(items: T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0);
}
