import { runLibraryIntake } from "./intake";
import { readLibraryIntakeDaemonState, writeLibraryIntakeDaemonState } from "./intake-daemon-state";
import { isoNow } from "./utils";

export const LIBRARY_FOREGROUND_POLL_MS = 60_000;
export const LIBRARY_BACKGROUND_POLL_MS = 5 * 60_000;

export interface LibraryIntakeDaemon {
  setForeground(value: boolean): void;
  checkNow(): void;
  stop(): void;
}

export function startLibraryIntakeDaemon(vaultPath: string, onQueueChanged: () => void): LibraryIntakeDaemon {
  const enabled = process.env.HILT_LIBRARY_INTAKE_DAEMON !== "0";
  let foreground = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = !enabled;
  let lastPolledAt: string | null = readLibraryIntakeDaemonState(vaultPath)?.last_polled_at || null;

  const persist = (nextPollAt: string | null) => writeLibraryIntakeDaemonState(vaultPath, {
    version: 1,
    enabled: !stopped,
    running,
    foreground,
    last_polled_at: lastPolledAt,
    next_poll_at: nextPollAt,
    updated_at: isoNow(),
  });

  const schedule = (delayMs: number) => {
    if (stopped) return;
    if (timer) clearTimeout(timer);
    const next = new Date(Date.now() + delayMs).toISOString();
    persist(next);
    timer = setTimeout(() => { void tick(); }, delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || running) return;
    timer = null;
    running = true;
    persist(null);
    try {
      const interval = foreground ? LIBRARY_FOREGROUND_POLL_MS : LIBRARY_BACKGROUND_POLL_MS;
      const report = await runLibraryIntake(vaultPath, {
        force: true,
        explicitOnly: true,
        pollIntervalMs: interval,
      });
      lastPolledAt = report.finished_at;
      onQueueChanged();
      if (report.errors.length) console.warn("[LibraryIntakeDaemon] Source errors:", report.errors.join("; "));
    } catch (error) {
      console.error("[LibraryIntakeDaemon] Check failed:", error);
    } finally {
      running = false;
      schedule(foreground ? LIBRARY_FOREGROUND_POLL_MS : LIBRARY_BACKGROUND_POLL_MS);
    }
  };

  const checkNow = () => {
    if (stopped || running) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { void tick(); }, 0);
    timer.unref?.();
  };

  if (enabled) {
    const persisted = readLibraryIntakeDaemonState(vaultPath);
    const next = persisted?.next_poll_at ? Date.parse(persisted.next_poll_at) : NaN;
    schedule(Number.isFinite(next) ? Math.max(1_000, Math.min(LIBRARY_BACKGROUND_POLL_MS, next - Date.now())) : 5_000);
  } else {
    persist(null);
  }

  return {
    setForeground(value: boolean) {
      if (foreground === value) return;
      foreground = value;
      if (value) checkNow();
      else schedule(LIBRARY_BACKGROUND_POLL_MS);
    },
    checkNow,
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = null;
      running = false;
      persist(null);
    },
  };
}
