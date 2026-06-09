import { listCalendarSources } from "./db";
import { CALENDAR_SYNC_FRESHNESS_MS, calendarSourcesNeedSync } from "./freshness";
import { syncCalendarSources } from "./sync";

let stopCurrentDaemon: (() => void) | null = null;

export function startCalendarSyncDaemon(options: {
  intervalMs?: number;
  runImmediately?: boolean;
} = {}): () => void {
  if (stopCurrentDaemon) return stopCurrentDaemon;

  const intervalMs = options.intervalMs ?? CALENDAR_SYNC_FRESHNESS_MS;
  let stopped = false;
  let inFlight = false;

  const runIfStale = async (reason: "startup" | "interval") => {
    if (stopped || inFlight) return;
    let needsSync = false;
    try {
      needsSync = calendarSourcesNeedSync(listCalendarSources(), Date.now(), intervalMs);
    } catch (error) {
      console.warn("[CalendarSyncDaemon] Failed to inspect calendar freshness", error);
      return;
    }
    if (!needsSync) return;

    inFlight = true;
    try {
      const report = await syncCalendarSources();
      const okSources = report.sources.filter((source) => source.ok).length;
      console.log(`[CalendarSyncDaemon] Synced ${okSources}/${report.sources.length} sources (${reason}).`);
    } catch (error) {
      console.warn("[CalendarSyncDaemon] Sync failed", error);
    } finally {
      inFlight = false;
    }
  };

  const interval = setInterval(() => {
    void runIfStale("interval");
  }, intervalMs);
  interval.unref?.();

  if (options.runImmediately ?? true) void runIfStale("startup");

  stopCurrentDaemon = () => {
    stopped = true;
    clearInterval(interval);
    stopCurrentDaemon = null;
  };
  console.log(`[CalendarSyncDaemon] Started; syncing stale calendars every ${Math.round(intervalMs / 1000)}s.`);
  return stopCurrentDaemon;
}
