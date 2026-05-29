import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { getCalendarDbPath } from "../src/lib/calendar/config";
import { getGranolaDataDir, getGranolaSyncDbPath } from "../src/lib/granola/config";

interface GranolaRow {
  id: string;
  title: string;
  created_at: string | null;
  calendar_start: string | null;
  calendar_end: string | null;
  calendar_ical_uid: string | null;
  calendar_event_id: string | null;
  raw_json: string;
}

interface CalendarRow {
  id: string;
  source_id: string;
  uid: string | null;
  title: string;
  start_at: string;
  end_at: string;
  sort_start: number;
  sort_end: number;
  attendees_json: string;
}

interface CandidateScore {
  score: number;
  titleScore: number;
  timeScore: number;
  attendeeScore: number;
  deltaMinutes: number;
}

interface AuditItem {
  granolaId: string;
  title: string;
  calendarStart: string | null;
  calendarEnd: string | null;
  calendarIcalUid: string | null;
  calendarEventId: string | null;
  exactUidRows: number;
  visibleExactUidRows: number;
  rawCalendarIdHits: number;
  nearbyCandidates: number;
  bestCandidate: null | (CandidateScore & {
    id: string;
    sourceId: string;
    title: string;
    start: string;
    end: string;
    uid: string | null;
  });
  category: string;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const granolaDb = new Database(getGranolaSyncDbPath(), { readonly: true });
  const calendarDb = new Database(getCalendarDbPath(), { readonly: true });

  const calendarRange = calendarDb.prepare(`
    SELECT MIN(start_at) AS firstStart, MAX(start_at) AS lastStart, COUNT(*) AS events
    FROM calendar_events
    WHERE visible = 1
  `).get() as { firstStart: string | null; lastStart: string | null; events: number };

