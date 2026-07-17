import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import bplistParser from "bplist-parser";
import Database from "better-sqlite3";
import { getCalendarDataDir } from "./config";
import { getCalendarDb } from "./db";
import type { CalendarParticipant } from "./types";

const CF_ABSOLUTE_TIME_OFFSET = 978_307_200;
const DEFAULT_FANTASTICAL_DB_PATH = path.join(
  os.homedir(),
  "Library/Group Containers/85C27NK92C.com.flexibits.fantastical2.mac/Database/Fantastical-8.fcdata",
);
const DEFAULT_EVERCOMMERCE_CALENDAR_ID = "9fb3ef54e5a7ff5635dd06a0314af7b6ea76413d";
const EXACT_OCCURRENCE_TOLERANCE_MS = 2 * 60 * 1000;
const FANTASTICAL_SNAPSHOT_VERSION = 1;

export interface ParsedFantasticalArchive {
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

export interface FantasticalCalendarRecord {
  rowId: number;
  uid: string;
  startMs: number | null;
  recurrenceInstanceMs: number | null;
  recurring: boolean;
  attendees: CalendarParticipant[];
  organizer: CalendarParticipant | null;
}

export interface FantasticalEnrichmentReport {
  status: "ok" | "skipped";
  skippedReason: string | null;
  cachePath: string;
  cacheModifiedAt: string | null;
  targetEvents: number;
  cacheRows: number;
  parsedRecords: number;
  parseFailures: number;
  matchedEvents: number;
  exactMatches: number;
  seriesMatches: number;
  enrichedEvents: number;
  eventsWithAttendeesAdded: number;
  attendeesAdded: number;
  eventsWithOrganizerAdded: number;
}

export interface FantasticalSnapshotReport {
  snapshotPath: string;
  sourceModifiedAt: string;
  calendarIdentifier: string;
  cacheRows: number;
  parsedRecords: number;
  parseFailures: number;
}

interface FantasticalSnapshot {
  version: 1;
  createdAt: string;
  sourceModifiedAt: string;
  calendarIdentifier: string;
  cacheRows: number;
  parseFailures: number;
  records: FantasticalCalendarRecord[];
}

interface EnrichmentTargetRow {
  id: string;
  uid: string;
  sort_start: number;
  attendees_json: string;
  organizer_json: string | null;
  raw_json: string;
}

interface FantasticalCacheRow {
  rowid: number;
  data: Buffer;
  startDate: number;
  recurring: number;
  exchangeUID: string | null;
}

interface EnrichmentSelection {
  attendees: CalendarParticipant[];
  organizer: CalendarParticipant | null;
  attendeeRowId: number | null;
  organizerRowId: number | null;
  matchMethod: "exact-occurrence" | "series-uid";
}

export function getFantasticalDbPath(): string {
  return process.env.HILT_FANTASTICAL_DB_PATH?.trim() || DEFAULT_FANTASTICAL_DB_PATH;
}

export function getFantasticalEverCommerceCalendarId(): string {
  return process.env.HILT_FANTASTICAL_EVERCOMMERCE_CALENDAR_ID?.trim() || DEFAULT_EVERCOMMERCE_CALENDAR_ID;
}

export function getFantasticalSnapshotPath(): string {
  return process.env.HILT_FANTASTICAL_SNAPSHOT_PATH?.trim()
    || path.join(getCalendarDataDir(), "fantastical-evercommerce-calendar.json");
}

export function refreshFantasticalSnapshot(options: {
  cachePath?: string;
  calendarIdentifier?: string;
  snapshotPath?: string;
} = {}): FantasticalSnapshotReport {
  const cachePath = options.cachePath || getFantasticalDbPath();
  const calendarIdentifier = options.calendarIdentifier || getFantasticalEverCommerceCalendarId();
  const snapshotPath = options.snapshotPath || getFantasticalSnapshotPath();
  const sourceModifiedAt = fs.statSync(cachePath).mtime.toISOString();
  const read = readFantasticalRecords(cachePath, calendarIdentifier);
  const snapshot: FantasticalSnapshot = {
    version: FANTASTICAL_SNAPSHOT_VERSION,
    createdAt: new Date().toISOString(),
    sourceModifiedAt,
    calendarIdentifier,
    cacheRows: read.cacheRows,
    parseFailures: read.parseFailures,
    records: read.records,
  };
  fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
  const temporaryPath = `${snapshotPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(snapshot)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, snapshotPath);
  return {
    snapshotPath,
    sourceModifiedAt,
    calendarIdentifier,
    cacheRows: read.cacheRows,
    parsedRecords: read.records.length,
    parseFailures: read.parseFailures,
  };
}

export function enrichEverCommerceEventsFromFantastical(options: {
  calendarDb?: Database.Database;
  cachePath?: string;
  calendarIdentifier?: string;
  records?: FantasticalCalendarRecord[];
  now?: Date;
} = {}): FantasticalEnrichmentReport {
  const cachePath = options.cachePath || getFantasticalSnapshotPath();
  const report = emptyReport(cachePath);
  if (!options.records && process.env.HILT_CALENDAR_FIXTURE_MODE === "1") {
    return { ...report, status: "skipped", skippedReason: "fixture-mode" };
  }
  if (!options.records && process.env.HILT_FANTASTICAL_ENRICHMENT === "0") {
    return { ...report, status: "skipped", skippedReason: "disabled" };
  }
  if (!options.records && !fs.existsSync(cachePath)) {
    return { ...report, status: "skipped", skippedReason: "snapshot-not-found" };
  }

  const calendarDb = options.calendarDb || getCalendarDb();
  const targets = calendarDb.prepare(`
    SELECT id, uid, sort_start, attendees_json, organizer_json, raw_json
    FROM calendar_events
    WHERE source_id = 'evercommerce'
      AND uid IS NOT NULL
      AND TRIM(uid) <> ''
      AND raw_json NOT LIKE '%"hiltImported":true%'
      AND (
        attendees_json = '[]'
        OR organizer_json IS NULL
        OR raw_json LIKE '%"fantasticalEnrichment"%'
      )
  `).all() as EnrichmentTargetRow[];
  report.targetEvents = targets.length;
  if (targets.length === 0) return report;

  let parsedRecords: FantasticalCalendarRecord[];
  if (options.records) {
    parsedRecords = options.records;
    report.cacheRows = parsedRecords.length;
    report.parsedRecords = parsedRecords.length;
  } else {
    const snapshot = readFantasticalSnapshot(cachePath);
    report.cacheModifiedAt = snapshot.sourceModifiedAt;
    const targetUids = new Set(targets.map((target) => normalizeUid(target.uid)));
    parsedRecords = snapshot.records.filter((record) => targetUids.has(normalizeUid(record.uid)));
    report.cacheRows = snapshot.cacheRows;
    report.parsedRecords = parsedRecords.length;
    report.parseFailures = snapshot.parseFailures;
  }

  const recordsByUid = new Map<string, FantasticalCalendarRecord[]>();
  for (const record of parsedRecords) {
    const uid = normalizeUid(record.uid);
    if (!uid) continue;
    recordsByUid.set(uid, [...(recordsByUid.get(uid) ?? []), record]);
  }

  const enrichedAt = (options.now || new Date()).toISOString();
  const update = calendarDb.prepare(`
    UPDATE calendar_events
    SET attendees_json = ?, organizer_json = ?, raw_json = ?, updated_at = ?
    WHERE id = ?
  `);

  calendarDb.transaction(() => {
    for (const target of targets) {
      const candidates = recordsByUid.get(normalizeUid(target.uid));
      if (!candidates?.length) continue;
      report.matchedEvents += 1;

      const selection = selectEnrichment(candidates, target.sort_start);
      if (selection.matchMethod === "exact-occurrence") report.exactMatches += 1;
      else report.seriesMatches += 1;

      const raw = parseRecord(target.raw_json);
      const prior = parseRecord(raw.fantasticalEnrichment);
      const currentAttendees = parseParticipants(target.attendees_json);
      const currentOrganizer = parseParticipant(target.organizer_json);
      const canUpdateAttendees = currentAttendees.length === 0 || prior.attendees === true;
      const canUpdateOrganizer = currentOrganizer === null || prior.organizer === true;
      const attendees = canUpdateAttendees && selection.attendees.length > 0
        ? selection.attendees
        : currentAttendees;
      const organizer = canUpdateOrganizer && selection.organizer
        ? selection.organizer
        : currentOrganizer;
      const attendeesChanged = JSON.stringify(attendees) !== JSON.stringify(currentAttendees);
      const organizerChanged = JSON.stringify(organizer) !== JSON.stringify(currentOrganizer);
      if (!attendeesChanged && !organizerChanged) continue;

      raw.fantasticalEnrichment = {
        source: "fantastical-cache",
        enrichedAt,
        cacheModifiedAt: report.cacheModifiedAt,
        matchMethod: selection.matchMethod,
        attendeeRowId: selection.attendeeRowId,
        organizerRowId: selection.organizerRowId,
        attendees: canUpdateAttendees && selection.attendees.length > 0,
        organizer: canUpdateOrganizer && Boolean(selection.organizer),
      };
      update.run(
        JSON.stringify(attendees),
        organizer ? JSON.stringify(organizer) : null,
        JSON.stringify(raw),
        enrichedAt,
        target.id,
      );

      report.enrichedEvents += 1;
      if (attendeesChanged) {
        report.eventsWithAttendeesAdded += 1;
        report.attendeesAdded += attendees.length;
      }
      if (organizerChanged) report.eventsWithOrganizerAdded += 1;
    }
  })();

  return report;
}

export function parseFantasticalArchive(data: Buffer): ParsedFantasticalArchive {
  const [plist] = bplistParser.parseBuffer<{
    $top: { root: { UID: number } };
    $objects: unknown[];
  }>(data);
  const root = plist.$objects[plist.$top.root.UID] as Record<string, unknown>;
  return deref(plist.$objects, root) as ParsedFantasticalArchive;
}

export function participantsFromFantasticalArchive(value: unknown): CalendarParticipant[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, CalendarParticipant>();
  for (const item of value) {
    const participant = participantFromFantasticalArchive(item);
    if (!participant) continue;
    byKey.set((participant.email || participant.name || "").toLowerCase(), participant);
  }
  return Array.from(byKey.values());
}

export function participantFromFantasticalArchive(value: unknown): CalendarParticipant | null {
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

export function fantasticalAbsoluteTimeToDate(value: number | null): Date | null {
  if (value === null || !Number.isFinite(value)) return null;
  return new Date((value + CF_ABSOLUTE_TIME_OFFSET) * 1000);
}

function readFantasticalRecords(
  cachePath: string,
  calendarIdentifier: string,
  targetUids?: Set<string>,
): { records: FantasticalCalendarRecord[]; cacheRows: number; parseFailures: number } {
  const cacheDb = new Database(cachePath, { readonly: true, fileMustExist: true, timeout: 2_500 });
  cacheDb.pragma("query_only = ON");
  const rows: FantasticalCacheRow[] = [];
  try {
    rows.push(...cacheDb.prepare(`
      SELECT d.rowid, d.data, i.startDate, i.recurring, i.exchangeUID
      FROM database2 d
      JOIN secondaryIndex_index_calendarItems i ON i.rowid = d.rowid
      WHERE i.calendarIdentifier = ?
        AND i.hidden = 0
        AND i.exchangeUID IS NOT NULL
    `).all(calendarIdentifier) as FantasticalCacheRow[]);
  } finally {
    cacheDb.close();
  }

  const records: FantasticalCalendarRecord[] = [];
  let parseFailures = 0;
  for (const row of rows) {
    if (targetUids && !targetUids.has(normalizeUid(row.exchangeUID || ""))) continue;
    try {
      const archive = parseFantasticalArchive(row.data);
      const uid = normalizeText(stringValue(archive.exchangeUID) || row.exchangeUID);
      if (!uid) continue;
      records.push({
        rowId: row.rowid,
        uid,
        startMs: dateMs(numberValue(archive.startDate) ?? row.startDate),
        recurrenceInstanceMs: dateMs(numberValue(archive.recurrenceInstanceDate)),
        recurring: Boolean(row.recurring || archive.recurrenceEndDate),
        attendees: participantsFromFantasticalArchive(archive.attendees),
        organizer: participantFromFantasticalArchive(archive.organizer),
      });
    } catch {
      parseFailures += 1;
    }
  }
  return { records, cacheRows: rows.length, parseFailures };
}

function readFantasticalSnapshot(snapshotPath: string): FantasticalSnapshot {
  const parsed = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as Partial<FantasticalSnapshot>;
  if (parsed.version !== FANTASTICAL_SNAPSHOT_VERSION || !Array.isArray(parsed.records)) {
    throw new Error("Fantastical calendar snapshot has an unsupported format.");
  }
  return {
    version: FANTASTICAL_SNAPSHOT_VERSION,
    createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : new Date(0).toISOString(),
    sourceModifiedAt: typeof parsed.sourceModifiedAt === "string" ? parsed.sourceModifiedAt : new Date(0).toISOString(),
    calendarIdentifier: typeof parsed.calendarIdentifier === "string" ? parsed.calendarIdentifier : "",
    cacheRows: typeof parsed.cacheRows === "number" ? parsed.cacheRows : parsed.records.length,
    parseFailures: typeof parsed.parseFailures === "number" ? parsed.parseFailures : 0,
    records: parsed.records as FantasticalCalendarRecord[],
  };
}

function selectEnrichment(records: FantasticalCalendarRecord[], eventStartMs: number): EnrichmentSelection {
  const byRichness = (left: FantasticalCalendarRecord, right: FantasticalCalendarRecord) => (
    richness(right) - richness(left) || right.rowId - left.rowId
  );
  const exact = records
    .filter((record) => occurrenceStart(record) !== null && Math.abs(occurrenceStart(record)! - eventStartMs) <= EXACT_OCCURRENCE_TOLERANCE_MS)
    .sort(byRichness)[0];
  const series = records
    .filter((record) => record.recurring && record.recurrenceInstanceMs === null)
    .sort(byRichness)[0];
  const richest = [...records].sort(byRichness)[0];
  const fallback = series || richest;
  const attendeeRecord = exact?.attendees.length ? exact : recordsWithAttendees([fallback, ...records]).sort(byRichness)[0];
  const organizerRecord = exact?.organizer ? exact : recordsWithOrganizer([fallback, ...records]).sort(byRichness)[0];
  const usedExact = Boolean(exact && (attendeeRecord?.rowId === exact.rowId || organizerRecord?.rowId === exact.rowId));
  return {
    attendees: attendeeRecord?.attendees ?? [],
    organizer: organizerRecord?.organizer ?? null,
    attendeeRowId: attendeeRecord?.rowId ?? null,
    organizerRowId: organizerRecord?.rowId ?? null,
    matchMethod: usedExact ? "exact-occurrence" : "series-uid",
  };
}

function recordsWithAttendees(records: Array<FantasticalCalendarRecord | undefined>): FantasticalCalendarRecord[] {
  return uniqueRecords(records.filter((record): record is FantasticalCalendarRecord => Boolean(record?.attendees.length)));
}

function recordsWithOrganizer(records: Array<FantasticalCalendarRecord | undefined>): FantasticalCalendarRecord[] {
  return uniqueRecords(records.filter((record): record is FantasticalCalendarRecord => Boolean(record?.organizer)));
}

function uniqueRecords(records: FantasticalCalendarRecord[]): FantasticalCalendarRecord[] {
  return Array.from(new Map(records.map((record) => [record.rowId, record])).values());
}

function richness(record: FantasticalCalendarRecord): number {
  return record.attendees.length * 10 + (record.organizer ? 5 : 0) + (record.recurrenceInstanceMs !== null ? 1 : 0);
}

function occurrenceStart(record: FantasticalCalendarRecord): number | null {
  return record.recurrenceInstanceMs ?? record.startMs;
}

function emptyReport(cachePath: string): FantasticalEnrichmentReport {
  return {
    status: "ok",
    skippedReason: null,
    cachePath,
    cacheModifiedAt: null,
    targetEvents: 0,
    cacheRows: 0,
    parsedRecords: 0,
    parseFailures: 0,
    matchedEvents: 0,
    exactMatches: 0,
    seriesMatches: 0,
    enrichedEvents: 0,
    eventsWithAttendeesAdded: 0,
    attendeesAdded: 0,
    eventsWithOrganizerAdded: 0,
  };
}

function dateMs(value: number | null): number | null {
  return fantasticalAbsoluteTimeToDate(value)?.getTime() ?? null;
}

function parseParticipants(value: string): CalendarParticipant[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed as CalendarParticipant[] : [];
  } catch {
    return [];
  }
}

function parseParticipant(value: string | null): CalendarParticipant | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as CalendarParticipant : null;
  } catch {
    return null;
  }
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
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

function normalizeUid(value: string): string {
  return value.trim().toLowerCase();
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

function isUid(value: unknown): value is { UID: number } {
  return Boolean(value && typeof value === "object" && typeof (value as { UID?: unknown }).UID === "number");
}
