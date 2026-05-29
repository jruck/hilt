import * as crypto from "crypto";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { execFileSync } from "child_process";
import bplistParser from "bplist-parser";
import Database from "better-sqlite3";
import { CALENDAR_SOURCE_CONFIGS, getCalendarDbPath, getSyncWindow } from "../src/lib/calendar/config";
import { ensureConfiguredSources, getCalendarDb, refreshVisibleDuplicates, upsertCalendar } from "../src/lib/calendar/db";
import { extractJoinLinks } from "../src/lib/calendar/links";
import { touchCalendarChanged } from "../src/lib/calendar/notify";
import type { CalendarEventInput, CalendarParticipant } from "../src/lib/calendar/types";
import { getGranolaSyncDbPath } from "../src/lib/granola/config";

const CF_ABSOLUTE_TIME_OFFSET = 978_307_200;
const IMPORT_MARKER = '"hiltImported":true';
const DEFAULT_REMOTE_HOST = "mercury-v";
const DEFAULT_REMOTE_DB_PATH = "/Users/jruck/Library/Group Containers/85C27NK92C.com.flexibits.fantastical2.mac/Database/Fantastical-8.fcdata";
const DEFAULT_EVERCOMMERCE_CALENDAR_ID = "9fb3ef54e5a7ff5635dd06a0314af7b6ea76413d";

interface Flags {
  dryRun: boolean;
  dbPath: string | null;
  keepDb: boolean;
  start: string | null;
  end: string | null;
  limit: number | null;
  remoteHost: string;
  remoteDbPath: string;
  fantasticalCalendarId: string;
  includeGranolaOccurrences: boolean;
}

interface FantasticalRow {
  rowid: number;
  key: string;
  data: Buffer;
  startDate: number;
  recurring: number;
  isAllDayOrFloating: number;
  exchangeUID: string | null;
  href: string | null;
  title: string | null;
  location: string | null;
  notes: string | null;
  attendees: string | null;
}

interface GranolaRow {
  id: string;
  title: string;
  calendar_event_id: string | null;
  calendar_ical_uid: string | null;
  calendar_start: string | null;
  calendar_end: string | null;
  calendar_html_link: string | null;
}

interface ParsedArchive {
  title?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  exchangeUID?: unknown;
  identifier?: unknown;
  href?: unknown;
  location?: unknown;
  notes?: unknown;
  organizer?: unknown;
  attendees?: unknown;
  isAllDay?: unknown;
  status?: unknown;
  availability?: unknown;
  recurrenceEndDate?: unknown;
  recurrenceInstanceDate?: unknown;
}

interface BuiltEvent {
  input: CalendarEventInput;
  importKind: "fantastical-cache" | "fantastical-cache-granola-occurrence";
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  ensureConfiguredSources();

  const dbPath = flags.dbPath || backupRemoteFantasticalDb(flags);
  const importWindow = resolveImportWindow(flags);
  const fantasticalDb = new Database(dbPath, { readonly: true });
  const calendarDb = getCalendarDb();
  const evercommerce = CALENDAR_SOURCE_CONFIGS.find((source) => source.id === "evercommerce")!;
  const rows = readFantasticalRows(fantasticalDb, flags, importWindow);
  const baseEvents = rows.map((row) => buildEventFromFantasticalRow(row, flags.fantasticalCalendarId)).filter(Boolean) as BuiltEvent[];
  const granolaEvents = flags.includeGranolaOccurrences
    ? buildGranolaOccurrenceEvents({ fantasticalDb, calendarDb, flags, baseEvents })
    : [];
  const events = uniqueEvents([...baseEvents, ...granolaEvents], flags.limit);

  const report = {
    dryRun: flags.dryRun,
    calendarDbPath: getCalendarDbPath(),
    fantasticalDbPath: dbPath,
    sourceId: evercommerce.id,
    calendarId: "evercommerce:primary",
    fantasticalCalendarId: flags.fantasticalCalendarId,
    importWindow: {
      start: importWindow.start.toISOString(),
      endExclusive: importWindow.end.toISOString(),
    },
    scannedFantasticalRows: rows.length,
    importableFantasticalRows: baseEvents.length,
    syntheticGranolaOccurrences: granolaEvents.length,
    totalEventsToWrite: events.length,
  };

