import * as fs from "fs";
import * as path from "path";
import { queryCalendarEvents } from "../calendar/db";
import { getGranolaDaemonStatePath, getGranolaFastPollMs, getGranolaPollMs, granolaDaemonEnabled } from "./config";
import { runGranolaSync } from "./sync";

let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
const startedAt = new Date().toISOString();

export function startGranolaSyncDaemon(): void {
  if (!granolaDaemonEnabled() || timer || running) return;
  const tick = async () => {
    running = true;
    writeDaemonState({ running: true });
    try {
      await runGranolaSync({ mode: "incremental", dryRun: false });
    } catch (error) {
      console.error("[GranolaSyncDaemon] Sync failed:", error);
    } finally {
      running = false;
      const pollMs = nextPollMs();
      writeDaemonState({ running: false, pollMs });
      timer = setTimeout(tick, pollMs);
    }
  };
  writeDaemonState({ running: false, pollMs: 5_000 });
  timer = setTimeout(tick, 5_000);
}

export function stopGranolaSyncDaemon(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  writeDaemonState({ running: false, enabled: false });
}

function nextPollMs(): number {
  try {
    const now = Date.now();
    const events = queryCalendarEvents({
      start: new Date(now - 15 * 60_000),
      end: new Date(now + 15 * 60_000),
    });
    const hasActiveMeetingWindow = events.some((event) => {
      const title = event.title.trim();
      return !event.allDay && title !== "!" && title !== "-";
    });
    return hasActiveMeetingWindow ? getGranolaFastPollMs() : getGranolaPollMs();
  } catch {
    return getGranolaPollMs();
  }
}

function writeDaemonState(input: { running: boolean; pollMs?: number; enabled?: boolean }): void {
  try {
    const statePath = getGranolaDaemonStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    const now = new Date();
    fs.writeFileSync(statePath, JSON.stringify({
      enabled: input.enabled ?? true,
      running: input.running,
      pid: process.pid,
      startedAt,
      updatedAt: now.toISOString(),
      nextRunAt: input.pollMs ? new Date(now.getTime() + input.pollMs).toISOString() : null,
      pollMs: input.pollMs ?? null,
    }, null, 2), "utf-8");
  } catch (error) {
    console.error("[GranolaSyncDaemon] Failed to write daemon state:", error);
  }
}
