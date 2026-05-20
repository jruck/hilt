import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";
import Database from "better-sqlite3";
import { getMapDbPath } from "./local-config";
import type {
  ActivityWindow,
  LocalSession,
  LocalSessionProvider,
  LocalSessionTrackingState,
  MapSourceFilter,
  MapStatusFilter,
} from "./local-types";

type SqlValue = string | number | null;

export interface MapSourceFileRecord {
  path: string;
  provider: LocalSessionProvider;
  harness: string;
  mtimeMs: number;
  sizeBytes: number;
  lastScannedAt?: number;
  sessionId?: string;
  status: "ok" | "missing" | "error";
  error?: string;
}

export interface MapOverride {
  externalKey: string;
  trackingState?: LocalSessionTrackingState;
  workspaceRoot?: string;
  workspaceLabel?: string;
  spaceLabel?: string;
  note?: string;
}

export interface IndexedSessionFilters {
  window?: ActivityWindow;
  status?: MapStatusFilter;
  source?: MapSourceFilter;
  q?: string;
  limit?: number;
  offset?: number;
}

interface MapSessionRow {
  id: string;
  provider: LocalSessionProvider;
  harness: string;
  external_id: string;
  external_key: string;
  title: string | null;
  cwd: string | null;
  workspace_root: string | null;
  workspace_label: string | null;
  space_label: string | null;
  repo_remote: string | null;
  git_branch: string | null;
  model_provider: string | null;
  model: string | null;
  role: LocalSession["role"];
  observed_state: LocalSession["observedState"];
  tracking_state: string;
  source_path: string | null;
  created_at: number | null;
  last_seen_at: number;
  last_activity_at: number | null;
  event_count: number;
  token_estimate: number | null;
  parent_external_id: string | null;
  child_external_ids_json: string | null;
  activity_heat_24h: number;
  activity_heat_7d: number;
  activity_heat_30d: number;
  activity_heat_all: number;
  signals_json: string | null;
  ignore_reasons_json: string | null;
  metadata_json: string | null;
  indexed_at: number;
  override_tracking_state?: string | null;
  override_workspace_root?: string | null;
  override_workspace_label?: string | null;
  override_space_label?: string | null;
}

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;

function jsonArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function sessionMetadata(value: string | null | undefined): Pick<LocalSession, "workFootprint"> {
  if (!value) return {};
  if (value === "{}" || value === "null" || value === "{\"workFootprint\":[]}") return {};
  try {
    const parsed = JSON.parse(value) as Partial<LocalSession>;
    const workFootprint = Array.isArray(parsed.workFootprint)
      ? parsed.workFootprint.filter((entry): entry is NonNullable<LocalSession["workFootprint"]>[number] => (
        Boolean(entry) &&
        typeof entry.path === "string" &&
        typeof entry.label === "string" &&
        typeof entry.weight === "number" &&
        typeof entry.eventCount === "number" &&
        Array.isArray(entry.kinds)
      ))
      : undefined;
    return workFootprint && workFootprint.length > 0 ? { workFootprint } : {};
  } catch {
    return {};
  }
}