  if (!flags.dryRun) {
    upsertCalendar(evercommerce.id, "EverCommerce", evercommerce.color);
    writeImportedEvents(calendarDb, events.map((event) => event.input));
    const duplicateCounts = refreshVisibleDuplicates(calendarDb);
    touchCalendarChanged({ kind: "fantastical-cache-import" });
    Object.assign(report, duplicateCounts);
  }

  if (!flags.keepDb && !flags.dbPath) fs.rmSync(path.dirname(dbPath), { recursive: true, force: true });
  console.log(JSON.stringify(report, null, 2));
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    dryRun: false,
    dbPath: null,
    keepDb: false,
    start: null,
    end: null,
    limit: null,
    remoteHost: process.env.HILT_FANTASTICAL_REMOTE_HOST || DEFAULT_REMOTE_HOST,
    remoteDbPath: process.env.HILT_FANTASTICAL_REMOTE_DB_PATH || DEFAULT_REMOTE_DB_PATH,
    fantasticalCalendarId: process.env.HILT_FANTASTICAL_EVERCOMMERCE_CALENDAR_ID || DEFAULT_EVERCOMMERCE_CALENDAR_ID,
    includeGranolaOccurrences: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`Missing value for ${arg}`);
      return value;
    };
    if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--db") flags.dbPath = next();
    else if (arg === "--keep-db") flags.keepDb = true;
    else if (arg === "--start") flags.start = next();
    else if (arg === "--end") flags.end = next();
    else if (arg === "--limit") flags.limit = Number(next());
    else if (arg === "--remote-host") flags.remoteHost = next();
    else if (arg === "--remote-db") flags.remoteDbPath = next();
    else if (arg === "--fantastical-calendar-id") flags.fantasticalCalendarId = next();
    else if (arg === "--no-granola-occurrences") flags.includeGranolaOccurrences = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  if (flags.limit !== null && (!Number.isFinite(flags.limit) || flags.limit < 1)) {
    throw new Error("--limit must be a positive number");
  }
  return flags;
}

function backupRemoteFantasticalDb(flags: Flags): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-fantastical-cache-"));
  const remoteSnapshot = `/tmp/hilt-fantastical-cache-${Date.now()}.sqlite`;
  const localSnapshot = path.join(dir, "Fantastical-8.fcdata.sqlite");
  execFileSync("ssh", [
    flags.remoteHost,
    `sqlite3 ${shellQuote(flags.remoteDbPath)} ".backup ${shellQuote(remoteSnapshot)}"`,
  ], { stdio: "inherit" });
  execFileSync("scp", [`${flags.remoteHost}:${remoteSnapshot}`, localSnapshot], { stdio: "inherit" });
  execFileSync("ssh", [flags.remoteHost, `rm -f ${shellQuote(remoteSnapshot)}`], { stdio: "ignore" });
  return localSnapshot;
}

function resolveImportWindow(flags: Flags): { start: Date; end: Date } {
  const syncWindow = getSyncWindow();
  const liveFloor = firstLiveEverCommerceEvent();
  const start = flags.start ? parseDateArg(flags.start, "--start") : syncWindow.start;
  const end = flags.end ? parseDateArg(flags.end, "--end") : liveFloor || syncWindow.end;
  if (end <= start) throw new Error(`Import window is empty: ${start.toISOString()} to ${end.toISOString()}`);
  return { start, end };
}

function firstLiveEverCommerceEvent(): Date | null {
  const row = getCalendarDb().prepare(`
    SELECT MIN(sort_start) AS sort_start
    FROM calendar_events
    WHERE source_id = 'evercommerce'
      AND raw_json NOT LIKE ?
  `).get(`%${IMPORT_MARKER}%`) as { sort_start: number | null };
  return row.sort_start ? new Date(row.sort_start) : null;
}

function readFantasticalRows(db: Database.Database, flags: Flags, window: { start: Date; end: Date }): FantasticalRow[] {
  return db.prepare(`
    SELECT
      d.rowid,
      d.key,
      d.data,
      i.startDate,
      i.recurring,
      i.isAllDayOrFloating,
      i.exchangeUID,
      i.href,
      f.title,
      f.location,
      f.notes,
      f.attendees
    FROM database2 d
    JOIN secondaryIndex_index_calendarItems i ON i.rowid = d.rowid
    LEFT JOIN fts_fts f ON f.rowid = d.rowid
    WHERE i.calendarIdentifier = ?
      AND i.hidden = 0
      AND i.startDate >= ?
      AND i.startDate < ?
    ORDER BY i.startDate ASC, f.title ASC
  `).all(flags.fantasticalCalendarId, dateToCfAbsoluteTime(window.start), dateToCfAbsoluteTime(window.end)) as FantasticalRow[];
}

