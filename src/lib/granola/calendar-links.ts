import type { CalendarEvent } from "../calendar/types";
import { getCalendarDb } from "../calendar/db";
import { listGranolaMeetingNotesForCalendarEventIds } from "./db";
import type { GranolaCalendarMatch, GranolaDocument } from "./types";

interface CalendarEventRow {
  id: string;
  uid: string | null;
  title: string;
  start_at: string;
  end_at: string;
  sort_start: number;
  sort_end: number;
  attendees_json: string;
  raw_json: string;
}

export function attachGranolaMeetingNotes<T extends CalendarEvent>(events: T[]): T[] {
  if (!events.length) return events;
  const byEventId = listGranolaMeetingNotesForCalendarEventIds(events.map((event) => event.id));
  return events.map((event) => ({
    ...event,
    meetingNotes: byEventId.get(event.id) ?? [],
  }));
}

export function findHiltCalendarMatch(doc: GranolaDocument): GranolaCalendarMatch {
  const calendar = doc.calendarEvent;
  if (!calendar) return noMatch("Granola document has no calendar metadata");

  if (calendar.iCalUID) {
    const row = getCalendarDb().prepare(`
      SELECT * FROM calendar_events
      WHERE visible = 1 AND LOWER(uid) = LOWER(?)
      ORDER BY ABS(sort_start - ?) ASC
      LIMIT 1
    `).get(calendar.iCalUID, timestamp(calendar.start ?? doc.createdAt)) as CalendarEventRow | undefined;
    if (row) return { hiltCalendarEventId: row.id, method: "icaluid", confidence: 1, reason: "Matched calendar iCalUID" };
  }

  if (calendar.id) {
    const needle = `"${escapeLike(calendar.id)}"`;
    const row = getCalendarDb().prepare(`
      SELECT * FROM calendar_events
      WHERE visible = 1 AND raw_json LIKE ?
      ORDER BY ABS(sort_start - ?) ASC
      LIMIT 1
    `).get(`%${needle}%`, timestamp(calendar.start ?? doc.createdAt)) as CalendarEventRow | undefined;
    if (row) return { hiltCalendarEventId: row.id, method: "granola-calendar-id", confidence: 0.98, reason: "Matched Granola calendar id in raw event JSON" };
  }

  const candidates = candidateRows(calendar.start ?? doc.createdAt, calendar.end ?? doc.updatedAt);
  const scored = candidates
    .map((row) => ({ row, score: scoreCalendarShape(row, doc) }))
    .filter((item) => item.score >= 0.78)
    .sort((a, b) => b.score - a.score);

  if (scored[0]) {
    const method = scored[0].score >= 0.9 ? "title-time-attendees" : "title-time";
    return {
      hiltCalendarEventId: scored[0].row.id,
      method,
      confidence: Number(scored[0].score.toFixed(3)),
      reason: `Matched title/time${method === "title-time-attendees" ? "/attendees" : ""}`,
    };
  }

  return noMatch("No Hilt calendar event matched Granola metadata");
}

function candidateRows(start: string | null, end: string | null): CalendarEventRow[] {
  const startMs = timestamp(start);
  const endMs = timestamp(end) || startMs;
  if (!startMs) return [];
  const tolerance = 30 * 60 * 1000;
  return getCalendarDb().prepare(`
    SELECT * FROM calendar_events
    WHERE visible = 1
      AND sort_start <= ?
      AND sort_end >= ?
      AND TRIM(title) NOT IN ('!', '-')
    ORDER BY ABS(sort_start - ?) ASC
    LIMIT 25
  `).all(endMs + tolerance, startMs - tolerance, startMs) as CalendarEventRow[];
}

function scoreCalendarShape(row: CalendarEventRow, doc: GranolaDocument): number {
  const calendar = doc.calendarEvent;
  const titleScore = similarity(normalizeTitle(row.title), normalizeTitle(calendar?.title || doc.title));
  const startDelta = Math.abs(row.sort_start - timestamp(calendar?.start ?? doc.createdAt));
  const timeScore = startDelta <= 2 * 60 * 1000 ? 1 : startDelta <= 10 * 60 * 1000 ? 0.9 : startDelta <= 30 * 60 * 1000 ? 0.7 : 0;
  const attendeeScore = attendeeOverlap(row, doc);
  return titleScore * 0.55 + timeScore * 0.35 + attendeeScore * 0.1;
}

function attendeeOverlap(row: CalendarEventRow, doc: GranolaDocument): number {
  const rowPeople = parseJson<Array<{ name?: string; email?: string }>>(row.attendees_json, []);
  const rowKeys = new Set(rowPeople.map((person) => (person.email || person.name || "").toLowerCase()).filter(Boolean));
  const docKeys = doc.attendees.map((person) => (person.email || person.name || "").toLowerCase()).filter(Boolean);
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

function noMatch(reason: string): GranolaCalendarMatch {
  return { hiltCalendarEventId: null, method: "none", confidence: 0, reason };
}

function parseJson<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function escapeLike(value: string): string {
  return value.replace(/[%_]/g, "");
}
