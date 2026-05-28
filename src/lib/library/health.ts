import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { readDeadLetters } from "./dead-letter";
import { listLibrarySources } from "./library";
import { libraryLaunchAgentsDir, librarySchedulerJobs, schedulerJobScheduleLabel, type LibrarySchedulerJobDefinition } from "./scheduler-jobs";
import { readSourceState } from "./source-config";
import type { LibraryDeadLetterSummary, LibraryOperationalHealth, LibrarySchedulerJobSummary, LibrarySourceHealthSummary } from "./types";
import { isoNow } from "./utils";

interface HealthOptions {
  launchctl?: (label: string) => string;
  schedulerJobs?: LibrarySchedulerJobDefinition[];
}

const EXCERPT_MAX_CHARS = 1800;
const CLASSIFY_MAX_CHARS = 64_000;

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

function readLogText(filePath: string, maxChars: number): string | null {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const trimmed = content.trim();
    if (!trimmed) return null;
    if (trimmed.length <= maxChars) return trimmed;
    const excerpt = trimmed.slice(-maxChars);
    const firstLineBreak = excerpt.indexOf("\n");
    return (firstLineBreak >= 0 ? excerpt.slice(firstLineBreak + 1) : excerpt).trim();
  } catch {
    return null;
  }
}

function fileTail(filePath: string): string | null {
  return readLogText(filePath, EXCERPT_MAX_CHARS);
}

function cleanSchedulerStderrExcerpt(stderr: string | null): string | null {
  if (!stderr) return null;
  const lines = stderr.split(/\r?\n/);
  if (lines.length > 1 && /^\(Use `node --trace-deprecation/.test(lines[0].trim())) {
    return lines.slice(1).join("\n").trim() || null;
  }
  return stderr;
}

function parseLastExitCode(output: string): number | null {
  const match = output.match(/last exit code\s*=\s*(-?\d+)/i) || output.match(/LastExitStatus\s*=\s*(-?\d+)/i);
  return match ? Number(match[1]) : null;
}

function isBenignSchedulerStderr(stderr: string | null): boolean {
  if (!stderr) return true;
  const normalized = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(Use `node --trace-deprecation/.test(line));
  return normalized.length > 0 && normalized.every((line) => /\[DEP0205\] DeprecationWarning: `module\.register\(\)` is deprecated/.test(line));
}

function firstActionableStderrLine(stderr: string | null): string | null {
  if (!stderr) return null;
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(Use `node --trace-deprecation/.test(line))
    .find((line) => !/\[DEP0205\] DeprecationWarning: `module\.register\(\)` is deprecated/.test(line)) || null;
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
  const stdoutExcerpt = fileTail(job.stdout);
  const stderrExcerpt = cleanSchedulerStderrExcerpt(fileTail(job.stderr));
  const stderrForClassification = readLogText(job.stderr, CLASSIFY_MAX_CHARS);
  const stderrIsBenign = stderrBytes > 0 && isBenignSchedulerStderr(stderrForClassification);
  const actionableStderr = firstActionableStderrLine(stderrForClassification);
  const status: LibrarySchedulerJobSummary["status"] = !loaded
    ? "blocked"
    : lastExitCode !== null && lastExitCode !== 0
      ? "warning"
      : stderrBytes > 0 && !stderrIsBenign
        ? "warning"
        : "ok";
  const message = !loaded
    ? "LaunchAgent is not loaded."
    : lastExitCode !== null && lastExitCode !== 0
      ? `Last run exited with code ${lastExitCode}.`
      : stderrBytes > 0 && stderrIsBenign
        ? "Completed successfully; stderr only contains known Node/tsx deprecation noise."
      : stderrBytes > 0
          ? `Completed with stderr: ${actionableStderr || "expand for details."}`
          : "Loaded and clean.";

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
    stdout_excerpt: stdoutExcerpt,
    stderr_excerpt: stderrExcerpt,
    message,
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
  const jobs = (options.schedulerJobs || librarySchedulerJobs()).map((job) => schedulerStatus(job, options));
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