function buildGranolaOccurrenceEvents(input: {
  fantasticalDb: Database.Database;
  calendarDb: Database.Database;
  flags: Flags;
  baseEvents: BuiltEvent[];
}): BuiltEvent[] {
  const granolaDbPath = getGranolaSyncDbPath();
  if (!fs.existsSync(granolaDbPath)) return [];

  const granolaDb = new Database(granolaDbPath, { readonly: true });
  const exactFantastical = input.fantasticalDb.prepare(`
    SELECT
      d.rowid,
      d.key,
      d.data,
      i.startDate,
      i.recurring,
      i.isAllDayOrFloating,
      i.exchangeUID,
      i.href,
      f.title,
      f.location,
      f.notes,
      f.attendees
    FROM database2 d
    JOIN secondaryIndex_index_calendarItems i ON i.rowid = d.rowid
    LEFT JOIN fts_fts f ON f.rowid = d.rowid
    WHERE i.calendarIdentifier = ?
      AND i.hidden = 0
      AND LOWER(i.exchangeUID) = LOWER(?)
    ORDER BY ABS(i.startDate - ?) ASC
    LIMIT 5
  `);
  const existingLive = input.calendarDb.prepare(`
    SELECT id FROM calendar_events
    WHERE source_id = 'evercommerce'
      AND LOWER(uid) = LOWER(?)
      AND ABS(sort_start - ?) <= 120000
      AND raw_json NOT LIKE ?
    LIMIT 1
  `);
  const rows = granolaDb.prepare(`
    SELECT id, title, calendar_event_id, calendar_ical_uid, calendar_start, calendar_end, calendar_html_link
    FROM granola_documents
    WHERE calendar_ical_uid IS NOT NULL
      AND calendar_start IS NOT NULL
      AND calendar_end IS NOT NULL
      AND hilt_calendar_event_id IS NULL
  `).all() as GranolaRow[];

  const alreadyBuilt = new Set(input.baseEvents.map((event) => uidStartKey(event.input.uid, event.input.sortStart)));
  const built: BuiltEvent[] = [];
  for (const row of rows) {
    if (!row.calendar_ical_uid || !row.calendar_start || !row.calendar_end) continue;
    const startMs = Date.parse(row.calendar_start);
    const endMs = Date.parse(row.calendar_end);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) continue;
    if (existingLive.get(row.calendar_ical_uid, startMs, `%${IMPORT_MARKER}%`)) continue;
    const key = uidStartKey(row.calendar_ical_uid, startMs);
    if (alreadyBuilt.has(key)) continue;

    const candidates = exactFantastical.all(input.flags.fantasticalCalendarId, row.calendar_ical_uid, dateToCfAbsoluteTime(new Date(startMs))) as FantasticalRow[];
    const best = candidates
      .map((candidate) => ({ candidate, score: titleSimilarity(row.title, titleFromFantastical(candidate)) }))
      .filter((candidate) => candidate.score >= 0.85)
      .sort((left, right) => right.score - left.score)[0]?.candidate;
    if (!best) continue;

    const event = buildEventFromFantasticalRow(best, input.flags.fantasticalCalendarId, {
      idSalt: `granola:${row.id}`,
      start: new Date(startMs),
      end: new Date(Math.max(endMs, startMs + 60_000)),
      title: row.title,
      recurrenceId: row.calendar_start,
      importKind: "fantastical-cache-granola-occurrence",
      raw: {
        granolaId: row.id,
        granolaCalendarEventId: row.calendar_event_id,
        granolaCalendarHtmlLink: row.calendar_html_link,
        basedOnFantasticalRowId: best.rowid,
      },
    });
    if (!event) continue;
    built.push(event);
    alreadyBuilt.add(key);
  }
  granolaDb.close();
  return built;
}

