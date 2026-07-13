import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { atomicWriteFile, hashId } from "../library/utils";
import type { Ledger, LedgerEntry, LedgerStatus } from "./meeting-ledger";

export const MEETING_LEDGER_SCHEMA_VERSION = 3;
const DB_SCHEMA_VERSION = MEETING_LEDGER_SCHEMA_VERSION;
const STORAGE_MARKER_VERSION = 1 as const;
const LEDGER_STATUSES = new Set<LedgerStatus>(["open", "carried", "resolved", "dropped"]);

export type MeetingLedgerStorageMode = "legacy" | "sqlite";

export interface MeetingLedgerStorageMarker {
  version: typeof STORAGE_MARKER_VERSION;
  mode: MeetingLedgerStorageMode;
  migrated_at: string | null;
  legacy_home: string | null;
}

export interface MeetingSummaryRecord {
  meeting: string;
  date: string;
  summary: string;
  updated_at: string;
}

export interface LedgerEventRecord {
  sequence: number;
  event_id: string;
  event_type: string;
  entry_id: string | null;
  meeting_path: string | null;
  occurred_at: string;
  run_id: string | null;
  payload: Record<string, unknown>;
}

export interface MeetingLedgerCounts {
  total: number;
  open: number;
  carried: number;
  resolved: number;
  dropped: number;
  latent: number;
  pending: number;
  accepted_open: number;
  stamped: number;
  event_sequence: number;
}

export type MeetingExtractionJobStatus = "queued" | "running" | "retry_wait" | "complete" | "failed";
export type MeetingExtractionJobSource = "trigger" | "nightly" | "manual";

export interface MeetingExtractionJob {
  meeting_path: string;
  granola_id: string | null;
  status: MeetingExtractionJobStatus;
  last_enqueued_by: MeetingExtractionJobSource;
  settled_at: string | null;
  queued_at: string;
  updated_at: string;
  attempt_count: number;
  lease_owner: string | null;
  lease_expires_at: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  completed_at: string | null;
  completion_run_id: string | null;
}

export interface MeetingExtractionQueueHealth {
  depth: number;
  queued: number;
  running: number;
  retry_wait: number;
  failed: number;
  complete: number;
  oldest_queued_at: string | null;
  next_retry_at: string | null;
  active: MeetingExtractionJob[];
  last_error: { meeting_path: string; error: string; at: string } | null;
}

export type LedgerSurfaceState = "pending" | "accepted" | "latent" | "observed" | "dismissed" | "resolved";

export function isLatentLedgerEntry(entry: LedgerEntry): boolean {
  return !entry.task_id
    && !entry.verdict
    && !entry.first_escalated_at
    && ["open", "carried"].includes(entry.status)
    && ["justin", "unclear"].includes(entry.owner);
}

export function ledgerSurfaceState(entry: LedgerEntry): LedgerSurfaceState {
  if (entry.task_id && !entry.verdict && ["open", "carried"].includes(entry.status)) return "pending";
  if (["approve", "assign_to_me", "assign_to_agent"].includes(entry.verdict?.verdict ?? "") && ["open", "carried"].includes(entry.status)) return "accepted";
  if (entry.verdict?.verdict === "dismiss" && entry.status === "dropped") return "dismissed";
  if (["resolved", "dropped"].includes(entry.status)) return "resolved";
  if (isLatentLedgerEntry(entry)) return "latent";
  return "observed";
}

export interface MeetingLedgerListFilters {
  status?: LedgerStatus;
  surface?: LedgerSurfaceState;
  owner?: string;
  meeting?: string;
  dateFrom?: string;
  dateTo?: string;
  query?: string;
  cursor?: string;
  limit?: number;
}

export interface MeetingLedgerListResult {
  items: LedgerEntry[];
  next_cursor: string | null;
  total: number;
  facets: {
    status: Record<LedgerStatus, number>;
    surface: Record<LedgerSurfaceState, number>;
    owner: Record<string, number>;
  };
}

export interface IdentityContextSelection {
  required: LedgerEntry[];
  older_matches: LedgerEntry[];
  estimated_tokens: number;
  chunks: LedgerEntry[][];
  complete_recent_window: boolean;
}

interface EntryRow {
  id: string;
  action: string;
  normalized_action: string;
  owner: string;
  due: string | null;
  context: string | null;
  confidence: number;
  source: LedgerEntry["source"];
  status: LedgerStatus;
  opened_at: string;
  opened_from: string;
  first_escalated_at: string | null;
  task_id: string | null;
  verdict_action: string | null;
  verdict_at: string | null;
  verdict_note: string | null;
  last_seen_at: string;
  updated_at: string;
}

interface CitationRow {
  source: string;
  date: string | null;
  anchor: string | null;
}

interface SightingRow {
  at: string;
  meeting: string;
  quote: string | null;
}

interface HistoryRow {
  at: string;
  from_status: LedgerStatus | null;
  to_status: LedgerStatus;
  evidence: string | null;
}

type ExtractionJobRow = MeetingExtractionJob;

