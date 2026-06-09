import type { CalendarSource } from "./types";

export const CALENDAR_SYNC_FRESHNESS_MS = 5 * 60 * 1000;

export function calendarSourcesNeedSync(
  sources: CalendarSource[],
  nowMs = Date.now(),
  freshnessMs = CALENDAR_SYNC_FRESHNESS_MS,
): boolean {
  const configured = sources.filter((source) => source.configured);
  if (configured.length === 0) return false;
  if (configured.some((source) => !source.lastSyncAt)) return true;
  if (configured.some((source) => Boolean(source.lastError))) return true;

  const syncTimes = configured.map((source) => Date.parse(source.lastSyncAt as string));
  if (syncTimes.some((time) => !Number.isFinite(time))) return true;

  return nowMs - Math.max(...syncTimes) >= freshnessMs;
}
