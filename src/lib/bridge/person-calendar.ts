import { queryFutureCalendarSeriesEvents } from "../calendar/db";
import type { PersonCalendarCandidate, PersonCalendarLinks, PersonMeeting } from "../types";

interface SeriesGroup {
  seriesKey: string;
  method: PersonCalendarCandidate["method"];
  uid: string | null;
  title: string;
  historicalCount: number;
  lastSeenAt: string | null;
}

export function resolvePersonCalendarLinks(
  meetings: PersonMeeting[],
  selectedSeriesKey: string | null = null,
  now = new Date(),
): PersonCalendarLinks {
  const groups = Array.from(groupHistoricalSeries(meetings).values());
  const candidates = groups
    .map((group) => candidateForGroup(group, now))
    .filter((candidate): candidate is PersonCalendarCandidate => Boolean(candidate))
    .sort((a, b) => candidateScore(b, selectedSeriesKey) - candidateScore(a, selectedSeriesKey));

  const selectedCandidate = selectedSeriesKey
    ? candidates.find((candidate) => candidate.seriesKey === selectedSeriesKey) ?? null
    : null;
  const primary = selectedCandidate ?? candidates[0] ?? null;

  return {
    primary,
    candidates,
    selectedSeriesKey: primary?.seriesKey ?? selectedSeriesKey,
  };
}

function groupHistoricalSeries(meetings: PersonMeeting[]): Map<string, SeriesGroup> {
  const groups = new Map<string, SeriesGroup>();
  for (const meeting of meetings) {
    if (meeting.source !== "granola") continue;
    const title = meeting.title?.trim();
    const uid = meeting.calendarIcalUid?.trim() || null;
    const seriesKey = uid ? `icaluid:${uid.toLowerCase()}` : title ? `title:${normalizeTitle(title)}` : null;
    if (!seriesKey || !title) continue;

    const existing = groups.get(seriesKey);
    const seenAt = meeting.time || meeting.date || null;
    if (!existing) {
      groups.set(seriesKey, {
        seriesKey,
        method: uid ? "icaluid" : "title",
        uid,
        title,
        historicalCount: 1,
        lastSeenAt: seenAt,
      });
      continue;
    }

    existing.historicalCount++;
    if (seenAt && (!existing.lastSeenAt || seenAt > existing.lastSeenAt)) {
      existing.lastSeenAt = seenAt;
      existing.title = title;
    }
  }
  return groups;
}

function candidateForGroup(group: SeriesGroup, now: Date): PersonCalendarCandidate | null {
  const events = queryFutureCalendarSeriesEvents({
    uid: group.uid,
    title: group.uid ? null : group.title,
    start: now,
    limit: 5,
  });
  const event = events[0];
  if (!event) return null;
  if (group.method !== "icaluid" && !event.recurrence.recurring && group.historicalCount < 2) return null;

  return {
    eventId: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    uid: event.uid ?? group.uid,
    seriesKey: group.seriesKey,
    method: group.method,
    confidence: group.method === "icaluid" ? 1 : Math.min(0.92, 0.68 + group.historicalCount * 0.06),
    historicalCount: group.historicalCount,
    lastSeenAt: group.lastSeenAt,
  };
}

function candidateScore(candidate: PersonCalendarCandidate, selectedSeriesKey: string | null): number {
  const selectedBoost = candidate.seriesKey === selectedSeriesKey ? 10_000 : 0;
  const methodBoost = candidate.method === "icaluid" ? 1_000 : 0;
  const recurrenceHistory = candidate.historicalCount * 25;
  const recency = candidate.lastSeenAt ? Math.min(100, Math.max(0, Date.parse(candidate.lastSeenAt) / 8.64e10)) : 0;
  return selectedBoost + methodBoost + recurrenceHistory + recency + candidate.confidence;
}

function normalizeTitle(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}
