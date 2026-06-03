import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { getGranolaSyncDbPath } from "./config";
import type {
  GranolaCalendarMatch,
  GranolaDocument,
  GranolaMeetingNoteLink,
  GranolaSyncRunReport,
  GranolaSyncStatus,
} from "./types";

interface DocumentRow {
  id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  granola_url: string | null;
  note_path: string | null;
  transcript_path: string | null;
  calendar_event_id: string | null;
  calendar_ical_uid: string | null;
  calendar_start: string | null;
  calendar_end: string | null;
  calendar_html_link: string | null;
  hilt_calendar_event_id: string | null;
  hilt_calendar_match_method: string | null;
  hilt_calendar_match_confidence: number | null;
  raw_json: string;
  transcript_raw_json: string | null;
  transcript_pending: number;
  last_seen_at: string;
  last_synced_at: string | null;
  error: string | null;
}

interface RunRow {
  id: number;
  mode: string;
  started_at: string;
  finished_at: string | null;
  dry_run: number;
  status: string;
  counts_json: string;
  error: string | null;
  report_path: string | null;
}

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;

export function getGranolaSyncDb(): Database.Database {
  const dbPath = getGranolaSyncDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  ensureGranolaSyncSchema(cachedDb);
  return cachedDb;
}

export function closeGranolaSyncDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
}

