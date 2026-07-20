import { execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import { deadLetterArtifactUrls, deadLetterResolved, readDeadLetters } from "./dead-letter";
import { listLibrarySources } from "./library";
import { libraryLaunchAgentsDir, librarySchedulerJobs, schedulerJobScheduleLabel, type LibrarySchedulerJobDefinition } from "./scheduler-jobs";
import { countReweaveBacklog } from "./reweave-pending";
import { readSourceState } from "./source-config";
import { readLibraryIntakeDaemonState } from "./intake-daemon-state";
import { processingQueueSummary } from "./processing";
import { readRecommendationRuntime } from "./recommendation-store";
import type {
  LibraryDeadLetterSummary,
  LibraryHealthIssue,
  LibraryHealthIssueSummary,
  LibraryOperationalHealth,
  LibraryReweaveBacklogSummary,
  LibrarySchedulerJobSummary,
  LibrarySourceHealthSummary,
} from "./types";
import { isoNow } from "./utils";

interface HealthOptions {
  launchctl?: (label: string) => string;
  schedulerJobs?: LibrarySchedulerJobDefinition[];
}

const EXCERPT_MAX_CHARS = 1800;
const CLASSIFY_MAX_CHARS = 64_000;
const ISSUE_MESSAGE_MAX_CHARS = 240;
// Scheduler jobs finish by writing their summary to stdout. If stderr has not changed within this
// window of the latest stdout completion, it belongs to an older append-only run and cannot describe
// the current job state. Actionable stderr is normally emitted near the terminal summary; this window
// is long enough for that gap while remaining shorter than the most frequent scheduler cadence.
const CURRENT_RUN_STDERR_WINDOW_MS = 30 * 60 * 1000;

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

function fileMtimeMs(filePath: string): number | null {
  try {
    return fs.statSync(filePath).mtimeMs;
  } catch {
    return null;
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

function stderrBelongsToLatestRun(stdoutPath: string, stderrPath: string, stderrBytes: number): boolean {
  if (stderrBytes <= 0) return false;
  const stdoutMtime = fileMtimeMs(stdoutPath);
  const stderrMtime = fileMtimeMs(stderrPath);
  if (stderrMtime === null || stdoutMtime === null) return true;
  if (stderrMtime >= stdoutMtime) return true;
  return stdoutMtime - stderrMtime <= CURRENT_RUN_STDERR_WINDOW_MS;
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
  const stderrIsCurrent = stderrBelongsToLatestRun(job.stdout, job.stderr, stderrBytes);
  const stderrExcerpt = stderrIsCurrent ? cleanSchedulerStderrExcerpt(fileTail(job.stderr)) : null;
  const stderrForClassification = stderrIsCurrent ? readLogText(job.stderr, CLASSIFY_MAX_CHARS) : null;
  const stderrIsBenign = stderrIsCurrent && isBenignSchedulerStderr(stderrForClassification);
  const actionableStderr = firstActionableStderrLine(stderrForClassification);
  const status: LibrarySchedulerJobSummary["status"] = !loaded
    ? "blocked"
    : lastExitCode !== null && lastExitCode !== 0
      ? "warning"
      : stderrIsCurrent && !stderrIsBenign
        ? "warning"
        : "ok";
  const message = !loaded
    ? "LaunchAgent is not loaded."
    : lastExitCode !== null && lastExitCode !== 0
      ? `Last run exited with code ${lastExitCode}.`
      : stderrIsCurrent && stderrIsBenign
        ? "Completed successfully; stderr only contains known scheduler noise."
      : stderrIsCurrent
          ? `Completed with stderr: ${actionableStderr || "expand for details."}`
          : stderrBytes > 0
            ? "Latest run completed cleanly; older stderr is retained in the log."
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
    stderr_current: stderrIsCurrent,
    stdout_excerpt: stdoutExcerpt,
    stderr_excerpt: stderrExcerpt,
    message,
    status,
  };
}

function safeIssueMessage(value: string, fallback: string): string {
  const normalized = value
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return fallback;
  return normalized.length <= ISSUE_MESSAGE_MAX_CHARS
    ? normalized
    : `${normalized.slice(0, ISSUE_MESSAGE_MAX_CHARS - 1).trimEnd()}…`;
}

function currentRecommendationError(runtime: ReturnType<typeof readRecommendationRuntime>): string | null {
  if (runtime.last_attempt_status === "failed") {
    return safeIssueMessage(runtime.last_attempt_error || "", "Recommendation editor failed; a retry is required.");
  }
  if (runtime.last_attempt_status === "running" || runtime.last_attempt_status === "success") return null;
  // Legacy last_error values predate sanitized receipts and may contain a complete CLI command.
  return runtime.last_error ? "Recommendation editor failed; a retry is required." : null;
}

function recommendationJobAfterRuntimeSuccess(
  job: LibrarySchedulerJobSummary,
  runtime: ReturnType<typeof readRecommendationRuntime>,
): LibrarySchedulerJobSummary {
  if (job.id !== "recommendations") return job;
  const successAt = runtime.last_attempt_status === "success"
    ? runtime.last_attempt_at || runtime.last_success_at
    : runtime.last_success_at;
  if (job.status !== "warning" || !successAt || !job.stderr_updated_at) {
    return {
      ...job,
      // Recommendation stderr historically included the CLI command and prompt. Runtime receipts
      // are now authoritative; never send that retained diagnostic payload through the health API.
      stderr_excerpt: null,
      message: job.status === "warning"
        ? currentRecommendationError(runtime) || "Recommendation editor reported a problem; a retry is scheduled."
        : job.message,
    };
  }
  const successMs = Date.parse(successAt);
  const stderrMs = Date.parse(job.stderr_updated_at);
  if (!Number.isFinite(successMs) || !Number.isFinite(stderrMs) || successMs <= stderrMs) {
    return {
      ...job,
      stderr_excerpt: null,
      message: currentRecommendationError(runtime) || "Recommendation editor reported a problem; a retry is scheduled.",
    };
  }
  return {
    ...job,
    status: "ok",
    stderr_current: false,
    stderr_excerpt: null,
    message: "A later recommendation run completed successfully; older stderr is retained in the log.",
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

function healthIssueSummary(issues: LibraryHealthIssue[]): LibraryHealthIssueSummary {
  const critical = issues.filter((issue) => issue.severity === "critical").length;
  const warning = issues.filter((issue) => issue.severity === "warning").length;
  const working = issues.filter((issue) => issue.severity === "working").length;
  return { critical, warning, working, alerts: critical + warning, total: issues.length };
}

function buildHealthIssues(input: {
  jobs: LibrarySchedulerJobSummary[];
  sources: LibrarySourceHealthSummary[];
  deadLetters: LibraryDeadLetterSummary;
  queue: ReturnType<typeof processingQueueSummary>;
  reweave: LibraryReweaveBacklogSummary;
  recommendations: ReturnType<typeof readRecommendationRuntime>;
}): LibraryHealthIssue[] {
  const issues: LibraryHealthIssue[] = [];
  const recommendationError = currentRecommendationError(input.recommendations);

  for (const job of input.jobs) {
    if (job.status === "ok") continue;
    if (job.id === "recommendations" && job.status === "warning" && recommendationError) continue;
    issues.push({
      id: job.id === "recommendations" ? "recommendations:job" : `scheduler:${job.id}`,
      severity: job.status === "blocked" ? "critical" : "warning",
      scope: job.id === "recommendations" ? "recommendations" : "scheduler",
      title: job.id === "recommendations" ? "Recommendations" : job.label,
      message: job.message || (job.status === "blocked" ? "Scheduled job is unavailable." : "Scheduled job needs attention."),
      count: 1,
      target_id: job.id,
      updated_at: laterIso(job.stdout_updated_at, job.stderr_updated_at),
    });
  }

  for (const source of input.sources) {
    if (source.status !== "blocked" && source.status !== "warning") continue;
    issues.push({
      id: `source:${source.id}`,
      severity: source.status === "blocked" ? "critical" : "warning",
      scope: "source",
      title: source.name,
      message: source.blocked || source.last_error || "Source needs attention.",
      count: 1,
      target_id: source.id,
      updated_at: source.last_checked,
    });
  }

  if (input.deadLetters.unresolved > 0) {
    issues.push({
      id: "dead_letters:unresolved",
      severity: "warning",
      scope: "dead_letters",
      title: "Dead letters",
      message: `${input.deadLetters.unresolved} ingestion failure${input.deadLetters.unresolved === 1 ? " remains" : "s remain"} unresolved.`,
      count: input.deadLetters.unresolved,
      target_id: null,
      updated_at: input.deadLetters.last_at,
    });
  }

  if (input.queue.blocked > 0) {
    issues.push({
      id: "intake:blocked",
      severity: "warning",
      scope: "intake",
      title: "Intake",
      message: `${input.queue.blocked} item${input.queue.blocked === 1 ? " is" : "s are"} blocked and needs source recovery or a disposition.`,
      count: input.queue.blocked,
      target_id: null,
      updated_at: null,
    });
  }
  if (input.queue.queue_depth > 0 || input.queue.active > 0) {
    issues.push({
      id: "intake:processing",
      severity: "working",
      scope: "intake",
      title: "Intake",
      message: input.queue.active > 0
        ? `${input.queue.active} item${input.queue.active === 1 ? " is" : "s are"} processing now.`
        : `${input.queue.queue_depth} item${input.queue.queue_depth === 1 ? " is" : "s are"} queued for processing.`,
      count: Math.max(input.queue.queue_depth, input.queue.active),
      target_id: input.queue.active_item?.artifact_uid || null,
      updated_at: input.queue.oldest_queued_at,
    });
  }

  if (input.reweave.backlog > 0) {
    issues.push({
      id: "reweave:backlog",
      severity: "working",
      scope: "reweave",
      title: "Context enrichment",
      message: `${input.reweave.backlog} item${input.reweave.backlog === 1 ? " is" : "s are"} queued for scheduled context enrichment.`,
      count: input.reweave.backlog,
      target_id: null,
      updated_at: input.reweave.last_drained_at,
    });
  }

  if (recommendationError) {
    issues.push({
      id: "recommendations:runtime",
      severity: "warning",
      scope: "recommendations",
      title: "Recommendations",
      message: recommendationError,
      count: 1,
      target_id: null,
      updated_at: input.recommendations.next_retry_at,
    });
  } else if (input.recommendations.pending) {
    issues.push({
      id: "recommendations:pending",
      severity: "working",
      scope: "recommendations",
      title: "Recommendations",
      message: input.recommendations.pending_reasons.length
        ? `Refresh queued after ${input.recommendations.pending_reasons.length} relevant change${input.recommendations.pending_reasons.length === 1 ? "" : "s"}.`
        : "Recommendation refresh queued.",
      count: 1,
      target_id: null,
      updated_at: input.recommendations.next_retry_at,
    });
  }

  return issues.map((issue) => ({
    ...issue,
    message: safeIssueMessage(issue.message, `${issue.title} needs attention.`),
  }));
}

export function getLibraryOperationalHealth(vaultPath: string, options: HealthOptions = {}): LibraryOperationalHealth {
  const definitions = options.schedulerJobs || librarySchedulerJobs();
  const recommendationRuntime = readRecommendationRuntime(vaultPath);
  const jobs = definitions
    .map((job) => schedulerStatus(job, options))
    .map((job) => recommendationJobAfterRuntimeSuccess(job, recommendationRuntime));
  const state = readSourceState(vaultPath);
  const sources = sourceHealth(vaultPath, state);
  const deadLetters = deadLetterSummary(vaultPath, state);
  const backlog = countReweaveBacklog(vaultPath);
  const nightly = definitions.find((job) => job.id === "reweave-pending");
  const reweave: LibraryReweaveBacklogSummary = {
    backlog: backlog.total,
    pending: backlog.pending,
    version_behind: backlog.version_behind,
    last_drained_at: nightly ? laterIso(fileUpdatedAt(nightly.stdout), fileUpdatedAt(nightly.stderr)) : null,
    last_throttled_at: nightly ? laterIso(lastRateLimitAt(nightly.stdout), lastRateLimitAt(nightly.stderr)) : null,
  };
  const daemon = readLibraryIntakeDaemonState(vaultPath);
  const queue = processingQueueSummary(vaultPath);
  const recommendations = recommendationRuntime;
  const issues = buildHealthIssues({ jobs, sources, deadLetters, queue, reweave, recommendations });
  const summary = healthIssueSummary(issues);
  const status: LibraryOperationalHealth["status"] = summary.critical > 0
    ? "critical"
    : summary.warning > 0
      ? "warning"
      : summary.working > 0
        ? "working"
        : "healthy";

  return {
    checked_at: isoNow(),
    ok: summary.alerts === 0,
    status,
    summary,
    issues,
    scheduler: {
      loaded: jobs.filter((job) => job.loaded).length,
      expected: jobs.length,
      jobs,
    },
    sources,
    dead_letters: deadLetters,
    reweave,
    intake: {
      enabled: daemon?.enabled ?? process.env.HILT_LIBRARY_INTAKE_DAEMON !== "0",
      running: daemon?.running ?? false,
      last_polled_at: daemon?.last_polled_at ?? null,
      next_poll_at: daemon?.next_poll_at ?? null,
      foreground: daemon?.foreground ?? false,
      ...queue,
    },
    recommendations: {
      last_success_at: recommendations.last_success_at,
      last_batch_id: recommendations.last_batch_id,
      last_batch_size: recommendations.last_batch_size,
      last_run_kind: recommendations.last_run_kind,
      last_attempt_at: recommendations.last_attempt_at,
      last_attempt_kind: recommendations.last_attempt_kind,
      last_attempt_status: recommendations.last_attempt_status,
      last_attempt_error: currentRecommendationError(recommendations),
      pending: recommendations.pending,
      pending_reasons: recommendations.pending_reasons,
      next_retry_at: recommendations.next_retry_at,
      last_error: currentRecommendationError(recommendations),
    },
  };
}