function buildEventFromFantasticalRow(
  row: FantasticalRow,
  fantasticalCalendarId: string,
  overrides: {
    idSalt?: string;
    start?: Date;
    end?: Date;
    title?: string;
    recurrenceId?: string | null;
    importKind?: BuiltEvent["importKind"];
    raw?: Record<string, unknown>;
  } = {},
): BuiltEvent | null {
  const archive = parseArchive(row.data);
  const startDate = overrides.start || cfAbsoluteTimeToDate(numberValue(archive.startDate) ?? row.startDate);
  const endDate = overrides.end || cfAbsoluteTimeToDate(numberValue(archive.endDate) ?? row.startDate + 3_600);
  if (!startDate || !endDate) return null;

  const uid = normalizeText(stringValue(archive.exchangeUID) || row.exchangeUID || row.key.split(";")[0]);
  const title = normalizeText(overrides.title || stringValue(archive.title) || row.title) || "Untitled event";
  const location = normalizeText(stringValue(archive.location) || row.location);
  const description = normalizeText(stringValue(archive.notes) || row.notes);
  const identifier = normalizeText(stringValue(archive.identifier) || row.key);
  const href = normalizeText(stringValue(archive.href) || row.href);
  const allDay = Boolean(archive.isAllDay);
  const start = allDay ? dateOnly(startDate) : startDate.toISOString();
  const end = allDay ? dateOnly(endDate) : endDate.toISOString();
  const sortStart = allDay ? Date.parse(`${start}T00:00:00.000Z`) : startDate.getTime();
  const sortEnd = Math.max(allDay ? Date.parse(`${end}T00:00:00.000Z`) : endDate.getTime(), sortStart + (allDay ? 86_400_000 : 60_000));
  const joinLinks = extractJoinLinks(description, location);
  const importKind = overrides.importKind || "fantastical-cache";
  const sourceKey = `evercommerce:${importKind}:${overrides.idSalt || identifier || row.rowid}:${uid || title}:${start}:${end}`;

  return {
    importKind,
    input: {
      id: `cal_${shortHash(sourceKey)}`,
      sourceId: "evercommerce",
      calendarId: "evercommerce:primary",
      uid,
      recurrenceId: overrides.recurrenceId ?? recurrenceIdFromArchive(archive),
      dedupeKey: buildDedupeKey(uid, title, start, end),
      title,
      start,
      end,
      sortStart,
      sortEnd,
      allDay,
      description,
      location,
      joinLinks,
      attendees: participantsFromArchive(archive.attendees),
      organizer: participantFromArchive(archive.organizer),
      recurrence: {
        recurring: Boolean(row.recurring || archive.recurrenceEndDate),
        recurrenceId: overrides.recurrenceId ?? recurrenceIdFromArchive(archive),
        rules: [],
      },
      status: statusFromFantastical(archive.status, title),
      providerUrl: joinLinks[0]?.url || null,
      raw: {
        hiltImported: true,
        hiltImportKind: importKind,
        hiltImportSource: "fantastical-cache",
        sourceId: "evercommerce",
        uid,
        fantasticalRowId: row.rowid,
        fantasticalKey: row.key,
        fantasticalIdentifier: identifier,
        fantasticalHref: href,
        fantasticalCalendarIdentifier: fantasticalCalendarId,
        fantasticalStatus: numberValue(archive.status),
        fantasticalAvailability: numberValue(archive.availability),
        ...(overrides.raw || {}),
      },
    },
  };
}

function writeImportedEvents(db: Database.Database, events: CalendarEventInput[]): void {
  const now = new Date().toISOString();
  const insert = db.prepare(`
    INSERT INTO calendar_events (
      id, source_id, calendar_id, uid, recurrence_id, dedupe_key, title, start_at, end_at,
      sort_start, sort_end, all_day, description, location, join_links_json, attendees_json,
      organizer_json, recurrence_json, status, provider_url, raw_json, visible, hidden_by_id, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NULL, ?)
    ON CONFLICT(id) DO UPDATE SET
      source_id = excluded.source_id,
      calendar_id = excluded.calendar_id,
      uid = excluded.uid,
      recurrence_id = excluded.recurrence_id,
      dedupe_key = excluded.dedupe_key,
      title = excluded.title,
      start_at = excluded.start_at,
      end_at = excluded.end_at,
      sort_start = excluded.sort_start,
      sort_end = excluded.sort_end,
      all_day = excluded.all_day,
      description = excluded.description,
      location = excluded.location,
      join_links_json = excluded.join_links_json,
      attendees_json = excluded.attendees_json,
      organizer_json = excluded.organizer_json,
      recurrence_json = excluded.recurrence_json,
      status = excluded.status,
      provider_url = excluded.provider_url,
      raw_json = excluded.raw_json,
      visible = 1,
      hidden_by_id = NULL,
      updated_at = excluded.updated_at
  `);
  db.transaction(() => {
    db.prepare(`
      DELETE FROM calendar_events
      WHERE source_id = 'evercommerce'
        AND raw_json LIKE ?
    `).run(`%${IMPORT_MARKER}%`);
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
  })();
}