export function ensureGranolaSyncSchema(db = getGranolaSyncDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS granola_documents (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT,
      granola_url TEXT,
      note_path TEXT,
      transcript_path TEXT,
      calendar_event_id TEXT,
      calendar_ical_uid TEXT,
      calendar_start TEXT,
      calendar_end TEXT,
      calendar_html_link TEXT,
      hilt_calendar_event_id TEXT,
      hilt_calendar_match_method TEXT,
      hilt_calendar_match_confidence REAL,
      raw_json TEXT NOT NULL,
      transcript_raw_json TEXT,
      transcript_pending INTEGER NOT NULL DEFAULT 0,
      last_seen_at TEXT NOT NULL,
      last_synced_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_granola_documents_hilt_calendar ON granola_documents(hilt_calendar_event_id);
    CREATE INDEX IF NOT EXISTS idx_granola_documents_calendar_uid ON granola_documents(calendar_ical_uid);
    CREATE INDEX IF NOT EXISTS idx_granola_documents_paths ON granola_documents(note_path, transcript_path);

    CREATE TABLE IF NOT EXISTS granola_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mode TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      dry_run INTEGER NOT NULL,
      status TEXT NOT NULL,
      counts_json TEXT NOT NULL,
      error TEXT,
      report_path TEXT
    );
  `);
}

export function upsertGranolaDocument(input: {
  doc: GranolaDocument;
  notePath: string | null;
  transcriptPath: string | null;
  calendarMatch: GranolaCalendarMatch;
  syncedAt: string | null;
  error?: string | null;
}): void {
  const calendar = input.doc.calendarEvent;
  const now = new Date().toISOString();
  getGranolaSyncDb().prepare(`
    INSERT INTO granola_documents (
      id, title, created_at, updated_at, granola_url, note_path, transcript_path,
      calendar_event_id, calendar_ical_uid, calendar_start, calendar_end, calendar_html_link,
      hilt_calendar_event_id, hilt_calendar_match_method, hilt_calendar_match_confidence,
      raw_json, transcript_raw_json, transcript_pending, last_seen_at, last_synced_at, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      created_at = excluded.created_at,
      updated_at = excluded.updated_at,
      granola_url = excluded.granola_url,
      note_path = COALESCE(excluded.note_path, granola_documents.note_path),
      transcript_path = COALESCE(excluded.transcript_path, granola_documents.transcript_path),
      calendar_event_id = excluded.calendar_event_id,
      calendar_ical_uid = excluded.calendar_ical_uid,
      calendar_start = excluded.calendar_start,
      calendar_end = excluded.calendar_end,
      calendar_html_link = excluded.calendar_html_link,
      hilt_calendar_event_id = excluded.hilt_calendar_event_id,
      hilt_calendar_match_method = excluded.hilt_calendar_match_method,
      hilt_calendar_match_confidence = excluded.hilt_calendar_match_confidence,
      raw_json = excluded.raw_json,
      transcript_raw_json = excluded.transcript_raw_json,
      transcript_pending = excluded.transcript_pending,
      last_seen_at = excluded.last_seen_at,
      last_synced_at = COALESCE(excluded.last_synced_at, granola_documents.last_synced_at),
      error = excluded.error
  `).run(
    input.doc.id,
    input.doc.title,
    input.doc.createdAt,
    input.doc.updatedAt,
    input.doc.granolaUrl,
    input.notePath,
    input.transcriptPath,
    calendar?.id ?? null,
    calendar?.iCalUID ?? null,
    calendar?.start ?? null,
    calendar?.end ?? null,
    calendar?.htmlLink ?? null,
    input.calendarMatch.hiltCalendarEventId,
    input.calendarMatch.method,
    input.calendarMatch.confidence,
    JSON.stringify(input.doc.raw),
    input.doc.transcript.length ? JSON.stringify(input.doc.transcript.map((entry) => entry.raw)) : null,
    input.doc.transcript.length ? 0 : 1,
    now,
    input.syncedAt,
    input.error ?? null,
  );
}

export function recordGranolaSyncRun(report: GranolaSyncRunReport, status: "ok" | "blocked" | "error" = "ok"): void {
  getGranolaSyncDb().prepare(`
    INSERT INTO granola_sync_runs (mode, started_at, finished_at, dry_run, status, counts_json, error, report_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    report.mode,
    report.startedAt,
    report.finishedAt,
    report.dryRun ? 1 : 0,
    status,
    JSON.stringify({
      fetched: report.fetched,
      considered: report.considered,
      createdNotes: report.createdNotes,
      createdTranscripts: report.createdTranscripts,
      augmentedNotes: report.augmentedNotes,
      augmentedTranscripts: report.augmentedTranscripts,
      skipped: report.skipped,
      linkedCalendarEvents: report.linkedCalendarEvents,
    }),
    report.errors.join("\n") || null,
    report.compareReportPath,
  );
}

export function listGranolaMeetingNotesForCalendarEventIds(eventIds: string[]): Map<string, GranolaMeetingNoteLink[]> {
  const result = new Map<string, GranolaMeetingNoteLink[]>();
  if (!eventIds.length) return result;
  const rows = getGranolaSyncDb().prepare(`
    SELECT id, title, note_path, transcript_path, granola_url, raw_json, hilt_calendar_event_id,
      hilt_calendar_match_method, hilt_calendar_match_confidence
    FROM granola_documents
    WHERE hilt_calendar_event_id IN (${eventIds.map(() => "?").join(",")})
    ORDER BY COALESCE(created_at, updated_at, last_seen_at) DESC, title ASC
  `).all(...eventIds) as Array<{
    id: string;
    title: string;
    note_path: string | null;
    transcript_path: string | null;
    granola_url: string | null;
    raw_json: string;
    hilt_calendar_event_id: string;
    hilt_calendar_match_method: string | null;
    hilt_calendar_match_confidence: number | null;
  }>;

  for (const row of rows) {
    const items = result.get(row.hilt_calendar_event_id) ?? [];
    items.push({
      granolaId: row.id,
      title: row.title,
      notePath: row.note_path,
      transcriptPath: row.transcript_path,
      granolaUrl: row.granola_url,
      meetingEndCount: granolaMeetingEndCount(row.raw_json),
      calendarMatchMethod: row.hilt_calendar_match_method,
      calendarMatchConfidence: row.hilt_calendar_match_confidence,
    });
    result.set(row.hilt_calendar_event_id, items);
  }
  return result;
}

function granolaMeetingEndCount(rawJson: string): number | null {
  try {
    const raw = JSON.parse(rawJson) as { meeting_end_count?: unknown; meetingEndCount?: unknown };
    const value = raw.meeting_end_count ?? raw.meetingEndCount;
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

export function getGranolaDocumentById(id: string): DocumentRow | null {
  return getGranolaSyncDb().prepare("SELECT * FROM granola_documents WHERE id = ?").get(id) as DocumentRow | undefined ?? null;
}

export function getLastGranolaSeenAt(): string | null {
  const row = getGranolaSyncDb().prepare("SELECT MAX(last_seen_at) AS lastSeenAt FROM granola_documents").get() as { lastSeenAt: string | null } | undefined;
  return row?.lastSeenAt ?? null;
}

export function getGranolaSyncDbStatus(base: Omit<GranolaSyncStatus, "lastRun" | "documents">): GranolaSyncStatus {
  const db = getGranolaSyncDb();
  const lastRun = db.prepare("SELECT * FROM granola_sync_runs ORDER BY id DESC LIMIT 1").get() as RunRow | undefined;
  const stats = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN hilt_calendar_event_id IS NOT NULL THEN 1 ELSE 0 END) AS linkedCalendarEvents,
      SUM(transcript_pending) AS pendingTranscripts,
      MAX(last_synced_at) AS lastSyncedAt,
      MAX(last_seen_at) AS lastSeenAt
    FROM granola_documents
  `).get() as {
    total: number;
    linkedCalendarEvents: number | null;
    pendingTranscripts: number | null;
    lastSyncedAt: string | null;
    lastSeenAt: string | null;
  };

  return {
    ...base,
    lastRun: lastRun ? {
      mode: lastRun.mode,
      startedAt: lastRun.started_at,
      finishedAt: lastRun.finished_at,
      status: lastRun.status,
      dryRun: Boolean(lastRun.dry_run),
      counts: parseJson(lastRun.counts_json, {}),
      error: lastRun.error,
      reportPath: lastRun.report_path,
    } : null,
    documents: {
      total: Number(stats.total || 0),
      linkedCalendarEvents: Number(stats.linkedCalendarEvents || 0),
      pendingTranscripts: Number(stats.pendingTranscripts || 0),
      lastSyncedAt: stats.lastSyncedAt,
      lastSeenAt: stats.lastSeenAt,
    },
  };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
