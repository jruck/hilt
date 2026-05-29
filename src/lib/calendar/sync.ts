import { CALENDAR_FIXTURE_ICS } from "./fixtures";
import { CALENDAR_SOURCE_CONFIGS, getSyncWindow, sourceUrl } from "./config";
import { parseIcsFeed } from "./ics";
import {
  calendarHealth,
  ensureConfiguredSources,
  listCalendarSources,
  refreshVisibleDuplicates,
  replaceSourceEvents,
  updateSourceSyncResult,
  upsertCalendar,
} from "./db";
import { touchCalendarChanged } from "./notify";
import type { CalendarSyncReport, CalendarSyncSourceResult } from "./types";

export async function syncCalendarSources(options: { sourceIds?: string[] } = {}): Promise<CalendarSyncReport> {
  ensureConfiguredSources();
  const startedAt = new Date().toISOString();
  const syncWindow = getSyncWindow();
  const selected = new Set(options.sourceIds || []);
  const sources = CALENDAR_SOURCE_CONFIGS.filter((source) => selected.size === 0 || selected.has(source.id));
  const results: CalendarSyncSourceResult[] = [];

  for (const source of sources) {
    const url = sourceUrl(source);
    const started = Date.now();
    if (!url) {
      updateSourceSyncResult(source.id, { ok: false, error: "ICS feed URL is not configured." });
      results.push({
        sourceId: source.id,
        label: source.label,
        configured: false,
        ok: false,
        fetched: 0,
        stored: 0,
        hiddenDuplicates: 0,
        error: "ICS feed URL is not configured.",
        coverage: null,
        fetchMs: null,
      });
      continue;
    }

    try {
      const ics = await fetchIcsText(source.id, url);
      const parsed = parseIcsFeed(source, ics, syncWindow);
      upsertCalendar(source.id, parsed.calendarName, source.color);
      replaceSourceEvents(source.id, parsed.events);
      const duplicateCounts = refreshVisibleDuplicates();
      const fetchMs = Date.now() - started;
      updateSourceSyncResult(source.id, {
        ok: true,
        fetchMs,
        eventCount: parsed.events.length,
        coverage: parsed.coverage,
      });
      results.push({
        sourceId: source.id,
        label: source.label,
        configured: true,
        ok: true,
        fetched: parsed.coverage.event_count,
        stored: parsed.events.length,
        hiddenDuplicates: duplicateCounts.hiddenDuplicates,
        error: null,
        coverage: parsed.coverage,
        fetchMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync calendar source.";
      updateSourceSyncResult(source.id, { ok: false, error: message, fetchMs: Date.now() - started });
      results.push({
        sourceId: source.id,
        label: source.label,
        configured: true,
        ok: false,
        fetched: 0,
        stored: 0,
        hiddenDuplicates: 0,
        error: message,
        coverage: null,
        fetchMs: Date.now() - started,
      });
    }
  }

  const duplicateCounts = refreshVisibleDuplicates();
  touchCalendarChanged({ kind: "sync" });

  return {
    startedAt,
    finishedAt: new Date().toISOString(),
    sources: results,
    visibleEvents: duplicateCounts.visibleEvents,
    hiddenDuplicates: duplicateCounts.hiddenDuplicates,
  };
}

export function calendarSetupStatus(): ReturnType<typeof calendarHealth> & { configured: boolean } {
  const health = calendarHealth();
  return {
    ...health,
    sources: listCalendarSources(),
    configured: health.sources.every((source) => source.configured),
  };
}

async function fetchIcsText(sourceId: string, url: string): Promise<string> {
  if (url.startsWith("fixture://")) {
    const fixture = CALENDAR_FIXTURE_ICS[sourceId];
    if (!fixture) throw new Error("Fixture calendar source is missing.");
    return fixture;
  }
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!response.ok) {
    throw new Error(`ICS fetch failed with status ${response.status}.`);
  }
  const text = await response.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    throw new Error("ICS feed did not return a calendar payload.");
  }
  return text;
}