function parseArchive(data: Buffer): ParsedArchive {
  const [plist] = bplistParser.parseBuffer<{
    $top: { root: { UID: number } };
    $objects: unknown[];
  }>(data);
  const root = plist.$objects[plist.$top.root.UID] as Record<string, unknown>;
  return deref(plist.$objects, root) as ParsedArchive;
}

function deref(objects: unknown[], value: unknown): unknown {
  if (isUid(value)) return deref(objects, objects[value.UID]);
  if (value === "$null") return null;
  if (Array.isArray(value)) return value.map((item) => deref(objects, item));
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  if (typeof record["NS.time"] === "number") return record["NS.time"];
  if (Array.isArray(record["NS.objects"])) return record["NS.objects"].map((item) => deref(objects, item));
  return Object.fromEntries(
    Object.entries(record)
      .filter(([key]) => key !== "$class")
      .map(([key, item]) => [key, deref(objects, item)]),
  );
}

function participantsFromArchive(value: unknown): CalendarParticipant[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, CalendarParticipant>();
  for (const item of value) {
    const participant = participantFromArchive(item);
    if (!participant) continue;
    byKey.set((participant.email || participant.name || "").toLowerCase(), participant);
  }
  return Array.from(byKey.values());
}

function participantFromArchive(value: unknown): CalendarParticipant | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const email = emailFromCalendarUri(stringValue(record.email) || stringValue(record.attendee));
  const name = normalizeText(stringValue(record.displayName)) || email;
  if (!name && !email) return null;
  return {
    name,
    email,
    responseStatus: responseStatusFromFantastical(record.status),
  };
}

function uniqueEvents(events: BuiltEvent[], limit: number | null): BuiltEvent[] {
  const byId = new Map<string, BuiltEvent>();
  for (const event of events) {
    if (!byId.has(event.input.id)) byId.set(event.input.id, event);
  }
  const values = Array.from(byId.values()).sort((left, right) => left.input.sortStart - right.input.sortStart || left.input.title.localeCompare(right.input.title));
  return limit ? values.slice(0, limit) : values;
}

function parseDateArg(value: string, name: string): Date {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a parseable date`);
  return new Date(parsed);
}

function cfAbsoluteTimeToDate(value: number | null): Date | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Date((value + CF_ABSOLUTE_TIME_OFFSET) * 1000);
}

function dateToCfAbsoluteTime(value: Date): number {
  return value.getTime() / 1000 - CF_ABSOLUTE_TIME_OFFSET;
}

function dateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function titleFromFantastical(row: FantasticalRow): string {
  try {
    const archive = parseArchive(row.data);
    return normalizeText(stringValue(archive.title) || row.title) || "";
  } catch {
    return normalizeText(row.title) || "";
  }
}

function titleSimilarity(left: string, right: string): number {
  const a = normalizeForKey(left);
  const b = normalizeForKey(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const overlap = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function recurrenceIdFromArchive(archive: ParsedArchive): string | null {
  const value = numberValue(archive.recurrenceInstanceDate);
  return value === null ? null : cfAbsoluteTimeToDate(value)?.toISOString() || null;
}

function buildDedupeKey(uid: string | null, title: string, start: string, end: string): string {
  if (uid) return `uid:${uid.toLowerCase()}:${start}`;
  return `shape:${normalizeForKey(title)}:${start}:${end}`;
}

function uidStartKey(uid: string | null, sortStart: number): string {
  return `${(uid || "").toLowerCase()}:${sortStart}`;
}

function statusFromFantastical(value: unknown, title: string): string | null {
  const status = numberValue(value);
  if (status === 3 || /^canceled[: -]/i.test(title)) return "CANCELLED";
  return null;
}

function responseStatusFromFantastical(value: unknown): string | null {
  const status = numberValue(value);
  if (status === 2) return "accepted";
  if (status === 3) return "tentative";
  if (status === 4) return "declined";
  return null;
}

function emailFromCalendarUri(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const mailto = trimmed.match(/^mailto:(.+)$/i);
  return (mailto ? mailto[1] : trimmed).toLowerCase() || null;
}

function numberValue(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return normalized || null;
}

function normalizeForKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s:-]/g, "").trim();
}

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 18);
}

function isUid(value: unknown): value is { UID: number } {
  return Boolean(value && typeof value === "object" && typeof (value as { UID?: unknown }).UID === "number");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
