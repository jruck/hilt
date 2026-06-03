import fs from "fs/promises";
import fsSync from "fs";
import os from "os";
import path from "path";

export type BriefingRunStatus = "failed";
export type BriefingFailureKind = "quota" | "rate_limit" | "model" | "unknown";

export interface BriefingRunFailure {
  status: BriefingRunStatus;
  kind: BriefingFailureKind;
  date: string;
  jobId: string;
  jobName: string;
  runAt: string;
  nextRunAt: string | null;
  error: string;
  outputPath: string | null;
}

interface HermesCronJob {
  id?: unknown;
  name?: unknown;
  skill?: unknown;
  skills?: unknown;
  script?: unknown;
  last_status?: unknown;
  last_error?: unknown;
  last_run_at?: unknown;
  next_run_at?: unknown;
}

interface HermesJobsFile {
  jobs?: HermesCronJob[];
}

interface HermesStatusOptions {
  homeDir?: string;
  now?: Date;
}

const ET_TIME_ZONE = "America/New_York";

export function getEasternDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) {
    return date.toISOString().slice(0, 10);
  }
  return `${year}-${month}-${day}`;
}

function getHomeDir(options?: HermesStatusOptions): string {
  return options?.homeDir ?? os.homedir();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function classifyError(error: string): BriefingFailureKind {
  const lower = error.toLowerCase();
  if (lower.includes("out of extra usage") || lower.includes("quota")) {
    return "quota";
  }
  if (lower.includes("rate limit") || lower.includes("rate_limit")) {
    return "rate_limit";
  }
  if (lower.includes("model") || lower.includes("provider") || lower.includes("anthropic")) {
    return "model";
  }
  return "unknown";
}

function isBriefingJob(job: HermesCronJob): boolean {
  const name = asString(job.name)?.toLowerCase() ?? "";
  const skill = asString(job.skill)?.toLowerCase() ?? "";
  const script = asString(job.script)?.toLowerCase() ?? "";
  const skills = Array.isArray(job.skills)
    ? job.skills.map((item) => asString(item)?.toLowerCase()).filter(Boolean)
    : [];

  return (
    name.includes("morning briefing") ||
    skill === "briefing" ||
    script.includes("briefing") ||
    skills.includes("briefing")
  );
}

async function findCronOutputPath(homeDir: string, jobId: string, date: string): Promise<string | null> {
  const outputDir = path.join(homeDir, ".hermes", "cron", "output", jobId);
  try {
    const files = await fs.readdir(outputDir);
    const matches = files
      .filter((file) => file.startsWith(`${date}_`) && file.endsWith(".md"))
      .sort()
      .reverse();
    return matches[0] ? path.join(outputDir, matches[0]) : null;
  } catch {
    return null;
  }
}

export async function getHermesBriefingFailureForDate(
  date: string,
  options?: HermesStatusOptions
): Promise<BriefingRunFailure | null> {
  const homeDir = getHomeDir(options);
  const jobsPath = path.join(homeDir, ".hermes", "cron", "jobs.json");

  let parsed: HermesJobsFile;
  try {
    const raw = await fs.readFile(jobsPath, "utf-8");
    parsed = JSON.parse(raw) as HermesJobsFile;
  } catch {
    return null;
  }

  const failedJobs = (parsed.jobs ?? [])
    .filter(isBriefingJob)
    .filter((job) => asString(job.last_status) === "error")
    .filter((job) => {
      const runAt = asString(job.last_run_at);
      return runAt ? getEasternDate(new Date(runAt)) === date : false;
    })
    .sort((a, b) => {
      const aRun = asString(a.last_run_at) ?? "";
      const bRun = asString(b.last_run_at) ?? "";
      return bRun.localeCompare(aRun);
    });

  const job = failedJobs[0];
  if (!job) return null;

  const jobId = asString(job.id);
  const runAt = asString(job.last_run_at);
  const error = asString(job.last_error);
  if (!jobId || !runAt || !error) return null;

  return {
    status: "failed",
    kind: classifyError(error),
    date,
    jobId,
    jobName: asString(job.name) ?? "Morning Briefing",
    runAt,
    nextRunAt: asString(job.next_run_at),
    error,
    outputPath: await findCronOutputPath(homeDir, jobId, date),
  };
}

export function resolveHermesBinary(): string | null {
  const configured = process.env.HERMES_BIN;
  if (configured && fsSync.existsSync(configured)) {
    return configured;
  }

  const defaultPath = path.join(os.homedir(), ".local", "bin", "hermes");
  if (fsSync.existsSync(defaultPath)) {
    return defaultPath;
  }

  return null;
}