function jsonString(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function normalizeTrackingState(value: string | null | undefined): LocalSessionTrackingState {
  if (value === "background" || value === "unmatched" || value === "ignored") return "background";
  return "foreground";
}

function mapRowToSession(row: MapSessionRow): LocalSession {
  const metadata = sessionMetadata(row.metadata_json);
  const trackingState = normalizeTrackingState(row.override_tracking_state ?? row.tracking_state);
  const workspaceRoot = row.override_workspace_root ?? row.workspace_root ?? undefined;
  const workspaceLabel = row.override_workspace_label ?? row.workspace_label ?? undefined;
  const spaceLabel = row.override_space_label ?? row.space_label ?? undefined;
  const overrideSignals = row.override_tracking_state || row.override_workspace_root || row.override_workspace_label || row.override_space_label
    ? ["manual override"]
    : [];

  return {
    id: row.id,
    provider: row.provider,
    harness: row.harness,
    externalId: row.external_id,
    externalKey: row.external_key,
    title: row.title ?? undefined,
    cwd: row.cwd ?? undefined,
    workspaceRoot,
    workspaceLabel,
    spaceLabel,
    repoRemote: row.repo_remote ?? undefined,
    gitBranch: row.git_branch ?? undefined,
    modelProvider: row.model_provider ?? undefined,
    model: row.model ?? undefined,
    role: row.role,
    observedState: row.observed_state,
    trackingState,
    sourcePath: row.source_path ?? undefined,
    createdAt: row.created_at ?? undefined,
    lastSeenAt: row.last_seen_at,
    lastActivityAt: row.last_activity_at ?? undefined,
    eventCount: row.event_count,
    tokenEstimate: row.token_estimate ?? undefined,
    parentExternalId: row.parent_external_id ?? undefined,
    childExternalIds: jsonArray(row.child_external_ids_json),
    workFootprint: metadata.workFootprint,
    activity: {
      heat24h: row.activity_heat_24h,
      heat7d: row.activity_heat_7d,
      heat30d: row.activity_heat_30d,
      heatAll: row.activity_heat_all,
    },
    signals: [...jsonArray(row.signals_json), ...overrideSignals],
    ignoreReasons: jsonArray(row.ignore_reasons_json),
  };
}

function activityColumn(window: ActivityWindow | undefined): string | undefined {
  if (window === "24h") return "s.activity_heat_24h";
  if (window === "7d") return "s.activity_heat_7d";
  if (window === "30d") return "s.activity_heat_30d";
  if (window === "all") return "s.activity_heat_all";
  return undefined;
}

function buildWhere(filters: IndexedSessionFilters): { whereSql: string; params: SqlValue[]; orderSql: string } {
  const where: string[] = [];
  const params: SqlValue[] = [];
  const heatColumn = activityColumn(filters.window);

  if (heatColumn && filters.window !== "all") {
    where.push(`${heatColumn} > 0`);
  }

  if (filters.source && filters.source !== "all") {
    where.push("s.provider = ?");
    params.push(filters.source);
  }

  if (filters.status && filters.status !== "all") {
    where.push(`(
      CASE COALESCE(o.tracking_state, s.tracking_state)
        WHEN 'tracked' THEN 'foreground'
        WHEN 'unmatched' THEN 'background'
        WHEN 'ignored' THEN 'background'
        ELSE COALESCE(o.tracking_state, s.tracking_state)
      END
    ) = ?`);
    params.push(filters.status);
  }

  const query = filters.q?.trim().toLowerCase();
  if (query) {
    const like = `%${query}%`;
    where.push(`(
      LOWER(COALESCE(s.title, '')) LIKE ?
      OR LOWER(s.id) LIKE ?
      OR LOWER(s.external_id) LIKE ?
      OR LOWER(s.external_key) LIKE ?
      OR LOWER(COALESCE(s.cwd, '')) LIKE ?
      OR LOWER(COALESCE(s.workspace_label, '')) LIKE ?
      OR LOWER(COALESCE(s.space_label, '')) LIKE ?
      OR LOWER(COALESCE(s.git_branch, '')) LIKE ?
      OR LOWER(COALESCE(s.metadata_json, '')) LIKE ?
      OR LOWER(s.provider) LIKE ?
      OR LOWER(s.harness) LIKE ?
    )`);
    params.push(like, like, like, like, like, like, like, like, like, like, like);
  }

  const orderColumn = heatColumn ?? "s.activity_heat_7d";
  return {
    whereSql: where.length > 0 ? `WHERE ${where.join(" AND ")}` : "",
    params,
    orderSql: `ORDER BY ${orderColumn} DESC, s.last_activity_at DESC, s.id ASC`,
  };
}

function ensureSchema(db: Database.Database) {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS map_sessions (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      harness TEXT NOT NULL,
      external_id TEXT NOT NULL,
      external_key TEXT NOT NULL UNIQUE,
      title TEXT,
      cwd TEXT,
      workspace_root TEXT,
      workspace_label TEXT,
      space_label TEXT,
      repo_remote TEXT,
      git_branch TEXT,
      model_provider TEXT,
      model TEXT,
      role TEXT NOT NULL,
      observed_state TEXT NOT NULL,
      tracking_state TEXT NOT NULL,
      source_path TEXT,
      created_at INTEGER,
      last_seen_at INTEGER NOT NULL,
      last_activity_at INTEGER,
      event_count INTEGER NOT NULL DEFAULT 0,
      token_estimate INTEGER,
      parent_external_id TEXT,
      child_external_ids_json TEXT NOT NULL DEFAULT '[]',
      activity_heat_24h REAL NOT NULL DEFAULT 0,
      activity_heat_7d REAL NOT NULL DEFAULT 0,
      activity_heat_30d REAL NOT NULL DEFAULT 0,
      activity_heat_all REAL NOT NULL DEFAULT 0,
      signals_json TEXT NOT NULL DEFAULT '[]',
      ignore_reasons_json TEXT NOT NULL DEFAULT '[]',
      metadata_json TEXT NOT NULL DEFAULT '{}',
      indexed_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_map_sessions_provider_harness ON map_sessions(provider, harness);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_tracking_state ON map_sessions(tracking_state);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_workspace_root ON map_sessions(workspace_root);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_last_activity ON map_sessions(last_activity_at DESC);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_source_path ON map_sessions(source_path);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_heat_24h ON map_sessions(activity_heat_24h DESC);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_heat_7d ON map_sessions(activity_heat_7d DESC);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_heat_30d ON map_sessions(activity_heat_30d DESC);
    CREATE INDEX IF NOT EXISTS idx_map_sessions_heat_all ON map_sessions(activity_heat_all DESC);

    CREATE TABLE IF NOT EXISTS map_source_files (
      path TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      harness TEXT NOT NULL,
      mtime_ms REAL NOT NULL DEFAULT 0,
      size_bytes INTEGER NOT NULL DEFAULT 0,
      last_scanned_at INTEGER,
      session_id TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_map_source_files_provider_harness ON map_source_files(provider, harness);

    CREATE TABLE IF NOT EXISTS map_overrides (
      external_key TEXT PRIMARY KEY,
      tracking_state TEXT,
      workspace_root TEXT,
      workspace_label TEXT,
      space_label TEXT,
      note TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_checkpoints (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      node_id TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS map_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.exec(`
    UPDATE map_sessions
    SET tracking_state = CASE tracking_state
      WHEN 'tracked' THEN 'foreground'
      WHEN 'unmatched' THEN 'background'
      WHEN 'ignored' THEN 'background'
      ELSE tracking_state
    END
    WHERE tracking_state IN ('tracked', 'unmatched', 'ignored');

    UPDATE map_overrides
    SET tracking_state = CASE tracking_state
      WHEN 'tracked' THEN 'foreground'
      WHEN 'unmatched' THEN 'background'
      WHEN 'ignored' THEN 'background'
      ELSE tracking_state
    END
    WHERE tracking_state IN ('tracked', 'unmatched', 'ignored');
  `);
}

export function getMapDb(): Database.Database {
  const dbPath = getMapDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  mkdirSync(dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  ensureSchema(cachedDb);
  return cachedDb;
}

export function openMapDbForPath(dbPath: string): Database.Database {
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  ensureSchema(db);
  return db;
}

export function closeMapDbForTests() {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
}

export function upsertMapSessions(db: Database.Database, sessions: LocalSession[]) {
  const indexedAt = Date.now();
  const stmt = db.prepare(`
    INSERT INTO map_sessions (
      id, provider, harness, external_id, external_key, title, cwd, workspace_root,
      workspace_label, space_label, repo_remote, git_branch, model_provider, model,
      role, observed_state, tracking_state, source_path, created_at, last_seen_at,
      last_activity_at, event_count, token_estimate, parent_external_id,
      child_external_ids_json, activity_heat_24h, activity_heat_7d, activity_heat_30d,
      activity_heat_all, signals_json, ignore_reasons_json, metadata_json, indexed_at
    ) VALUES (
      @id, @provider, @harness, @externalId, @externalKey, @title, @cwd, @workspaceRoot,
      @workspaceLabel, @spaceLabel, @repoRemote, @gitBranch, @modelProvider, @model,
      @role, @observedState, @trackingState, @sourcePath, @createdAt, @lastSeenAt,
      @lastActivityAt, @eventCount, @tokenEstimate, @parentExternalId,
      @childExternalIdsJson, @heat24h, @heat7d, @heat30d,
      @heatAll, @signalsJson, @ignoreReasonsJson, @metadataJson, @indexedAt
    )
    ON CONFLICT(external_key) DO UPDATE SET
      id = excluded.id,
      provider = excluded.provider,
      harness = excluded.harness,
      external_id = excluded.external_id,
      title = excluded.title,
      cwd = excluded.cwd,
      workspace_root = excluded.workspace_root,
      workspace_label = excluded.workspace_label,
      space_label = excluded.space_label,
      repo_remote = excluded.repo_remote,
      git_branch = excluded.git_branch,
      model_provider = excluded.model_provider,
      model = excluded.model,
      role = excluded.role,
      observed_state = excluded.observed_state,
      tracking_state = excluded.tracking_state,
      source_path = excluded.source_path,
      created_at = excluded.created_at,
      last_seen_at = excluded.last_seen_at,
      last_activity_at = excluded.last_activity_at,
      event_count = excluded.event_count,
      token_estimate = excluded.token_estimate,
      parent_external_id = excluded.parent_external_id,
      child_external_ids_json = excluded.child_external_ids_json,
      activity_heat_24h = excluded.activity_heat_24h,
      activity_heat_7d = excluded.activity_heat_7d,
      activity_heat_30d = excluded.activity_heat_30d,
      activity_heat_all = excluded.activity_heat_all,
      signals_json = excluded.signals_json,
      ignore_reasons_json = excluded.ignore_reasons_json,
      metadata_json = excluded.metadata_json,
      indexed_at = excluded.indexed_at
  `);

  const write = db.transaction((items: LocalSession[]) => {
    for (const session of items) {
      stmt.run({
        id: session.id,
        provider: session.provider,
        harness: session.harness,
        externalId: session.externalId,
        externalKey: session.externalKey,
        title: session.title ?? null,
        cwd: session.cwd ?? null,
        workspaceRoot: session.workspaceRoot ?? null,
        workspaceLabel: session.workspaceLabel ?? null,
        spaceLabel: session.spaceLabel ?? null,
        repoRemote: session.repoRemote ?? null,
        gitBranch: session.gitBranch ?? null,
        modelProvider: session.modelProvider ?? null,
        model: session.model ?? null,
        role: session.role,
        observedState: session.observedState,
        trackingState: session.trackingState,
        sourcePath: session.sourcePath ?? null,
        createdAt: session.createdAt ?? null,
        lastSeenAt: session.lastSeenAt,
        lastActivityAt: session.lastActivityAt ?? null,
        eventCount: session.eventCount,
        tokenEstimate: session.tokenEstimate ?? null,
        parentExternalId: session.parentExternalId ?? null,
        childExternalIdsJson: jsonString(session.childExternalIds ?? []),
        heat24h: session.activity.heat24h,
        heat7d: session.activity.heat7d,
        heat30d: session.activity.heat30d,
        heatAll: session.activity.heatAll,
        signalsJson: jsonString(session.signals),
        ignoreReasonsJson: jsonString(session.ignoreReasons),
        metadataJson: session.workFootprint && session.workFootprint.length > 0
          ? jsonString({ workFootprint: session.workFootprint })
          : "{}",
        indexedAt,
      });
    }
  });

  write(sessions);
}

export function deleteProviderSessions(db: Database.Database, provider: LocalSessionProvider, harness?: string) {
  if (harness) {
    db.prepare("DELETE FROM map_sessions WHERE provider = ? AND harness = ?").run(provider, harness);
    return;
  }
  db.prepare("DELETE FROM map_sessions WHERE provider = ?").run(provider);
}

export function deleteSessionsBySourcePaths(db: Database.Database, paths: string[]) {
  if (paths.length === 0) return;
  const stmt = db.prepare("DELETE FROM map_sessions WHERE source_path = ?");
  const tx = db.transaction((items: string[]) => {
    for (const path of items) stmt.run(path);
  });
  tx(paths);
}

export function getSourceFileRecord(db: Database.Database, path: string): MapSourceFileRecord | undefined {
  const row = db.prepare("SELECT * FROM map_source_files WHERE path = ?").get(path) as {
    path: string;
    provider: LocalSessionProvider;
    harness: string;
    mtime_ms: number;
    size_bytes: number;
    last_scanned_at: number | null;
    session_id: string | null;
    status: "ok" | "missing" | "error";
    error: string | null;
  } | undefined;
  if (!row) return undefined;
  return {
    path: row.path,
    provider: row.provider,
    harness: row.harness,
    mtimeMs: row.mtime_ms,
    sizeBytes: row.size_bytes,
    lastScannedAt: row.last_scanned_at ?? undefined,
    sessionId: row.session_id ?? undefined,
    status: row.status,
    error: row.error ?? undefined,
  };
}

export function upsertSourceFileRecord(db: Database.Database, record: MapSourceFileRecord) {
  db.prepare(`
    INSERT INTO map_source_files (
      path, provider, harness, mtime_ms, size_bytes, last_scanned_at, session_id, status, error
    ) VALUES (
      @path, @provider, @harness, @mtimeMs, @sizeBytes, @lastScannedAt, @sessionId, @status, @error
    )
    ON CONFLICT(path) DO UPDATE SET
      provider = excluded.provider,
      harness = excluded.harness,
      mtime_ms = excluded.mtime_ms,
      size_bytes = excluded.size_bytes,
      last_scanned_at = excluded.last_scanned_at,
      session_id = excluded.session_id,
      status = excluded.status,
      error = excluded.error
  `).run({
    path: record.path,
    provider: record.provider,
    harness: record.harness,
    mtimeMs: record.mtimeMs,
    sizeBytes: record.sizeBytes,
    lastScannedAt: record.lastScannedAt ?? null,
    sessionId: record.sessionId ?? null,
    status: record.status,
    error: record.error ?? null,
  });
}

export function listSourceFileRecords(db: Database.Database, provider?: LocalSessionProvider, harness?: string): MapSourceFileRecord[] {
  const where: string[] = [];
  const params: SqlValue[] = [];
  if (provider) {
    where.push("provider = ?");
    params.push(provider);
  }
  if (harness) {
    where.push("harness = ?");
    params.push(harness);
  }

  const rows = db.prepare(`SELECT path FROM map_source_files ${where.length ? `WHERE ${where.join(" AND ")}` : ""}`).all(...params) as Array<{ path: string }>;
  return rows.map((row) => getSourceFileRecord(db, row.path)).filter((row): row is MapSourceFileRecord => Boolean(row));
}

export function removeMissingSourceFiles(db: Database.Database, provider: LocalSessionProvider, harness: string, currentPaths: Set<string>): string[] {
  const existing = listSourceFileRecords(db, provider, harness);
  const missing = existing.filter((record) => !currentPaths.has(record.path)).map((record) => record.path);
  if (missing.length === 0) return [];

  const deleteSource = db.prepare("DELETE FROM map_source_files WHERE path = ?");
  const tx = db.transaction((paths: string[]) => {
    for (const path of paths) deleteSource.run(path);
  });
  tx(missing);
  deleteSessionsBySourcePaths(db, missing);
  return missing;
}

export function upsertMapOverride(db: Database.Database, override: MapOverride) {
  db.prepare(`
    INSERT INTO map_overrides (
      external_key, tracking_state, workspace_root, workspace_label, space_label, note, updated_at
    ) VALUES (
      @externalKey, @trackingState, @workspaceRoot, @workspaceLabel, @spaceLabel, @note, @updatedAt
    )
    ON CONFLICT(external_key) DO UPDATE SET
      tracking_state = excluded.tracking_state,
      workspace_root = excluded.workspace_root,
      workspace_label = excluded.workspace_label,
      space_label = excluded.space_label,
      note = excluded.note,
      updated_at = excluded.updated_at
  `).run({
    externalKey: override.externalKey,
    trackingState: override.trackingState ?? null,
    workspaceRoot: override.workspaceRoot ?? null,
    workspaceLabel: override.workspaceLabel ?? null,
    spaceLabel: override.spaceLabel ?? null,
    note: override.note ?? null,
    updatedAt: Date.now(),
  });
}

export function setMapMeta(db: Database.Database, key: string, value: unknown) {
  db.prepare(`
    INSERT INTO map_meta (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(value), Date.now());
}

export function getMapMeta<T>(db: Database.Database, key: string): T | undefined {
  const row = db.prepare("SELECT value FROM map_meta WHERE key = ?").get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return undefined;
  }
}

function selectSql(extraSql = "") {
  return `
    SELECT
      s.*,
      o.tracking_state AS override_tracking_state,
      o.workspace_root AS override_workspace_root,
      o.workspace_label AS override_workspace_label,
      o.space_label AS override_space_label
    FROM map_sessions s
    LEFT JOIN map_overrides o ON o.external_key = s.external_key
    ${extraSql}
  `;
}

export function listIndexedSessions(db: Database.Database, filters: IndexedSessionFilters = {}): LocalSession[] {
  const { whereSql, params, orderSql } = buildWhere(filters);
  const pagingSql = filters.limit ? "LIMIT ? OFFSET ?" : "";
  const pagingParams = filters.limit ? [filters.limit, filters.offset ?? 0] : [];
  const rows = db.prepare(`${selectSql(whereSql)} ${orderSql} ${pagingSql}`).all(...params, ...pagingParams) as MapSessionRow[];
  return rows.map(mapRowToSession);
}

export function countIndexedSessions(db: Database.Database, filters: IndexedSessionFilters = {}): number {
  const { whereSql, params } = buildWhere(filters);
  const row = db.prepare(`
    SELECT COUNT(*) AS count
    FROM map_sessions s
    LEFT JOIN map_overrides o ON o.external_key = s.external_key
    ${whereSql}
  `).get(...params) as { count: number };
  return row.count;
}

export function getIndexedSessionById(db: Database.Database, id: string): LocalSession | undefined {
  const row = db.prepare(`${selectSql("WHERE s.id = ?")}`).get(id) as MapSessionRow | undefined;
  return row ? mapRowToSession(row) : undefined;
}

export function countAllIndexedSessions(db: Database.Database): number {
  const row = db.prepare("SELECT COUNT(*) AS count FROM map_sessions").get() as { count: number };
  return row.count;
}

export function databaseExists(): boolean {
  return existsSync(getMapDbPath());
}
