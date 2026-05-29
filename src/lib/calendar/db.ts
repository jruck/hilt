import * as fs from "fs";
import * as path from "path";
import Database from "better-sqlite3";
import { CALENDAR_SOURCE_CONFIGS, getCalendarDbPath, hashValue, sourceUrl } from "./config";
import { sourcePriority } from "./ics";
import { dedupeJoinLinks } from "./links";
import type {
  CalendarDefinition,
  CalendarEvent,
  CalendarEventInput,
  CalendarFieldCoverage,
  CalendarJoinLink,
  CalendarSource,
} from "./types";

type SqlValue = string | number | null;

interface SourceRow {
  id: string;
  label: string;
  provider_hint: CalendarSource["providerHint"];
  account_hint: string;
  env_key: string;
  url_hash: string | null;
  color: string;
  read_only: number;
  configured: number;
  last_sync_at: string | null;
  last_error: string | null;
  last_fetch_ms: number | null;
  last_event_count: number;
  coverage_json: string | null;
}

interface CalendarRow {
  id: string;
  source_id: string;
  name: string;
  color: string;
  selected: number;
  read_only: number;
}

interface EventRow {
  id: string;
  source_id: string;
  calendar_id: string;
  dedupe_key: string;
  title: string;
  start_at: string;
  end_at: string;
  sort_start: number;
  sort_end: number;
  all_day: number;
  description: string | null;
  location: string | null;
  join_links_json: string;
  attendees_json: string;
  organizer_json: string | null;
  recurrence_json: string;
  status: string | null;
  provider_url: string | null;
  visible: number;
}

let cachedDb: Database.Database | undefined;
let cachedPath: string | undefined;

export function getCalendarDb(): Database.Database {
  const dbPath = getCalendarDbPath();
  if (cachedDb && cachedPath === dbPath) return cachedDb;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  cachedDb = new Database(dbPath);
  cachedPath = dbPath;
  ensureCalendarSchema(cachedDb);
  ensureConfiguredSources(cachedDb);
  return cachedDb;
}

export function closeCalendarDbForTests(): void {
  cachedDb?.close();
  cachedDb = undefined;
  cachedPath = undefined;
}