function dataRoot(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function meetingLedgerRoot(vaultPath: string): string {
  return path.join(dataRoot(), "meeting-ledgers", hashId(path.resolve(vaultPath), 16));
}

export function meetingLedgerDbPath(vaultPath: string, ledgerHomeOverride?: string | null): string {
  return ledgerHomeOverride
    ? path.join(path.resolve(ledgerHomeOverride), "state", "meeting-ledger.sqlite")
    : path.join(meetingLedgerRoot(vaultPath), "meeting-ledger.sqlite");
}

export function meetingLedgerLockPath(vaultPath: string, ledgerHomeOverride?: string | null): string {
  return `${meetingLedgerDbPath(vaultPath, ledgerHomeOverride)}.lock`;
}

export interface MeetingLedgerLock {
  path: string;
  release(): void;
}

function processIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Serializes extraction, scheduled/post-meeting writers, migration, and rollback around the
 * proposal-file + database boundary. SQLite serializes its own transactions, but it cannot own
 * the external proposal file that is reconciled into the following transaction. */
export async function acquireMeetingLedgerLock(input: {
  vaultPath: string;
  ledgerHomeOverride?: string | null;
  label: string;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<MeetingLedgerLock> {
  const filePath = meetingLedgerLockPath(input.vaultPath, input.ledgerHomeOverride);
  const timeoutMs = input.timeoutMs ?? 10 * 60_000;
  const pollMs = input.pollMs ?? 250;
  const started = Date.now();
  const token = `${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });

  while (true) {
    try {
      const fd = fs.openSync(filePath, "wx", 0o600);
      try {
        fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, token, label: input.label, acquired_at: new Date().toISOString() })}\n`);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      let released = false;
      return {
        path: filePath,
        release() {
          if (released) return;
          released = true;
          try {
            const current = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { token?: string };
            if (current.token === token) fs.unlinkSync(filePath);
          } catch { /* already released or replaced */ }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const held = JSON.parse(fs.readFileSync(filePath, "utf-8")) as { pid?: number; acquired_at?: string };
        const age = held.acquired_at ? Date.now() - Date.parse(held.acquired_at) : Number.POSITIVE_INFINITY;
        if (!processIsAlive(Number(held.pid)) && age > 5_000) {
          fs.unlinkSync(filePath);
          continue;
        }
      } catch {
        try {
          const age = Date.now() - fs.statSync(filePath).mtimeMs;
          if (age > 5_000) fs.unlinkSync(filePath);
          if (age > 5_000) continue;
        } catch { continue; }
      }
      if (Date.now() - started >= timeoutMs) throw new Error(`timed out waiting for meeting-ledger lock at ${filePath}`);
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
}

export function meetingLedgerMarkerPath(vaultPath: string): string {
  return path.join(meetingLedgerRoot(vaultPath), "storage.json");
}

export function meetingLedgerEventMarkerPath(vaultPath: string): string {
  return path.join(meetingLedgerRoot(vaultPath), "ledger-changed.json");
}

export function emitMeetingLedgerChanged(vaultPath: string, payload: Record<string, unknown>): void {
  atomicWriteFile(meetingLedgerEventMarkerPath(vaultPath), `${JSON.stringify({ at: new Date().toISOString(), ...payload })}\n`);
}

export function readMeetingLedgerStorageMarker(vaultPath: string): MeetingLedgerStorageMarker {
  try {
    const parsed = JSON.parse(fs.readFileSync(meetingLedgerMarkerPath(vaultPath), "utf-8")) as MeetingLedgerStorageMarker;
    if (parsed.version === STORAGE_MARKER_VERSION && (parsed.mode === "legacy" || parsed.mode === "sqlite")) return parsed;
  } catch { /* legacy is the safe default */ }
  return { version: STORAGE_MARKER_VERSION, mode: "legacy", migrated_at: null, legacy_home: null };
}

export function writeMeetingLedgerStorageMarker(vaultPath: string, marker: MeetingLedgerStorageMarker): void {
  atomicWriteFile(meetingLedgerMarkerPath(vaultPath), `${JSON.stringify(marker, null, 2)}\n`);
}

/** Open only the production canonical store. Unlike the low-level constructor, this never creates
 * a database when the storage marker or canonical file is missing. */
export function openCanonicalMeetingLedgerStore(vaultPath: string): MeetingLedgerStore {
  const marker = readMeetingLedgerStorageMarker(vaultPath);
  const dbPath = meetingLedgerDbPath(vaultPath);
  if (marker.mode !== "sqlite") {
    throw new Error(`canonical meeting ledger is not SQLite (storage mode: ${marker.mode})`);
  }
  if (!fs.existsSync(dbPath)) {
    throw new Error(`canonical meeting ledger is missing at ${dbPath}; refusing to initialize a blank database`);
  }
  return new MeetingLedgerStore(dbPath);
}

function assertIso(value: string, label: string): void {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error(`invalid ${label}: ${value}`);
}

function validateEntry(entry: LedgerEntry): void {
  if (!entry.id || !/^ma-\d{4}-\d{2}-\d{2}-\d{3,}$/.test(entry.id)) throw new Error(`invalid ledger id: ${entry.id}`);
  if (!entry.action.trim()) throw new Error(`ledger action is empty: ${entry.id}`);
  if (!LEDGER_STATUSES.has(entry.status)) throw new Error(`invalid ledger status for ${entry.id}: ${entry.status}`);
  assertIso(entry.opened_at, `${entry.id}.opened_at`);
  let prior: LedgerStatus | null = null;
  const allowed = new Set([
    "null->open", "null->carried",
    "open->carried", "open->resolved", "open->dropped",
    "carried->open", "carried->resolved", "carried->dropped",
    "dropped->open",
  ]);
  for (const history of entry.status_history) {
    if (!LEDGER_STATUSES.has(history.to) || (history.from !== null && !LEDGER_STATUSES.has(history.from))) {
      throw new Error(`invalid status history for ${entry.id}`);
    }
    assertIso(history.at, `${entry.id}.status_history.at`);
    if (history.from !== prior) throw new Error(`disconnected status history for ${entry.id}: expected from=${prior}, got ${history.from}`);
    if (!allowed.has(`${history.from}->${history.to}`)) throw new Error(`invalid status transition for ${entry.id}: ${history.from}->${history.to}`);
    prior = history.to;
  }
  if (prior !== entry.status) throw new Error(`status history for ${entry.id} ends at ${prior}, row is ${entry.status}`);
}

function latestSeen(entry: LedgerEntry): string {
  return entry.sightings.reduce((latest, sighting) => sighting.at > latest ? sighting.at : latest, entry.opened_at);
}

function normalizeAction(action: string): string {
  return action.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function surfaceWhere(surface: LedgerSurfaceState): string {
  if (surface === "pending") return "e.task_id IS NOT NULL AND e.verdict_action IS NULL AND e.status IN ('open','carried')";
  if (surface === "accepted") return "e.verdict_action IN ('approve','assign_to_me','assign_to_agent') AND e.status IN ('open','carried')";
  if (surface === "latent") return "e.task_id IS NULL AND e.verdict_action IS NULL AND e.first_escalated_at IS NULL AND e.status IN ('open','carried') AND e.owner IN ('justin','unclear')";
  if (surface === "dismissed") return "e.verdict_action = 'dismiss' AND e.status = 'dropped'";
  if (surface === "resolved") return "e.status IN ('resolved','dropped') AND COALESCE(e.verdict_action, '') <> 'dismiss'";
  return "e.task_id IS NULL AND e.verdict_action IS NULL AND e.status IN ('open','carried') AND NOT (e.first_escalated_at IS NULL AND e.owner IN ('justin','unclear'))";
}

function tokenEstimate(entries: LedgerEntry[]): number {
  const chars = entries.reduce((total, entry) => total
    + entry.id.length + entry.owner.length + entry.action.length + (entry.context?.length ?? 0) + 48, 0);
  return Math.ceil(chars / 4);
}

export class MeetingLedgerStore {
  readonly dbPath: string;
  readonly db: Database.Database;

  constructor(dbPath: string) {
    this.dbPath = path.resolve(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new Database(this.dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = FULL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.ensureSchema();
  }

  static open(vaultPath: string, ledgerHomeOverride?: string | null): MeetingLedgerStore {
    return new MeetingLedgerStore(meetingLedgerDbPath(vaultPath, ledgerHomeOverride));
  }

  close(): void {
    this.db.close();
  }

  private ensureSchema(): void {
    const version = Number(this.db.pragma("user_version", { simple: true }) || 0);
    if (version > DB_SCHEMA_VERSION) throw new Error(`meeting ledger schema ${version} is newer than supported ${DB_SCHEMA_VERSION}`);
    if (version === 0) {
      this.db.exec(`
        CREATE TABLE ledger_entries (
          id TEXT PRIMARY KEY,
          action TEXT NOT NULL,
          normalized_action TEXT NOT NULL,
          owner TEXT NOT NULL,
          due TEXT,
          context TEXT,
          confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
          source TEXT NOT NULL CHECK(source IN ('extractor','catch_phrase')),
          status TEXT NOT NULL CHECK(status IN ('open','carried','resolved','dropped')),
          opened_at TEXT NOT NULL,
          opened_from TEXT NOT NULL,
          first_escalated_at TEXT,
          task_id TEXT UNIQUE,
          verdict_action TEXT,
          verdict_at TEXT,
          verdict_note TEXT,
          last_seen_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_ledger_entries_status ON ledger_entries(status);
        CREATE INDEX idx_ledger_entries_normalized_action ON ledger_entries(normalized_action);
        CREATE INDEX idx_ledger_entries_owner ON ledger_entries(owner);
        CREATE INDEX idx_ledger_entries_opened_at ON ledger_entries(opened_at DESC);
        CREATE INDEX idx_ledger_entries_last_seen ON ledger_entries(last_seen_at DESC);
        CREATE INDEX idx_ledger_entries_meeting ON ledger_entries(opened_from);
        CREATE INDEX idx_ledger_entries_task ON ledger_entries(task_id);
        CREATE INDEX idx_ledger_entries_verdict ON ledger_entries(verdict_action, verdict_at);

        CREATE TABLE ledger_citations (
          entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          source TEXT NOT NULL,
          citation_date TEXT,
          anchor TEXT,
          PRIMARY KEY(entry_id, position)
        );
        CREATE INDEX idx_ledger_citations_source ON ledger_citations(source);

        CREATE TABLE ledger_sightings (
          entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          sighted_at TEXT NOT NULL,
          meeting TEXT NOT NULL,
          quote TEXT,
          PRIMARY KEY(entry_id, position)
        );
        CREATE INDEX idx_ledger_sightings_at ON ledger_sightings(sighted_at DESC);
        CREATE INDEX idx_ledger_sightings_meeting ON ledger_sightings(meeting);

        CREATE TABLE ledger_status_history (
          entry_id TEXT NOT NULL REFERENCES ledger_entries(id) ON DELETE CASCADE,
          position INTEGER NOT NULL,
          changed_at TEXT NOT NULL,
          from_status TEXT CHECK(from_status IS NULL OR from_status IN ('open','carried','resolved','dropped')),
          to_status TEXT NOT NULL CHECK(to_status IN ('open','carried','resolved','dropped')),
          evidence TEXT,
          PRIMARY KEY(entry_id, position)
        );
        CREATE INDEX idx_ledger_history_at ON ledger_status_history(changed_at DESC);

        CREATE TABLE meeting_summaries (
          meeting TEXT PRIMARY KEY,
          meeting_date TEXT NOT NULL,
          summary TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE INDEX idx_meeting_summaries_date ON meeting_summaries(meeting_date DESC);

        CREATE TABLE processed_meetings (
          meeting TEXT PRIMARY KEY,
          processed_at TEXT NOT NULL
        );

        CREATE TABLE extraction_runs (
          id TEXT PRIMARY KEY,
          started_at TEXT NOT NULL,
          finished_at TEXT,
          status TEXT NOT NULL,
          attempted INTEGER NOT NULL DEFAULT 0,
          succeeded INTEGER NOT NULL DEFAULT 0,
          error TEXT,
          context_tokens INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE meeting_extraction_jobs (
          meeting_path TEXT PRIMARY KEY,
          granola_id TEXT,
          status TEXT NOT NULL CHECK(status IN ('queued','running','retry_wait','complete','failed')),
          last_enqueued_by TEXT NOT NULL CHECK(last_enqueued_by IN ('trigger','nightly','manual')),
          settled_at TEXT,
          queued_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
          lease_owner TEXT,
          lease_expires_at TEXT,
          next_retry_at TEXT,
          last_error TEXT,
          completed_at TEXT,
          completion_run_id TEXT,
          CHECK(status <> 'running' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
        );
        CREATE INDEX idx_meeting_extraction_jobs_status_retry
          ON meeting_extraction_jobs(status, next_retry_at, queued_at);
        CREATE INDEX idx_meeting_extraction_jobs_lease
          ON meeting_extraction_jobs(status, lease_expires_at);

        CREATE TABLE ledger_events (
          sequence INTEGER PRIMARY KEY AUTOINCREMENT,
          event_id TEXT NOT NULL UNIQUE,
          event_type TEXT NOT NULL,
          entry_id TEXT REFERENCES ledger_entries(id) ON DELETE SET NULL,
          meeting_path TEXT,
          occurred_at TEXT NOT NULL,
          run_id TEXT,
          payload_json TEXT NOT NULL
        );
        CREATE INDEX idx_ledger_events_entry ON ledger_events(entry_id, sequence DESC);
        CREATE INDEX idx_ledger_events_meeting ON ledger_events(meeting_path, sequence DESC);
        CREATE INDEX idx_ledger_events_at ON ledger_events(occurred_at DESC);

        CREATE TABLE ledger_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE VIRTUAL TABLE ledger_entries_fts USING fts5(
          id UNINDEXED,
          action,
          context,
          owner,
          opened_from,
          tokenize='porter unicode61'
        );

        CREATE TRIGGER validate_ledger_status_transition
        BEFORE UPDATE OF status ON ledger_entries
        WHEN OLD.status <> NEW.status AND NOT (
          (OLD.status='open' AND NEW.status IN ('carried','resolved','dropped')) OR
          (OLD.status='carried' AND NEW.status IN ('open','resolved','dropped')) OR
          (OLD.status='dropped' AND NEW.status='open')
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid ledger status transition');
        END;
      `);
      this.db.pragma(`user_version = ${DB_SCHEMA_VERSION}`);
      return;
    }

    let current = version;
    if (current === 1) {
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS validate_ledger_status_transition
        BEFORE UPDATE OF status ON ledger_entries
        WHEN OLD.status <> NEW.status AND NOT (
          (OLD.status='open' AND NEW.status IN ('carried','resolved','dropped')) OR
          (OLD.status='carried' AND NEW.status IN ('open','resolved','dropped')) OR
          (OLD.status='dropped' AND NEW.status='open')
        )
        BEGIN
          SELECT RAISE(ABORT, 'invalid ledger status transition');
        END;
      `);
      this.db.pragma("user_version = 2");
      current = 2;
    }
    if (current === 2) {
      this.db.transaction(() => {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS meeting_extraction_jobs (
            meeting_path TEXT PRIMARY KEY,
            granola_id TEXT,
            status TEXT NOT NULL CHECK(status IN ('queued','running','retry_wait','complete','failed')),
            last_enqueued_by TEXT NOT NULL CHECK(last_enqueued_by IN ('trigger','nightly','manual')),
            settled_at TEXT,
            queued_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count >= 0),
            lease_owner TEXT,
            lease_expires_at TEXT,
            next_retry_at TEXT,
            last_error TEXT,
            completed_at TEXT,
            completion_run_id TEXT,
            CHECK(status <> 'running' OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL))
          );
          CREATE INDEX IF NOT EXISTS idx_meeting_extraction_jobs_status_retry
            ON meeting_extraction_jobs(status, next_retry_at, queued_at);
          CREATE INDEX IF NOT EXISTS idx_meeting_extraction_jobs_lease
            ON meeting_extraction_jobs(status, lease_expires_at);
        `);
        this.db.pragma(`user_version = ${DB_SCHEMA_VERSION}`);
      })();
    }
  }

  private eventPayload(before: LedgerEntry | null, after: LedgerEntry): Record<string, unknown> {
    const select = (entry: LedgerEntry | null) => entry ? {
      status: entry.status,
      owner: entry.owner,
      action: entry.action,
      task_id: entry.task_id ?? null,
      verdict: entry.verdict ?? null,
      sightings: entry.sightings.length,
      status_history: entry.status_history.length,
    } : null;
    return { before: select(before), after: select(after) };
  }

  quickCheck(): string {
    const row = this.db.prepare("PRAGMA quick_check").get() as { quick_check: string };
    return row.quick_check;
  }

  integrityCheck(): string {
    const row = this.db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
    return row.integrity_check;
  }

  writeBlockReason(): string | null {
    const row = this.db.prepare("SELECT value FROM ledger_meta WHERE key = 'write_blocked'").get() as { value: string } | undefined;
    return row?.value ?? null;
  }

  blockWrites(reason: string, at = new Date().toISOString()): void {
    this.db.prepare(`
      INSERT INTO ledger_meta(key, value, updated_at) VALUES ('write_blocked', ?, ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at
    `).run(reason.slice(0, 1000), at);
  }

  clearWriteBlock(): void {
    this.db.prepare("DELETE FROM ledger_meta WHERE key = 'write_blocked'").run();
  }

  private assertWritable(): void {
    const blocked = this.writeBlockReason();
    if (blocked) throw new Error(`meeting ledger writes are blocked: ${blocked}`);
    const check = this.quickCheck();
    if (check !== "ok") {
      this.blockWrites(`quick_check failed before write: ${check}`);
      throw new Error(`meeting ledger quick_check failed before write: ${check}`);
    }
  }

  private writeEntry(entry: LedgerEntry, updatedAt: string): void {
    validateEntry(entry);
    const verdict = entry.verdict;
    this.db.prepare(`
      INSERT INTO ledger_entries (
        id, action, normalized_action, owner, due, context, confidence, source, status, opened_at, opened_from,
        first_escalated_at, task_id, verdict_action, verdict_at, verdict_note, last_seen_at, updated_at
      ) VALUES (
        @id, @action, @normalized_action, @owner, @due, @context, @confidence, @source, @status, @opened_at, @opened_from,
        @first_escalated_at, @task_id, @verdict_action, @verdict_at, @verdict_note, @last_seen_at, @updated_at
      ) ON CONFLICT(id) DO UPDATE SET
        action=excluded.action, normalized_action=excluded.normalized_action,
        owner=excluded.owner, due=excluded.due, context=excluded.context,
        confidence=excluded.confidence, source=excluded.source, status=excluded.status,
        opened_at=excluded.opened_at, opened_from=excluded.opened_from,
        first_escalated_at=excluded.first_escalated_at, task_id=excluded.task_id,
        verdict_action=excluded.verdict_action, verdict_at=excluded.verdict_at,
        verdict_note=excluded.verdict_note, last_seen_at=excluded.last_seen_at, updated_at=excluded.updated_at
    `).run({
      id: entry.id,
      action: entry.action,
      normalized_action: normalizeAction(entry.action),
      owner: entry.owner,
      due: entry.due ?? null,
      context: entry.context ?? null,
      confidence: entry.confidence,
      source: entry.source,
      status: entry.status,
      opened_at: entry.opened_at,
      opened_from: entry.opened_from,
      first_escalated_at: entry.first_escalated_at ?? null,
      task_id: entry.task_id ?? null,
      verdict_action: verdict?.verdict ?? null,
      verdict_at: verdict?.at ?? null,
      verdict_note: verdict?.note ?? null,
      last_seen_at: latestSeen(entry),
      updated_at: updatedAt,
    });

    for (const table of ["ledger_citations", "ledger_sightings", "ledger_status_history"]) {
      this.db.prepare(`DELETE FROM ${table} WHERE entry_id = ?`).run(entry.id);
    }
    const citation = this.db.prepare(`
      INSERT INTO ledger_citations(entry_id, position, source, citation_date, anchor) VALUES (?, ?, ?, ?, ?)
    `);
    entry.citations.forEach((value, index) => citation.run(entry.id, index, value.source, value.date ?? null, value.anchor ?? null));
    const sighting = this.db.prepare(`
      INSERT INTO ledger_sightings(entry_id, position, sighted_at, meeting, quote) VALUES (?, ?, ?, ?, ?)
    `);
    entry.sightings.forEach((value, index) => sighting.run(entry.id, index, value.at, value.meeting, value.quote ?? null));
    const history = this.db.prepare(`
      INSERT INTO ledger_status_history(entry_id, position, changed_at, from_status, to_status, evidence)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    entry.status_history.forEach((value, index) => history.run(
      entry.id, index, value.at, value.from, value.to, value.evidence ?? null,
    ));
    this.db.prepare("DELETE FROM ledger_entries_fts WHERE id = ?").run(entry.id);
    this.db.prepare(`
      INSERT INTO ledger_entries_fts(id, action, context, owner, opened_from) VALUES (?, ?, ?, ?, ?)
    `).run(entry.id, entry.action, entry.context ?? "", entry.owner, entry.opened_from);
  }

  putEntry(
    entry: LedgerEntry,
    event: { type: string; at: string; runId?: string; meeting?: string; payload?: Record<string, unknown> },
  ): void {
    this.assertWritable();
    this.db.transaction(() => {
      const before = this.getEntry(entry.id);
      this.writeEntry(entry, event.at);
      this.appendEvent({
        eventType: event.type,
        entryId: entry.id,
        meeting: event.meeting ?? entry.opened_from,
        at: event.at,
        runId: event.runId,
        payload: { ...this.eventPayload(before, entry), ...(event.payload ?? {}) },
      });
    })();
  }

  putEntries(entries: LedgerEntry[], input: { type: string; at: string; runId?: string }): void {
    this.assertWritable();
    this.db.transaction(() => {
      for (const entry of entries) {
        const before = this.getEntry(entry.id);
        this.writeEntry(entry, input.at);
        this.appendEvent({
          eventType: input.type,
          entryId: entry.id,
          meeting: entry.opened_from,
          at: input.at,
          runId: input.runId,
          payload: this.eventPayload(before, entry),
        });
      }
    })();
  }

  applyMeeting(input: {
    meeting: string;
    processedAt: string;
    entries: LedgerEntry[];
    summary?: { date: string; summary: string };
    runId?: string;
    eventType?: string;
  }): void {
    this.assertWritable();
    this.db.transaction(() => {
      for (const entry of input.entries) {
        const before = this.getEntry(entry.id);
        this.writeEntry(entry, input.processedAt);
        this.appendEvent({
          eventType: input.eventType ?? "meeting-entry-updated",
          entryId: entry.id,
          meeting: input.meeting,
          at: input.processedAt,
          runId: input.runId,
          payload: this.eventPayload(before, entry),
        });
      }
      if (input.summary) {
        this.upsertMeetingSummary({
          meeting: input.meeting,
          date: input.summary.date,
          summary: input.summary.summary,
          updated_at: input.processedAt,
        });
      }
      this.markProcessed(input.meeting, input.processedAt);
      this.appendEvent({
        eventType: "meeting-processed",
        meeting: input.meeting,
        at: input.processedAt,
        runId: input.runId,
        payload: { entries: input.entries.map((entry) => entry.id), summary: Boolean(input.summary) },
      });
    })();
  }

  private appendEvent(input: {
    eventType: string;
    entryId?: string;
    meeting?: string;
    at: string;
    runId?: string;
    payload: Record<string, unknown>;
    eventId?: string;
  }): void {
    const eventId = input.eventId ?? `${input.eventType}:${input.entryId ?? input.meeting ?? "ledger"}:${input.at}:${hashId(JSON.stringify(input.payload), 10)}`;
    this.db.prepare(`
      INSERT OR IGNORE INTO ledger_events(event_id, event_type, entry_id, meeting_path, occurred_at, run_id, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      eventId,
      input.eventType,
      input.entryId ?? null,
      input.meeting ?? null,
      input.at,
      input.runId ?? null,
      JSON.stringify(input.payload),
    );
  }

  recordEvent(input: {
    eventType: string;
    entryId?: string;
    meeting?: string;
    at: string;
    runId?: string;
    payload?: Record<string, unknown>;
    eventId?: string;
  }): void {
    this.assertWritable();
    this.appendEvent({ ...input, payload: input.payload ?? {} });
  }

  beginExtractionRun(input: { id: string; startedAt: string; attempted?: number }): void {
    this.assertWritable();
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO extraction_runs(id, started_at, status, attempted) VALUES (?, ?, 'active', ?)
      `).run(input.id, input.startedAt, input.attempted ?? 0);
      this.appendEvent({ eventType: "extraction-run-started", at: input.startedAt, runId: input.id, payload: { attempted: input.attempted ?? 0 } });
    })();
  }

  finishExtractionRun(input: {
    id: string;
    finishedAt: string;
    status: "succeeded" | "partial" | "failed";
    attempted: number;
    succeeded: number;
    contextTokens: number;
    error?: string;
  }): void {
    this.assertWritable();
    this.db.transaction(() => {
      const result = this.db.prepare(`
        UPDATE extraction_runs SET finished_at=?, status=?, attempted=?, succeeded=?, error=?, context_tokens=? WHERE id=?
      `).run(input.finishedAt, input.status, input.attempted, input.succeeded, input.error ?? null, input.contextTokens, input.id);
      if (!result.changes) throw new Error(`extraction run not found: ${input.id}`);
      this.appendEvent({
        eventType: "extraction-run-finished", at: input.finishedAt, runId: input.id,
        payload: { status: input.status, attempted: input.attempted, succeeded: input.succeeded, context_tokens: input.contextTokens, error: input.error ?? null },
      });
    })();
  }

  getExtractionJob(meetingPath: string): MeetingExtractionJob | null {
    return (this.db.prepare("SELECT * FROM meeting_extraction_jobs WHERE meeting_path = ?")
      .get(meetingPath) as ExtractionJobRow | undefined) ?? null;
  }

  extractionJobs(): MeetingExtractionJob[] {
    return this.db.prepare("SELECT * FROM meeting_extraction_jobs ORDER BY queued_at, meeting_path").all() as ExtractionJobRow[];
  }

  enqueueExtractionJob(input: {
    meetingPath: string;
    source: MeetingExtractionJobSource;
    queuedAt: string;
    granolaId?: string;
    settledAt?: string;
    forceFailed?: boolean;
  }): MeetingExtractionJob | null {
    if (!input.meetingPath.startsWith("meetings/")) throw new Error(`invalid meeting extraction path: ${input.meetingPath}`);
    assertIso(input.queuedAt, "meeting extraction queuedAt");
    if (input.settledAt) assertIso(input.settledAt, "meeting extraction settledAt");
    this.assertWritable();
    return this.db.transaction(() => {
      const existing = this.getExtractionJob(input.meetingPath);
      if (!existing && this.isProcessed(input.meetingPath)) return null;
      if (existing) {
        if (existing.status !== "failed" || !input.forceFailed) return existing;
        this.db.prepare(`
          UPDATE meeting_extraction_jobs SET
            status='queued', last_enqueued_by=?, granola_id=COALESCE(?, granola_id),
            settled_at=COALESCE(?, settled_at), queued_at=?, updated_at=?, attempt_count=0,
            lease_owner=NULL, lease_expires_at=NULL, next_retry_at=NULL, last_error=NULL,
            completed_at=NULL, completion_run_id=NULL
          WHERE meeting_path=?
        `).run(input.source, input.granolaId ?? null, input.settledAt ?? null, input.queuedAt, input.queuedAt, input.meetingPath);
        this.appendEvent({
          eventType: "meeting-extraction-job-requeued",
          meeting: input.meetingPath,
          at: input.queuedAt,
          payload: { source: input.source, prior_status: existing.status, forced: true },
        });
        return this.getExtractionJob(input.meetingPath)!;
      }
      this.db.prepare(`
        INSERT INTO meeting_extraction_jobs(
          meeting_path, granola_id, status, last_enqueued_by, settled_at, queued_at, updated_at
        ) VALUES (?, ?, 'queued', ?, ?, ?, ?)
      `).run(
        input.meetingPath,
        input.granolaId ?? null,
        input.source,
        input.settledAt ?? null,
        input.queuedAt,
        input.queuedAt,
      );
      this.appendEvent({
        eventType: "meeting-extraction-job-enqueued",
        meeting: input.meetingPath,
        at: input.queuedAt,
        payload: { source: input.source, granola_id: input.granolaId ?? null, settled_at: input.settledAt ?? null },
      });
      return this.getExtractionJob(input.meetingPath)!;
    })();
  }

  claimExtractionJobs(input: {
    owner: string;
    now: string;
    leaseMs: number;
    limit?: number;
  }): MeetingExtractionJob[] {
    if (!input.owner.trim()) throw new Error("meeting extraction lease owner is required");
    assertIso(input.now, "meeting extraction claim time");
    const leaseMs = Math.max(10_000, Math.round(input.leaseMs));
    const limit = Math.max(1, Math.min(25, input.limit ?? 10));
    const leaseExpiresAt = new Date(Date.parse(input.now) + leaseMs).toISOString();
    this.assertWritable();
    return this.db.transaction(() => {
      const expired = this.db.prepare(`
        SELECT * FROM meeting_extraction_jobs
        WHERE status='running' AND lease_expires_at <= ? ORDER BY lease_expires_at, meeting_path
      `).all(input.now) as ExtractionJobRow[];
      for (const job of expired) {
        this.db.prepare(`
          UPDATE meeting_extraction_jobs SET status='retry_wait', updated_at=?, lease_owner=NULL,
            lease_expires_at=NULL, next_retry_at=?, last_error=? WHERE meeting_path=?
        `).run(input.now, input.now, `worker lease expired (${job.lease_owner ?? "unknown"})`, job.meeting_path);
        this.appendEvent({
          eventType: "meeting-extraction-lease-expired",
          meeting: job.meeting_path,
          at: input.now,
          payload: { prior_owner: job.lease_owner, prior_expiry: job.lease_expires_at, attempt: job.attempt_count },
        });
      }
      this.db.prepare(`
        UPDATE meeting_extraction_jobs SET status='queued', updated_at=?, next_retry_at=NULL
        WHERE status='retry_wait' AND next_retry_at <= ?
      `).run(input.now, input.now);
      const due = this.db.prepare(`
        SELECT meeting_path FROM meeting_extraction_jobs
        WHERE status='queued' ORDER BY queued_at, meeting_path LIMIT ?
      `).all(limit) as Array<{ meeting_path: string }>;
      for (const { meeting_path } of due) {
        this.db.prepare(`
          UPDATE meeting_extraction_jobs SET status='running', updated_at=?, attempt_count=attempt_count+1,
            lease_owner=?, lease_expires_at=?, next_retry_at=NULL
          WHERE meeting_path=? AND status='queued'
        `).run(input.now, input.owner, leaseExpiresAt, meeting_path);
        const claimed = this.getExtractionJob(meeting_path)!;
        this.appendEvent({
          eventType: "meeting-extraction-job-claimed",
          meeting: meeting_path,
          at: input.now,
          payload: { owner: input.owner, lease_expires_at: leaseExpiresAt, attempt: claimed.attempt_count },
        });
      }
      return due.map(({ meeting_path }) => this.getExtractionJob(meeting_path)!).filter((job) => job.lease_owner === input.owner);
    })();
  }

  renewExtractionJobLeases(input: {
    meetingPaths: string[];
    owner: string;
    now: string;
    leaseMs: number;
  }): number {
    if (!input.meetingPaths.length) return 0;
    assertIso(input.now, "meeting extraction lease renewal time");
    this.assertWritable();
    const expiresAt = new Date(Date.parse(input.now) + Math.max(10_000, Math.round(input.leaseMs))).toISOString();
    const placeholders = input.meetingPaths.map(() => "?").join(",");
    return this.db.prepare(`
      UPDATE meeting_extraction_jobs SET lease_expires_at=?, updated_at=?
      WHERE status='running' AND lease_owner=? AND meeting_path IN (${placeholders})
    `).run(expiresAt, input.now, input.owner, ...input.meetingPaths).changes;
  }

  completeExtractionJob(input: {
    meetingPath: string;
    owner?: string;
    completedAt: string;
    runId?: string;
  }): boolean {
    assertIso(input.completedAt, "meeting extraction completion time");
    this.assertWritable();
    return this.db.transaction(() => {
      const existing = this.getExtractionJob(input.meetingPath);
      if (!existing) return false;
      if (existing.status === "complete") return true;
      if (input.owner && existing.lease_owner !== input.owner) return false;
      this.db.prepare(`
        UPDATE meeting_extraction_jobs SET status='complete', updated_at=?, lease_owner=NULL,
          lease_expires_at=NULL, next_retry_at=NULL, last_error=NULL, completed_at=?, completion_run_id=?
        WHERE meeting_path=?
      `).run(input.completedAt, input.completedAt, input.runId ?? null, input.meetingPath);
      this.appendEvent({
        eventType: "meeting-extraction-job-completed",
        meeting: input.meetingPath,
        at: input.completedAt,
        runId: input.runId,
        payload: { attempt: existing.attempt_count, owner: input.owner ?? existing.lease_owner },
      });
      return true;
    })();
  }

  retryExtractionJob(input: {
    meetingPath: string;
    owner: string;
    failedAt: string;
    nextRetryAt: string;
    error: string;
    maxAttempts: number;
  }): "retry_wait" | "failed" | null {
    assertIso(input.failedAt, "meeting extraction failure time");
    assertIso(input.nextRetryAt, "meeting extraction retry time");
    this.assertWritable();
    return this.db.transaction(() => {
      const existing = this.getExtractionJob(input.meetingPath);
      if (!existing || existing.status !== "running" || existing.lease_owner !== input.owner) return null;
      const status = existing.attempt_count >= Math.max(1, input.maxAttempts) ? "failed" : "retry_wait";
      this.db.prepare(`
        UPDATE meeting_extraction_jobs SET status=?, updated_at=?, lease_owner=NULL, lease_expires_at=NULL,
          next_retry_at=?, last_error=?, completed_at=NULL, completion_run_id=NULL WHERE meeting_path=?
      `).run(
        status,
        input.failedAt,
        status === "retry_wait" ? input.nextRetryAt : null,
        input.error.slice(0, 2_000),
        input.meetingPath,
      );
      this.appendEvent({
        eventType: status === "failed" ? "meeting-extraction-job-failed" : "meeting-extraction-job-retry-scheduled",
        meeting: input.meetingPath,
        at: input.failedAt,
        payload: {
          attempt: existing.attempt_count,
          max_attempts: input.maxAttempts,
          next_retry_at: status === "retry_wait" ? input.nextRetryAt : null,
          error: input.error.slice(0, 500),
        },
      });
      return status;
    })();
  }

  extractionQueueHealth(): MeetingExtractionQueueHealth {
    const counts = Object.fromEntries((this.db.prepare(`
      SELECT status, COUNT(*) AS count FROM meeting_extraction_jobs GROUP BY status
    `).all() as Array<{ status: MeetingExtractionJobStatus; count: number }>).map((row) => [row.status, row.count])) as Partial<Record<MeetingExtractionJobStatus, number>>;
    const oldest = this.db.prepare(`
      SELECT MIN(queued_at) AS at FROM meeting_extraction_jobs WHERE status IN ('queued','running','retry_wait')
    `).get() as { at: string | null };
    const nextRetry = this.db.prepare(`
      SELECT MIN(next_retry_at) AS at FROM meeting_extraction_jobs WHERE status='retry_wait'
    `).get() as { at: string | null };
    const active = this.db.prepare(`
      SELECT * FROM meeting_extraction_jobs WHERE status='running' ORDER BY queued_at, meeting_path
    `).all() as ExtractionJobRow[];
    const error = this.db.prepare(`
      SELECT meeting_path, last_error AS error, updated_at AS at FROM meeting_extraction_jobs
      WHERE last_error IS NOT NULL ORDER BY updated_at DESC LIMIT 1
    `).get() as { meeting_path: string; error: string; at: string } | undefined;
    const queued = counts.queued ?? 0;
    const running = counts.running ?? 0;
    const retryWait = counts.retry_wait ?? 0;
    return {
      depth: queued + running + retryWait,
      queued,
      running,
      retry_wait: retryWait,
      failed: counts.failed ?? 0,
      complete: counts.complete ?? 0,
      oldest_queued_at: oldest.at,
      next_retry_at: nextRetry.at,
      active,
      last_error: error ?? null,
    };
  }

  private hydrateRows(rows: EntryRow[]): LedgerEntry[] {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => "?").join(",");
    const citations = this.db.prepare(`
      SELECT entry_id, source, citation_date AS date, anchor FROM ledger_citations
      WHERE entry_id IN (${placeholders}) ORDER BY entry_id, position
    `).all(...ids) as Array<CitationRow & { entry_id: string }>;
    const sightings = this.db.prepare(`
      SELECT entry_id, sighted_at AS at, meeting, quote FROM ledger_sightings
      WHERE entry_id IN (${placeholders}) ORDER BY entry_id, position
    `).all(...ids) as Array<SightingRow & { entry_id: string }>;
    const history = this.db.prepare(`
      SELECT entry_id, changed_at AS at, from_status, to_status, evidence FROM ledger_status_history
      WHERE entry_id IN (${placeholders}) ORDER BY entry_id, position
    `).all(...ids) as Array<HistoryRow & { entry_id: string }>;
    const citationMap = new Map<string, CitationRow[]>();
    const sightingMap = new Map<string, SightingRow[]>();
    const historyMap = new Map<string, HistoryRow[]>();
    for (const row of citations) (citationMap.get(row.entry_id) ?? citationMap.set(row.entry_id, []).get(row.entry_id)!).push(row);
    for (const row of sightings) (sightingMap.get(row.entry_id) ?? sightingMap.set(row.entry_id, []).get(row.entry_id)!).push(row);
    for (const row of history) (historyMap.get(row.entry_id) ?? historyMap.set(row.entry_id, []).get(row.entry_id)!).push(row);
    return rows.map((row) => ({
      id: row.id,
      action: row.action,
      owner: row.owner,
      ...(row.due ? { due: row.due } : {}),
      ...(row.context ? { context: row.context } : {}),
      citations: (citationMap.get(row.id) ?? []).map((citation) => ({
        source: citation.source,
        ...(citation.date ? { date: citation.date } : {}),
        ...(citation.anchor ? { anchor: citation.anchor } : {}),
      })),
      confidence: row.confidence,
      source: row.source,
      status: row.status,
      opened_at: row.opened_at,
      opened_from: row.opened_from,
      status_history: (historyMap.get(row.id) ?? []).map((value) => ({
        at: value.at,
        from: value.from_status,
        to: value.to_status,
        ...(value.evidence ? { evidence: value.evidence } : {}),
      })),
      sightings: (sightingMap.get(row.id) ?? []).map((value) => ({
        at: value.at,
        meeting: value.meeting,
        ...(value.quote ? { quote: value.quote } : {}),
      })),
      ...(row.first_escalated_at ? { first_escalated_at: row.first_escalated_at } : {}),
      ...(row.task_id ? { task_id: row.task_id } : {}),
      ...(row.verdict_action && row.verdict_at
        ? { verdict: { verdict: row.verdict_action, at: row.verdict_at, ...(row.verdict_note ? { note: row.verdict_note } : {}) } }
        : {}),
    }));
  }

  getEntry(id: string): LedgerEntry | null {
    const row = this.db.prepare("SELECT * FROM ledger_entries WHERE id = ?").get(id) as EntryRow | undefined;
    return row ? this.hydrateRows([row])[0] : null;
  }

  getEntries(ids: string[]): LedgerEntry[] {
    if (!ids.length) return [];
    const rows = this.db.prepare(`SELECT * FROM ledger_entries WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids) as EntryRow[];
    const byId = new Map(this.hydrateRows(rows).map((entry) => [entry.id, entry]));
    return ids.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []);
  }

  entriesForMeeting(meeting: string): LedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT DISTINCT e.* FROM ledger_entries e
      LEFT JOIN ledger_citations c ON c.entry_id=e.id
      LEFT JOIN ledger_sightings s ON s.entry_id=e.id
      WHERE e.opened_from=? OR c.source=? OR s.meeting=?
      ORDER BY e.id
    `).all(meeting, meeting, meeting) as EntryRow[];
    return this.hydrateRows(rows);
  }

  readAll(): Ledger {
    const rows = this.db.prepare("SELECT * FROM ledger_entries ORDER BY id").all() as EntryRow[];
    return { version: 1, entries: Object.fromEntries(this.hydrateRows(rows).map((entry) => [entry.id, entry])) };
  }

  openEntries(): LedgerEntry[] {
    const rows = this.db.prepare("SELECT * FROM ledger_entries WHERE status IN ('open','carried') ORDER BY opened_at, id").all() as EntryRow[];
    return this.hydrateRows(rows);
  }

  findByNormalizedAction(action: string): LedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries WHERE normalized_action = ? ORDER BY last_seen_at DESC, id DESC
    `).all(normalizeAction(action)) as EntryRow[];
    return this.hydrateRows(rows);
  }

  recentlyDismissed(now: string, days = 30): LedgerEntry[] {
    const cutoff = new Date(Date.parse(now) - days * 86_400_000).toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries
      WHERE status='dropped' AND verdict_action='dismiss' AND COALESCE(verdict_at, updated_at) >= ?
      ORDER BY COALESCE(verdict_at, updated_at) DESC, id DESC
    `).all(cutoff) as EntryRow[];
    return this.hydrateRows(rows);
  }

  escalationCandidates(today: string, recentDays = 3): LedgerEntry[] {
    const cutoff = new Date(Date.parse(`${today}T23:59:59.999Z`) - recentDays * 86_400_000).toISOString().slice(0, 10);
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries
      WHERE status IN ('open','carried') AND verdict_action IS NULL AND owner NOT LIKE 'other:%'
        AND (first_escalated_at IS NOT NULL OR SUBSTR(opened_from, 10, 10) >= ?)
      ORDER BY opened_at, id
    `).all(cutoff) as EntryRow[];
    return this.hydrateRows(rows);
  }

  acceptedAging(now: string, minimumDays = 7): Array<{ entry: LedgerEntry; age: number }> {
    const cutoff = new Date(Date.parse(now) - minimumDays * 86_400_000).toISOString();
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries
      WHERE status IN ('open','carried')
        AND verdict_action IN ('approve','assign_to_me','assign_to_agent')
        AND verdict_at <= ?
      ORDER BY verdict_at, id
    `).all(cutoff) as EntryRow[];
    return this.hydrateRows(rows).map((entry) => ({
      entry,
      age: Math.floor((Date.parse(now) - Date.parse(entry.verdict!.at)) / 86_400_000),
    }));
  }

  goalsContext(until: string, limit = 80): LedgerEntry[] {
    const rows = this.db.prepare(`
      SELECT * FROM ledger_entries
      WHERE opened_at <= ? AND status IN ('open','carried')
      ORDER BY
        CASE WHEN task_id IS NOT NULL AND verdict_action IS NULL THEN 0
             WHEN verdict_action IN ('approve','assign_to_me','assign_to_agent') THEN 1
             ELSE 2 END,
        last_seen_at DESC, id DESC
      LIMIT ?
    `).all(`${until}T23:59:59.999Z`, limit) as EntryRow[];
    return this.hydrateRows(rows);
  }

  nextEntryId(meetingDate: string): string {
    const prefix = `ma-${meetingDate}-`;
    const row = this.db.prepare(`
      SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) AS max_sequence FROM ledger_entries WHERE id LIKE ?
    `).get(prefix.length + 1, `${prefix}%`) as { max_sequence: number | null };
    return `${prefix}${String((row.max_sequence ?? 0) + 1).padStart(3, "0")}`;
  }

  upsertMeetingSummary(record: MeetingSummaryRecord): void {
    this.db.prepare(`
      INSERT INTO meeting_summaries(meeting, meeting_date, summary, updated_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(meeting) DO UPDATE SET meeting_date=excluded.meeting_date,
        summary=excluded.summary, updated_at=excluded.updated_at
    `).run(record.meeting, record.date, record.summary, record.updated_at);
  }

  meetingSummaries(dateFrom?: string, dateTo?: string): MeetingSummaryRecord[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (dateFrom) { clauses.push("meeting_date >= ?"); values.push(dateFrom); }
    if (dateTo) { clauses.push("meeting_date <= ?"); values.push(dateTo); }
    return this.db.prepare(`
      SELECT meeting, meeting_date AS date, summary, updated_at FROM meeting_summaries
      ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY meeting_date DESC, meeting
    `).all(...values) as MeetingSummaryRecord[];
  }

  meetingSummary(meeting: string): MeetingSummaryRecord | null {
    return (this.db.prepare(`
      SELECT meeting, meeting_date AS date, summary, updated_at
      FROM meeting_summaries WHERE meeting = ?
    `).get(meeting) as MeetingSummaryRecord | undefined) ?? null;
  }

  markProcessed(meeting: string, processedAt: string): void {
    this.db.prepare(`
      INSERT INTO processed_meetings(meeting, processed_at) VALUES (?, ?)
      ON CONFLICT(meeting) DO UPDATE SET processed_at=excluded.processed_at
    `).run(meeting, processedAt);
  }

  processedMeetings(): Record<string, string> {
    const rows = this.db.prepare("SELECT meeting, processed_at FROM processed_meetings").all() as Array<{ meeting: string; processed_at: string }>;
    return Object.fromEntries(rows.map((row) => [row.meeting, row.processed_at]));
  }

  isProcessed(meeting: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM processed_meetings WHERE meeting = ?").get(meeting));
  }

  importLegacy(input: {
    ledger: Ledger;
    summaries?: Record<string, { date: string; summary: string }>;
    processed?: Record<string, string>;
    importedAt: string;
    sourceFingerprint: string;
  }): { imported: boolean; entries: number } {
    const prior = this.db.prepare("SELECT value FROM ledger_meta WHERE key = 'legacy_fingerprint'").get() as { value: string } | undefined;
    if (prior?.value === input.sourceFingerprint) return { imported: false, entries: Object.keys(input.ledger.entries).length };
    const existing = Number((this.db.prepare("SELECT COUNT(*) AS count FROM ledger_entries").get() as { count: number }).count);
    if (existing > 0) throw new Error("meeting ledger already contains entries with a different legacy fingerprint");
    this.db.transaction(() => {
      for (const entry of Object.values(input.ledger.entries)) this.writeEntry(entry, input.importedAt);
      for (const [meeting, summary] of Object.entries(input.summaries ?? {})) {
        this.upsertMeetingSummary({ meeting, date: summary.date, summary: summary.summary, updated_at: input.importedAt });
      }
      for (const [meeting, at] of Object.entries(input.processed ?? {})) this.markProcessed(meeting, at);
      this.appendEvent({
        eventType: "legacy-import",
        at: input.importedAt,
        payload: { source_fingerprint: input.sourceFingerprint, entries: Object.keys(input.ledger.entries).length },
        eventId: `legacy-import:${input.sourceFingerprint}`,
      });
      this.db.prepare(`
        INSERT INTO ledger_meta(key, value, updated_at) VALUES ('legacy_fingerprint', ?, ?)
      `).run(input.sourceFingerprint, input.importedAt);
    })();
    return { imported: true, entries: Object.keys(input.ledger.entries).length };
  }

  /** Rebuild a pre-cutover shadow projection from a newer legacy snapshot. Never call after the
   * storage marker is SQLite; canonical event history is append-only from that point forward. */
  resetLegacyProjection(): void {
    this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM ledger_events;
        DELETE FROM ledger_entries_fts;
        DELETE FROM ledger_entries;
        DELETE FROM meeting_summaries;
        DELETE FROM processed_meetings;
        DELETE FROM extraction_runs;
        DELETE FROM meeting_extraction_jobs;
        DELETE FROM ledger_meta;
      `);
    })();
  }

  eventsForEntry(id: string, limit = 100): LedgerEventRecord[] {
    const rows = this.db.prepare(`
      SELECT sequence, event_id, event_type, entry_id, meeting_path, occurred_at, run_id, payload_json
      FROM ledger_events WHERE entry_id = ? ORDER BY sequence DESC LIMIT ?
    `).all(id, limit) as Array<Omit<LedgerEventRecord, "payload"> & { payload_json: string }>;
    return rows.map(({ payload_json, ...row }) => ({ ...row, payload: JSON.parse(payload_json) as Record<string, unknown> }));
  }

  latestEvent(eventType?: string): LedgerEventRecord | null {
    const row = this.db.prepare(`
      SELECT sequence, event_id, event_type, entry_id, meeting_path, occurred_at, run_id, payload_json
      FROM ledger_events ${eventType ? "WHERE event_type = ?" : ""} ORDER BY sequence DESC LIMIT 1
    `).get(...(eventType ? [eventType] : [])) as (Omit<LedgerEventRecord, "payload"> & { payload_json: string }) | undefined;
    if (!row) return null;
    const { payload_json, ...event } = row;
    return { ...event, payload: JSON.parse(payload_json) as Record<string, unknown> };
  }

  counts(): MeetingLedgerCounts {
    const row = this.db.prepare(`
      SELECT
        COUNT(*) AS total,
        COALESCE(SUM(status='open'), 0) AS open,
        COALESCE(SUM(status='carried'), 0) AS carried,
        COALESCE(SUM(status='resolved'), 0) AS resolved,
        COALESCE(SUM(status='dropped'), 0) AS dropped,
        COALESCE(SUM(task_id IS NULL AND verdict_action IS NULL AND first_escalated_at IS NULL AND status IN ('open','carried') AND owner IN ('justin','unclear')), 0) AS latent,
        COALESCE(SUM(task_id IS NOT NULL AND verdict_action IS NULL AND status IN ('open','carried')), 0) AS pending,
        COALESCE(SUM(verdict_action IN ('approve','assign_to_me','assign_to_agent') AND status IN ('open','carried')), 0) AS accepted_open,
        COALESCE(SUM(task_id IS NOT NULL), 0) AS stamped
      FROM ledger_entries
    `).get() as Omit<MeetingLedgerCounts, "event_sequence">;
    const event = this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS sequence FROM ledger_events").get() as { sequence: number };
    return { ...row, event_sequence: event.sequence };
  }

  list(filters: MeetingLedgerListFilters = {}): MeetingLedgerListResult {
    const where: string[] = [];
    const values: Array<string | number> = [];
    if (filters.status) { where.push("e.status = ?"); values.push(filters.status); }
    if (filters.surface) where.push(`(${surfaceWhere(filters.surface)})`);
    if (filters.owner) { where.push("e.owner = ?"); values.push(filters.owner); }
    if (filters.meeting) { where.push("e.opened_from = ?"); values.push(filters.meeting); }
    if (filters.dateFrom) { where.push("e.last_seen_at >= ?"); values.push(`${filters.dateFrom}T00:00:00.000Z`); }
    if (filters.dateTo) { where.push("e.last_seen_at <= ?"); values.push(`${filters.dateTo}T23:59:59.999Z`); }
    let join = "";
    if (filters.query?.trim()) {
      const terms = filters.query.trim().replace(/[^a-zA-Z0-9]+/g, " ").split(/\s+/).filter(Boolean);
      if (terms.length) {
        join = "JOIN ledger_entries_fts f ON f.id = e.id";
        where.push("ledger_entries_fts MATCH ?");
        values.push(terms.map((term) => `${term}*`).join(" "));
      } else {
        where.push("0");
      }
    }
    const countClause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const pageWhere = [...where];
    const pageValues = [...values];
    if (filters.cursor) {
      const [at, id = ""] = filters.cursor.split("|");
      pageWhere.push("(e.last_seen_at < ? OR (e.last_seen_at = ? AND e.id < ?))");
      pageValues.push(at, at, id);
    }
    const pageClause = pageWhere.length ? `WHERE ${pageWhere.join(" AND ")}` : "";
    const limit = Math.max(1, Math.min(100, filters.limit ?? 50));
    const rows = this.db.prepare(`
      SELECT e.* FROM ledger_entries e ${join} ${pageClause}
      ORDER BY e.last_seen_at DESC, e.id DESC LIMIT ?
    `).all(...pageValues, limit + 1) as EntryRow[];
    const page = rows.slice(0, limit);
    const count = this.db.prepare(`SELECT COUNT(*) AS count FROM ledger_entries e ${join} ${countClause}`).get(...values) as { count: number };
    const statusRows = this.db.prepare("SELECT status, COUNT(*) AS count FROM ledger_entries GROUP BY status").all() as Array<{ status: LedgerStatus; count: number }>;
    const ownerRows = this.db.prepare("SELECT owner, COUNT(*) AS count FROM ledger_entries GROUP BY owner ORDER BY count DESC").all() as Array<{ owner: string; count: number }>;
    const surface = Object.fromEntries((["pending", "accepted", "latent", "observed", "dismissed", "resolved"] as LedgerSurfaceState[]).map((value) => [
      value,
      (this.db.prepare(`SELECT COUNT(*) AS count FROM ledger_entries e WHERE ${surfaceWhere(value)}`).get() as { count: number }).count,
    ])) as Record<LedgerSurfaceState, number>;
    const status = { open: 0, carried: 0, resolved: 0, dropped: 0 };
    for (const value of statusRows) status[value.status] = value.count;
    const last = page.at(-1);
    return {
      items: this.hydrateRows(page),
      next_cursor: rows.length > limit && last ? `${last.last_seen_at}|${last.id}` : null,
      total: count.count,
      facets: { status, surface, owner: Object.fromEntries(ownerRows.map((row) => [row.owner, row.count])) },
    };
  }

  identityContext(input: {
    now: string;
    observations?: string[];
    tokenBudget?: number;
    recentDays?: number;
    dismissedDays?: number;
  }): IdentityContextSelection {
    const recentDays = input.recentDays ?? 30;
    const dismissedDays = input.dismissedDays ?? 30;
    const budget = input.tokenBudget ?? 40_000;
    const recentCutoff = new Date(Date.parse(input.now) - recentDays * 86_400_000).toISOString();
    const dismissedCutoff = new Date(Date.parse(input.now) - dismissedDays * 86_400_000).toISOString();
    const rows = this.db.prepare(`
      SELECT DISTINCT e.* FROM ledger_entries e
      WHERE e.last_seen_at >= ?
         OR (e.task_id IS NOT NULL AND e.verdict_action IS NULL AND e.status IN ('open','carried'))
         OR (e.verdict_action IN ('approve','assign_to_me','assign_to_agent') AND e.status IN ('open','carried'))
         OR (e.verdict_action = 'dismiss' AND COALESCE(e.verdict_at, e.updated_at) >= ?)
      ORDER BY e.last_seen_at DESC, e.id DESC
    `).all(recentCutoff, dismissedCutoff) as EntryRow[];
    const required = this.hydrateRows(rows);
    const requiredIds = new Set(required.map((entry) => entry.id));
    const olderIds: string[] = [];
    for (const observation of input.observations ?? []) {
      const exact = this.db.prepare(`
        SELECT id FROM ledger_entries WHERE normalized_action = ? AND last_seen_at < ?
        ORDER BY last_seen_at DESC LIMIT 20
      `).all(normalizeAction(observation), recentCutoff) as Array<{ id: string }>;
      for (const match of exact) if (!requiredIds.has(match.id) && !olderIds.includes(match.id)) olderIds.push(match.id);
      const query = observation.replace(/[^a-zA-Z0-9 ]/g, " ").split(/\s+/).filter((word) => word.length > 3).slice(0, 12).map((word) => `${word}*`).join(" OR ");
      if (!query) continue;
      const matches = this.db.prepare(`
        SELECT e.id FROM ledger_entries_fts f JOIN ledger_entries e ON e.id=f.id
        WHERE ledger_entries_fts MATCH ? AND e.last_seen_at < ? ORDER BY bm25(ledger_entries_fts) LIMIT 20
      `).all(query, recentCutoff) as Array<{ id: string }>;
      for (const match of matches) if (!requiredIds.has(match.id) && !olderIds.includes(match.id)) olderIds.push(match.id);
    }
    const olderMatches = this.getEntries(olderIds);
    const combined = [...required, ...olderMatches];
    const chunks: LedgerEntry[][] = [];
    let chunk: LedgerEntry[] = [];
    for (const entry of combined) {
      if (chunk.length && tokenEstimate([...chunk, entry]) > budget) {
        chunks.push(chunk);
        chunk = [];
      }
      chunk.push(entry);
    }
    if (chunk.length) chunks.push(chunk);
    return {
      required,
      older_matches: olderMatches,
      estimated_tokens: tokenEstimate(combined),
      chunks,
      complete_recent_window: true,
    };
  }
}
