import * as fs from "fs";
import { CALENDAR_FIXTURE_ICS } from "./fixtures";
import { CALENDAR_SOURCE_CONFIGS, getCalendarSyncLockPath, getSyncWindow, sourceUrl } from "./config";
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

const LOCK_POLL_MS = 250;
const LOCK_TIMEOUT_MS = 60_000;
const LOCK_STALE_MS = 10 * 60_000;

let activeCalendarSync: Promise<CalendarSyncReport> | null = null;

export async function syncCalendarSources(options: { sourceIds?: string[] } = {}): Promise<CalendarSyncReport> {
  if (activeCalendarSync) return activeCalendarSync;
  const sync = withCalendarSyncLock(() => syncCalendarSourcesUnlocked(options));
  activeCalendarSync = sync;
  try {
    return await sync;
  } finally {
    if (activeCalendarSync === sync) activeCalendarSync = null;
  }
}

async function syncCalendarSourcesUnlocked(options: { sourceIds?: string[] } = {}): Promise<CalendarSyncReport> {
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

async function withCalendarSyncLock<T>(run: () => Promise<T>): Promise<T> {
  const release = await acquireCalendarSyncLock();
  try {
    return await run();
  } finally {
    release();
  }
}

async function acquireCalendarSyncLock(): Promise<() => void> {
  const lockPath = getCalendarSyncLockPath();
  fs.mkdirSync(getLockDir(lockPath), { recursive: true });
  const started = Date.now();

  while (true) {
    try {
      const fd = fs.openSync(lockPath, "wx");
      try {
        fs.writeSync(fd, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
      } finally {
        fs.closeSync(fd);
      }
      return () => {
        try {
          fs.unlinkSync(lockPath);
        } catch {
          // Another process may have already cleaned up a stale lock.
        }
      };
    } catch (error) {
      if (errorCode(error) !== "EEXIST") throw error;
      if (calendarSyncLockCanBeCleared(lockPath)) {
        try {
          fs.unlinkSync(lockPath);
          continue;
        } catch {
          // Lost a cleanup race; wait and retry below.
        }
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) {
        throw new Error("Calendar sync is already running.");
      }
      await sleep(LOCK_POLL_MS);
    }
  }
}

function calendarSyncLockCanBeCleared(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs >= LOCK_STALE_MS) return true;
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as { pid?: unknown };
    const pid = typeof lock.pid === "number" ? lock.pid : null;
    return Boolean(pid && !processIsRunning(pid));
  } catch {
    return true;
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getLockDir(lockPath: string): string {
  const index = lockPath.lastIndexOf("/");
  return index === -1 ? "." : lockPath.slice(0, index);
}

function errorCode(error: unknown): string | null {
  return typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
