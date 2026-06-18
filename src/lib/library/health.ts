import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { deadLetterArtifactUrls, deadLetterResolved, readDeadLetters } from "./dead-letter";
import { listLibrarySources } from "./library";
import { libraryLaunchAgentsDir, librarySchedulerJobs, schedulerJobScheduleLabel, type LibrarySchedulerJobDefinition } from "./scheduler-jobs";
import { countReweaveBacklog } from "./reweave-pending";
import { readSourceState } from "./source-config";
import type { LibraryDeadLetterSummary, LibraryOperationalHealth, LibraryReweaveBacklogSummary, LibrarySchedulerJobSummary, LibrarySourceHealthSummary } from "./types";
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

/** Last sign of Claude-window pressure in a drain log: the backfill stamps each pause with a timestamp;
 *  the reweave-pending drain reports rate_limited in its JSON (no inline ts), so fall back to mtime. */
function lastRateLimitAt(filePath: string): string | null {
  let text: string;
  try {
    text = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
  const backfill = text.match(/\[backfill (\d{4}-\d{2}-\d{2}T[\d:.]+Z)\][^\n]*RATE LIMIT/g);
  if (backfill?.length) return backfill[backfill.length - 1].match(/(\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1] ?? null;
  // Only the LATEST drain run counts: launchd appends runs to the same log, so a historical
  // rate_limited line would otherwise pin last_throttled_at to the file mtime forever, long after
  // the drains turned clean. Each npm run starts with "> hilt@..." header lines — test only the
  // text after the last one (a headerless log degrades to testing the whole file, as before).
  const headerIndex = text.lastIndexOf("\n> ");
  const lastRun = headerIndex >= 0 ? text.slice(headerIndex) : text;
  if (/"status":\s*"rate_limited"/.test(lastRun)) return fileUpdatedAt(filePath);
  return null;
}

function laterIso(a: string | null, b: string | null): string | null {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(a) >= Date.parse(b) ? a : b;
}

function isBenignSchedulerStderr(stderr: string | null): boolean {
  if (!stderr) return true;
  const normalized = stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return normalized.length > 0 && normalized.every(isKnownSchedulerNoiseLine);
}

function firstActionableStderrLine(stderr: string | null): string | null {
  if (!stderr) return null;
  return stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => !isKnownSchedulerNoiseLine(line)) || null;
}

function isKnownSchedulerNoiseLine(line: string): boolean {
  return /^\(Use `node --trace-deprecation/.test(line)
    || /\[DEP0205\] DeprecationWarning: `module\.register\(\)` is deprecated/.test(line)
    || /^npm notice\b/.test(line)
    || /^\[refetch\]\s+RECOVERED\b/.test(line);
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
        ? "Completed successfully; stderr only contains known scheduler noise."
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

function sourceHealth(vaultPath: string, state: ReturnType<typeof readSourceState>): LibrarySourceHealthSummary[] {
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

function deadLetterSummary(vaultPath: string, state: ReturnType<typeof readSourceState>): LibraryDeadLetterSummary {
  const entries = readDeadLetters(vaultPath);
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const bySource = new Map<string, number>();
  const artifactUrls = entries.some((entry) => entry.artifact_url) ? deadLetterArtifactUrls(vaultPath) : undefined;
  let unresolved = 0;
  for (const entry of entries) {
    bySource.set(entry.source_id, (bySource.get(entry.source_id) || 0) + 1);
    // Source-level failures resolve after a later source success; artifact failures resolve
    // only once that artifact exists in saved, archived, or candidate storage.
    if (!deadLetterResolved(entry, state, artifactUrls)) unresolved += 1;
  }
  return {
    total: entries.length,
    recent_24h: entries.filter((entry) => {
      const time = new Date(entry.at).getTime();
      return Number.isFinite(time) && time >= since;
    }).length,
    unresolved,
    last_at: entries.at(-1)?.at || null,
    by_source: Array.from(bySource.entries())
      .map(([source_id, count]) => ({ source_id, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export function getLibraryOperationalHealth(vaultPath: string, options: HealthOptions = {}): LibraryOperationalHealth {
  const definitions = options.schedulerJobs || librarySchedulerJobs();
  const jobs = definitions.map((job) => schedulerStatus(job, options));
  const state = readSourceState(vaultPath);
  const sources = sourceHealth(vaultPath, state);
  const deadLetters = deadLetterSummary(vaultPath, state);
  const ok = jobs.every((job) => job.status !== "blocked")
    && sources.every((source) => source.status !== "blocked")
    && deadLetters.unresolved === 0;

  const backlog = countReweaveBacklog(vaultPath);
  const nightly = definitions.find((job) => job.id === "reweave-pending");
  const reweave: LibraryReweaveBacklogSummary = {
    backlog: backlog.total,
    pending: backlog.pending,
    version_behind: backlog.version_behind,
    last_drained_at: nightly ? laterIso(fileUpdatedAt(nightly.stdout), fileUpdatedAt(nightly.stderr)) : null,
    last_throttled_at: nightly ? laterIso(lastRateLimitAt(nightly.stdout), lastRateLimitAt(nightly.stderr)) : null,
  };

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
    reweave,
  };
}
