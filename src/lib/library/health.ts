import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { readDeadLetters } from "./dead-letter";
import { listLibrarySources } from "./library";
import { libraryLaunchAgentsDir, librarySchedulerJobs, schedulerJobScheduleLabel } from "./scheduler-jobs";
import { readSourceState } from "./source-config";
import type { LibraryDeadLetterSummary, LibraryOperationalHealth, LibrarySchedulerJobSummary, LibrarySourceHealthSummary } from "./types";
import { isoNow } from "./utils";

interface HealthOptions {
  launchctl?: (label: string) => string;
}

function defaultLaunchctl(label: string): string {
  const uid = process.getuid?.();
  if (uid === undefined) return "";
  return execFileSync("launchctl", ["print", `gui/${uid}/${label}`], { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
}

function fileUpdatedAt(filePath: string): string | null {
  try {
    return fs.statSync(filePath).mtime.toISOString();
  } catch {
    return null;
  }
}

function fileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

function parseLastExitCode(output: string): number | null {
  const match = output.match(/last exit code\s*=\s*(-?\d+)/i) || output.match(/LastExitStatus\s*=\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function schedulerStatus(job: ReturnType<typeof librarySchedulerJobs>[number], options: HealthOptions): LibrarySchedulerJobSummary {
  const plistPath = path.join(libraryLaunchAgentsDir(), `${job.label}.plist`);
  let loaded = false;
  let lastExitCode: number | null = null;
  try {
    const output = (options.launchctl || defaultLaunchctl)(job.label);
    loaded = true;
    lastExitCode = parseLastExitCode(output);
  } catch {
    loaded = false;
  }

  const stderrBytes = fileSize(job.stderr);
  const status: LibrarySchedulerJobSummary["status"] = !loaded
    ? "blocked"
    : lastExitCode !== null && lastExitCode !== 0
      ? "warning"
      : stderrBytes > 0
        ? "warning"
        : "ok";

  return {
    id: job.id,
    label: job.label,
    schedule: schedulerJobScheduleLabel(job.schedule),
    loaded,
    installed: fs.existsSync(plistPath),
    last_exit_code: lastExitCode,
    plist_path: plistPath,
    stdout_path: job.stdout,
    stderr_path: job.stderr,
    stdout_updated_at: fileUpdatedAt(job.stdout),
    stderr_updated_at: fileUpdatedAt(job.stderr),
    stderr_bytes: stderrBytes,
    status,
  };
}

function sourceHealth(vaultPath: string): LibrarySourceHealthSummary[] {
  const state = readSourceState(vaultPath);
  return listLibrarySources(vaultPath).map((source) => {
    const entry = state[source.id] || {};
    const status: LibrarySourceHealthSummary["status"] = !source.enabled
      ? "disabled"
      : source.blocked
        ? "blocked"
        : entry.last_error
          ? "warning"
          : "ok";
    return {
      ...source,
      status,
      last_checked: entry.last_checked_at || null,
      last_error: entry.last_error || null,
    };
  });
}

function deadLetterSummary(vaultPath: string): LibraryDeadLetterSummary {
  const entries = readDeadLetters(vaultPath);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const bySource = new Map<string, number>();
  for (const entry of entries) {
    bySource.set(entry.source_id, (bySource.get(entry.source_id) || 0) + 1);
  }
  return {
    total: entries.length,
    recent_24h: entries.filter((entry) => {
      const time = new Date(entry.at).getTime();
      return Number.isFinite(time) && time >= since;
    }).length,
    last_at: entries.at(-1)?.at || null,
    by_source: Array.from(bySource.entries())
      .map(([source_id, count]) => ({ source_id, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function getLibraryOperationalHealth(vaultPath: string, options: HealthOptions = {}): LibraryOperationalHealth {
  const jobs = librarySchedulerJobs().map((job) => schedulerStatus(job, options));
  const sources = sourceHealth(vaultPath);
  const deadLetters = deadLetterSummary(vaultPath);
  const ok = jobs.every((job) => job.status !== "blocked")
    && sources.every((source) => source.status !== "blocked")
    && deadLetters.recent_24h === 0;

  return {
    checked_at: isoNow(),
    ok,
    scheduler: {
      loaded: jobs.filter((job) => job.loaded).length,
      expected: jobs.length,
      jobs,
    },
    sources,
    dead_letters: deadLetters,
  };
}