export function ensureCalendarSchema(db = getCalendarDb()): void {
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS calendar_sources (
      id TEXT PRIMARY KEY,
      label TEXT NOT NULL,
      provider_hint TEXT NOT NULL,
      account_hint TEXT NOT NULL,
      env_key TEXT NOT NULL,
      url_hash TEXT,
      color TEXT NOT NULL,
      read_only INTEGER NOT NULL DEFAULT 1,
      configured INTEGER NOT NULL DEFAULT 0,
      last_sync_at TEXT,
      last_error TEXT,
      last_fetch_ms INTEGER,
      last_event_count INTEGER NOT NULL DEFAULT 0,
      coverage_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_calendars (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      selected INTEGER NOT NULL DEFAULT 1,
      read_only INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL,
      uid TEXT,
      recurrence_id TEXT,
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      start_at TEXT NOT NULL,
      end_at TEXT NOT NULL,
      sort_start INTEGER NOT NULL,
      sort_end INTEGER NOT NULL,
      all_day INTEGER NOT NULL,
      description TEXT,
      location TEXT,
      join_links_json TEXT NOT NULL,
      attendees_json TEXT NOT NULL,
      organizer_json TEXT,
      recurrence_json TEXT NOT NULL,
      status TEXT,
      provider_url TEXT,
      raw_json TEXT NOT NULL,
      visible INTEGER NOT NULL DEFAULT 1,
      hidden_by_id TEXT,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_calendar_events_range ON calendar_events(visible, sort_start, sort_end);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_dedupe ON calendar_events(dedupe_key);
    CREATE INDEX IF NOT EXISTS idx_calendar_events_source ON calendar_events(source_id);
  `);
}

export function ensureConfiguredSources(db = getCalendarDb()): void {
  const now = new Date().toISOString();
  const sourceStmt = db.prepare(`
    INSERT INTO calendar_sources (
      id, label, provider_hint, account_hint, env_key, url_hash, color, read_only, configured,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      label = excluded.label,
      provider_hint = excluded.provider_hint,
      account_hint = excluded.account_hint,
      env_key = excluded.env_key,
      url_hash = excluded.url_hash,
      color = excluded.color,
      configured = excluded.configured,
      updated_at = excluded.updated_at
  `);
  const calendarColorStmt = db.prepare("UPDATE calendar_calendars SET color = ?, updated_at = ? WHERE source_id = ?");
  for (const source of CALENDAR_SOURCE_CONFIGS) {
    const url = sourceUrl(source);
    sourceStmt.run(source.id, source.label, source.providerHint, source.accountHint, source.envKey, url ? hashValue(url) : null, source.color, url ? 1 : 0, now, now);
    calendarColorStmt.run(source.color, now, source.id);
  }
}

export function upsertCalendar(sourceId: string, name: string, color: string): CalendarDefinition {
  const db = getCalendarDb();
  const id = `${sourceId}:primary`;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO calendar_calendars (id, source_id, name, color, selected, read_only, created_at, updated_at)
    VALUES (?, ?, ?, ?, 1, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, color = excluded.color, updated_at = excluded.updated_at
  `).run(id, sourceId, name, color, now, now);
  return getCalendarById(id)!;
}

export function replaceSourceEvents(sourceId: string, events: CalendarEventInput[]): void {
  const db = getCalendarDb();
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO calendar_events (
      id, source_id, calendar_id, uid, recurrence_id, dedupe_key, title, start_at, end_at,
      sort_start, sort_end, all_day, description, location, join_links_json, attendees_json,
      organizer_json, recurrence_json, status, provider_url, raw_json, visible, hidden_by_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
  `);
  db.transaction(() => {
    db.prepare(`
      DELETE FROM calendar_events
      WHERE source_id = ?
        AND raw_json NOT LIKE '%"hiltImported":true%'
    `).run(sourceId);
    for (const event of events) {
      insert.run(
        event.id,
        event.sourceId,
        event.calendarId,
        event.uid,
        event.recurrenceId,
        event.dedupeKey,
        event.title,
        event.start,
        event.end,
        event.sortStart,
        event.sortEnd,
        event.allDay ? 1 : 0,
        event.description,
        event.location,
        JSON.stringify(event.joinLinks),
        JSON.stringify(event.attendees),
        event.organizer ? JSON.stringify(event.organizer) : null,
        JSON.stringify(event.recurrence),
        event.status,
        event.providerUrl,
        JSON.stringify(event.raw),
        now,
      );
    }
    refreshVisibleDuplicates(db);
  })();
}

export function refreshVisibleDuplicates(db = getCalendarDb()): { visibleEvents: number; hiddenDuplicates: number } {
  const keys = db.prepare("SELECT dedupe_key FROM calendar_events GROUP BY dedupe_key").all() as Array<{ dedupe_key: string }>;
  const byKey = db.prepare("SELECT id, source_id, status FROM calendar_events WHERE dedupe_key = ?");
  const hide = db.prepare("UPDATE calendar_events SET visible = 0, hidden_by_id = ? WHERE id = ?");
  const show = db.prepare("UPDATE calendar_events SET visible = 1, hidden_by_id = NULL WHERE id = ?");
  for (const { dedupe_key } of keys) {
    const rows = byKey.all(dedupe_key) as Array<{ id: string; source_id: string; status: string | null }>;
    const winner = [...rows].sort((a, b) => {
      const cancelledA = a.status?.toUpperCase() === "CANCELLED" ? 1 : 0;
      const cancelledB = b.status?.toUpperCase() === "CANCELLED" ? 1 : 0;
      return cancelledA - cancelledB || sourcePriority(a.source_id) - sourcePriority(b.source_id);
    })[0];
    for (const row of rows) {
      if (row.id === winner.id) show.run(row.id);
      else hide.run(winner.id, row.id);
    }
  }
  const visibleEvents = Number((db.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE visible = 1").get() as { count: number }).count);
  const hiddenDuplicates = Number((db.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE visible = 0").get() as { count: number }).count);
  return { visibleEvents, hiddenDuplicates };
}

export function updateSourceSyncResult(sourceId: string, result: {
  ok: boolean;
  error?: string | null;
  fetchMs?: number | null;
  eventCount?: number;
  coverage?: CalendarFieldCoverage | null;
}): void {
  getCalendarDb().prepare(`
    UPDATE calendar_sources
    SET last_sync_at = ?, last_error = ?, last_fetch_ms = ?, last_event_count = ?, coverage_json = ?, updated_at = ?
    WHERE id = ?
  `).run(
    new Date().toISOString(),
    result.ok ? null : result.error || "Sync failed",
    result.fetchMs ?? null,
    result.eventCount ?? 0,
    result.coverage ? JSON.stringify(result.coverage) : null,
    new Date().toISOString(),
    sourceId,
  );
}

export function listCalendarSources(): CalendarSource[] {
  ensureConfiguredSources();
  const rows = getCalendarDb().prepare("SELECT * FROM calendar_sources ORDER BY id").all() as SourceRow[];
  const order = new Map(CALENDAR_SOURCE_CONFIGS.map((source, index) => [source.id, index]));
  return rows.map(rowToSource).sort((a, b) => (order.get(a.id as typeof CALENDAR_SOURCE_CONFIGS[number]["id"]) ?? 99) - (order.get(b.id as typeof CALENDAR_SOURCE_CONFIGS[number]["id"]) ?? 99));
}

export function listCalendars(): CalendarDefinition[] {
  return (getCalendarDb().prepare("SELECT * FROM calendar_calendars ORDER BY source_id, name").all() as CalendarRow[]).map(rowToCalendar);
}

export function getCalendarById(id: string): CalendarDefinition | null {
  const row = getCalendarDb().prepare("SELECT * FROM calendar_calendars WHERE id = ?").get(id) as CalendarRow | undefined;
  return row ? rowToCalendar(row) : null;
}

export function setCalendarSelected(id: string, selected: boolean): CalendarDefinition | null {
  const now = new Date().toISOString();
  getCalendarDb().prepare("UPDATE calendar_calendars SET selected = ?, updated_at = ? WHERE id = ?").run(selected ? 1 : 0, now, id);
  return getCalendarById(id);
}

export function queryCalendarEvents(filters: {
  start: Date;
  end: Date;
  sourceIds?: string[];
  calendarIds?: string[];
}): CalendarEvent[] {
  const params: SqlValue[] = [filters.end.getTime(), filters.start.getTime()];
  const where = [
    "e.visible = 1",
    "e.sort_start <= ?",
    "e.sort_end >= ?",
    "c.selected = 1",
    "TRIM(e.title) NOT IN ('!', '-')",
    "LOWER(TRIM(e.title)) NOT LIKE 'canceled: %'",
    "LOWER(TRIM(e.title)) NOT LIKE 'canceled - %'",
    "NOT (e.source_id = 'evercommerce' AND TRIM(e.title) LIKE ?)",
  ];
  params.push("👦🏼 Walt %");
  if (filters.sourceIds?.length) {
    where.push(`e.source_id IN (${filters.sourceIds.map(() => "?").join(",")})`);
    params.push(...filters.sourceIds);
  }
  if (filters.calendarIds?.length) {
    where.push(`e.calendar_id IN (${filters.calendarIds.map(() => "?").join(",")})`);
    params.push(...filters.calendarIds);
  }
  const rows = getCalendarDb().prepare(`
    SELECT e.* FROM calendar_events e
    JOIN calendar_calendars c ON c.id = e.calendar_id
    WHERE ${where.join(" AND ")}
    ORDER BY e.sort_start ASC, e.title ASC
  `).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function queryCalendarAvailabilityBlocks(filters: {
  start: Date;
  end: Date;
  sourceIds?: string[];
  calendarIds?: string[];
}): CalendarEvent[] {
  const params: SqlValue[] = [filters.end.getTime(), filters.start.getTime()];
  const where = [
    "e.visible = 1",
    "e.sort_start <= ?",
    "e.sort_end >= ?",
    "c.selected = 1",
    "e.source_id = 'evercommerce'",
    "TRIM(e.title) IN ('!', '-')",
  ];
  if (filters.sourceIds?.length) {
    where.push(`e.source_id IN (${filters.sourceIds.map(() => "?").join(",")})`);
    params.push(...filters.sourceIds);
  }
  if (filters.calendarIds?.length) {
    where.push(`e.calendar_id IN (${filters.calendarIds.map(() => "?").join(",")})`);
    params.push(...filters.calendarIds);
  }
  const rows = getCalendarDb().prepare(`
    SELECT e.* FROM calendar_events e
    JOIN calendar_calendars c ON c.id = e.calendar_id
    WHERE ${where.join(" AND ")}
    ORDER BY e.sort_start ASC, e.title ASC
  `).all(...params) as EventRow[];
  return rows.map(rowToEvent);
}

export function queryCalendarHolidayEvents(filters: {
  start: Date;
  end: Date;
}): CalendarEvent[] {
  const rows = getCalendarDb().prepare(`
    SELECT e.* FROM calendar_events e
    WHERE e.visible = 1
      AND e.source_id = 'us-holidays'
      AND e.sort_start <= ?
      AND e.sort_end >= ?
    ORDER BY e.sort_start ASC, e.title ASC
  `).all(filters.end.getTime(), filters.start.getTime()) as EventRow[];
  return rows.map(rowToEvent);
}

export function getCalendarEvent(id: string): CalendarEvent | null {
  const row = getCalendarDb().prepare("SELECT * FROM calendar_events WHERE id = ?").get(id) as EventRow | undefined;
  return row ? rowToEvent(row) : null;
}

export function calendarHealth(): { sources: CalendarSource[]; calendars: CalendarDefinition[]; stale: boolean; generatedAt: string } {
  const sources = listCalendarSources();
  const staleCutoff = Date.now() - 1000 * 60 * 60 * 12;
  return {
    sources,
    calendars: listCalendars(),
    stale: sources.some((source) => !source.lastSyncAt || Date.parse(source.lastSyncAt) < staleCutoff || Boolean(source.lastError)),
    generatedAt: new Date().toISOString(),
  };
}

function rowToSource(row: SourceRow): CalendarSource {
  return {
    id: row.id,
    label: row.label,
    providerHint: row.provider_hint,
    accountHint: row.account_hint,
    readOnly: Boolean(row.read_only),
    configured: Boolean(row.configured),
    urlConfigured: Boolean(row.url_hash),
    color: row.color,
    lastSyncAt: row.last_sync_at,
    lastError: row.last_error,
    lastFetchMs: row.last_fetch_ms,
    lastEventCount: row.last_event_count,
    coverage: parseJson(row.coverage_json, null),
  };
}

function rowToCalendar(row: CalendarRow): CalendarDefinition {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    color: row.color,
    selected: Boolean(row.selected),
    readOnly: Boolean(row.read_only),
  };
}

function rowToEvent(row: EventRow): CalendarEvent {
  const sourceIds = (getCalendarDb().prepare("SELECT DISTINCT source_id FROM calendar_events WHERE dedupe_key = ? ORDER BY source_id").all(row.dedupe_key) as Array<{ source_id: string }>).map((item) => item.source_id);
  return {
    id: row.id,
    sourceIds,
    calendarId: row.calendar_id,
    sourceId: row.source_id,
    title: row.title,
    start: row.start_at,
    end: row.end_at,
    sortStart: row.sort_start,
    sortEnd: row.sort_end,
    allDay: Boolean(row.all_day),
    description: row.description,
    location: row.location,
    joinLinks: dedupeJoinLinks(parseJson<CalendarJoinLink[]>(row.join_links_json, [])),
    attendees: parseJson(row.attendees_json, []),
    organizer: parseJson(row.organizer_json, null),
    recurrence: parseJson(row.recurrence_json, { recurring: false, recurrenceId: null, rules: [] }),
    status: row.status,
    providerUrl: row.provider_url,
    readOnly: true,
    duplicateSourceCount: sourceIds.length,
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