  const stats = granolaDb.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN calendar_event_id IS NOT NULL AND calendar_event_id != '' THEN 1 ELSE 0 END) AS withCalendarMetadata,
      SUM(CASE WHEN hilt_calendar_event_id IS NOT NULL AND hilt_calendar_event_id != '' THEN 1 ELSE 0 END) AS linkedCalendarEvents,
      SUM(CASE WHEN calendar_event_id IS NULL OR calendar_event_id = '' THEN 1 ELSE 0 END) AS withoutCalendarMetadata,
      SUM(CASE WHEN calendar_event_id IS NOT NULL AND calendar_event_id != '' AND (hilt_calendar_event_id IS NULL OR hilt_calendar_event_id = '') THEN 1 ELSE 0 END) AS unmatchedWithCalendarMetadata
    FROM granola_documents
  `).get() as Record<string, number | null>;

  const unmatched = granolaDb.prepare(`
    SELECT id, title, created_at, calendar_start, calendar_end, calendar_ical_uid, calendar_event_id, raw_json
    FROM granola_documents
    WHERE calendar_event_id IS NOT NULL AND calendar_event_id != ''
      AND (hilt_calendar_event_id IS NULL OR hilt_calendar_event_id = '')
    ORDER BY calendar_start
  `).all() as GranolaRow[];

  const firstCalendarStart = timestamp(calendarRange.firstStart);
  const lastCalendarStart = timestamp(calendarRange.lastStart);
  const beforeCalendarRange: GranolaRow[] = [];
  const afterCalendarRange: GranolaRow[] = [];
  const insideCalendarRange: GranolaRow[] = [];

  for (const row of unmatched) {
    const start = timestamp(row.calendar_start ?? row.created_at);
    if (firstCalendarStart && start < firstCalendarStart) beforeCalendarRange.push(row);
    else if (lastCalendarStart && start > lastCalendarStart) afterCalendarRange.push(row);
    else insideCalendarRange.push(row);
  }

  const items = insideCalendarRange.map((row) => auditInsideRange(row, calendarDb));
  const categoryCounts = countBy(items, (item) => item.category);

  const report = {
    generatedAt: new Date().toISOString(),
    granolaDbPath: getGranolaSyncDbPath(),
    calendarDbPath: getCalendarDbPath(),
    calendarRange,
    summary: {
      totalGranolaDocuments: Number(stats.total || 0),
      withCalendarMetadata: Number(stats.withCalendarMetadata || 0),
      linkedCalendarEvents: Number(stats.linkedCalendarEvents || 0),
      withoutCalendarMetadata: Number(stats.withoutCalendarMetadata || 0),
      unmatchedWithCalendarMetadata: Number(stats.unmatchedWithCalendarMetadata || 0),
      unmatchedBeforeCalendarRange: beforeCalendarRange.length,
      unmatchedInsideCalendarRange: insideCalendarRange.length,
      unmatchedAfterCalendarRange: afterCalendarRange.length,
    },
    insideCalendarRangeCategoryCounts: categoryCounts,
    insideCalendarRange: items,
  };

  const outputPath = typeof flags.out === "string" ? flags.out : path.join(getGranolaDataDir(), "granola-unmatched-audit.json");
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), "utf-8");
  console.log(JSON.stringify({
    outputPath,
    summary: report.summary,
    insideCalendarRangeCategoryCounts: report.insideCalendarRangeCategoryCounts,
    sampleInsideCalendarRange: report.insideCalendarRange.slice(0, 10),
  }, null, 2));
}

function auditInsideRange(row: GranolaRow, calendarDb: Database.Database): AuditItem {
  const uidRows = row.calendar_ical_uid
    ? calendarDb.prepare("SELECT visible FROM calendar_events WHERE LOWER(uid) = LOWER(?)").all(row.calendar_ical_uid) as Array<{ visible: number }>
    : [];
  const rawCalendarIdHits = row.calendar_event_id
    ? (calendarDb.prepare("SELECT COUNT(*) AS count FROM calendar_events WHERE raw_json LIKE ?").get(`%${row.calendar_event_id}%`) as { count: number }).count
    : 0;
  const start = timestamp(row.calendar_start ?? row.created_at);
  const end = timestamp(row.calendar_end ?? row.calendar_start ?? row.created_at) || start;
  const candidates = start ? calendarDb.prepare(`
    SELECT id, source_id, uid, title, start_at, end_at, sort_start, sort_end, attendees_json
    FROM calendar_events
    WHERE visible = 1
      AND sort_start <= ?
      AND sort_end >= ?
      AND TRIM(title) NOT IN ('!', '-')
    ORDER BY ABS(sort_start - ?) ASC
    LIMIT 25
  `).all(end + 30 * 60_000, start - 30 * 60_000, start) as CalendarRow[] : [];
  const scored = candidates
    .map((candidate) => ({ candidate, score: scoreCandidate(candidate, row) }))
    .sort((a, b) => b.score.score - a.score.score);
  const best = scored[0] ?? null;
  const bestCandidate = best ? {
    id: best.candidate.id,
    sourceId: best.candidate.source_id,
    title: best.candidate.title,
    start: best.candidate.start_at,
    end: best.candidate.end_at,
    uid: best.candidate.uid,
    ...roundScore(best.score),
  } : null;

  return {
    granolaId: row.id,
    title: row.title,
    calendarStart: row.calendar_start,
    calendarEnd: row.calendar_end,
    calendarIcalUid: row.calendar_ical_uid,
    calendarEventId: row.calendar_event_id,
    exactUidRows: uidRows.length,
    visibleExactUidRows: uidRows.filter((match) => match.visible === 1).length,
    rawCalendarIdHits,
    nearbyCandidates: candidates.length,
    bestCandidate,
    category: categorize(uidRows, rawCalendarIdHits, candidates.length, bestCandidate),
  };
}

function categorize(
  uidRows: Array<{ visible: number }>,
  rawCalendarIdHits: number,
  candidateCount: number,
  bestCandidate: AuditItem["bestCandidate"],
): string {
  if (uidRows.some((row) => row.visible === 1)) return "visible-exact-uid-present";
  if (uidRows.length) return "only-hidden-exact-uid-present";
  if (rawCalendarIdHits) return "raw-calendar-id-present";
  if (bestCandidate && bestCandidate.score >= 0.78) return "fallback-would-match";
  if (candidateCount) return "nearby-events-low-confidence";
  return "no-nearby-events";
}

function scoreCandidate(row: CalendarRow, doc: GranolaRow): CandidateScore {
  const titleScore = similarity(normalizeTitle(row.title), normalizeTitle(doc.title));
  const startDelta = Math.abs(row.sort_start - timestamp(doc.calendar_start ?? doc.created_at));
  const timeScore = startDelta <= 2 * 60_000 ? 1 : startDelta <= 10 * 60_000 ? 0.9 : startDelta <= 30 * 60_000 ? 0.7 : 0;
  const attendeeScore = attendeeOverlap(row, doc);
  return {
    score: titleScore * 0.55 + timeScore * 0.35 + attendeeScore * 0.1,
    titleScore,
    timeScore,
    attendeeScore,
    deltaMinutes: Math.round(startDelta / 60_000),
  };
}

function attendeeOverlap(row: CalendarRow, doc: GranolaRow): number {
  const rowPeople = parseJson<Array<{ name?: string; email?: string }>>(row.attendees_json, []);
  const raw = parseJson<Record<string, unknown>>(doc.raw_json, {});
  const calendar = raw.google_calendar_event as { attendees?: Array<{ name?: string; email?: string }> } | undefined
    ?? raw.calendar_event as { attendees?: Array<{ name?: string; email?: string }> } | undefined;
  const people = raw.people as { attendees?: Array<{ name?: string; email?: string }> } | undefined;
  const rowKeys = new Set(rowPeople.map((person) => (person.email || person.name || "").toLowerCase()).filter(Boolean));
  const docKeys = [...(people?.attendees ?? []), ...(calendar?.attendees ?? [])]
    .map((person) => (person.email || person.name || "").toLowerCase())
    .filter(Boolean);
  if (!rowKeys.size || !docKeys.length) return 0.5;
  const overlap = docKeys.filter((key) => rowKeys.has(key)).length;
  return overlap / Math.max(1, Math.min(rowKeys.size, docKeys.length));
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.92;
  const aTokens = new Set(a.split(" "));
  const bTokens = new Set(b.split(" "));
  const overlap = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function timestamp(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function roundScore(score: CandidateScore): CandidateScore {
  return {
    score: Number(score.score.toFixed(3)),
    titleScore: Number(score.titleScore.toFixed(3)),
    timeScore: Number(score.timeScore.toFixed(3)),
    attendeeScore: Number(score.attendeeScore.toFixed(3)),
    deltaMinutes: score.deltaMinutes,
  };
}

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function countBy<T>(items: T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = args[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else flags[key] = args[++i];
  }
  return flags;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
