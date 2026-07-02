import fs from "fs/promises";
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
  autoRetryNextRunAt: string | null;
  error: string;
  outputPath: string | null;
}

interface BriefingStatusOptions {
  dataDir?: string;
  vaultPath?: string;
  now?: Date;
  /** Kept only so older callers/tests passing the Hermes-era option shape still type-check. */
  homeDir?: string;
}

type NativeRunStatus = "ok" | "invalid" | "rate_limited";

interface NativeBriefingRunRecord {
  date: string;
  mode: "daily" | "weekend";
  run_at: string;
  status: NativeRunStatus;
  failures: string[];
  draft_path?: string;
  committed?: boolean;
  pushed?: boolean;
}

const ET_TIME_ZONE = "America/New_York";
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAILY_JOB_ID = "native-daily";
const DAILY_JOB_NAME = "Morning Briefing (native)";

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

function getEasternDateTime(date = new Date()): { date: string; minutes: number; seconds: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ET_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  const hour = parts.find((part) => part.type === "hour")?.value;
  const minute = parts.find((part) => part.type === "minute")?.value;
  const second = parts.find((part) => part.type === "second")?.value;
  if (!year || !month || !day || !hour || !minute || !second) {
    return {
      date: date.toISOString().slice(0, 10),
      minutes: date.getHours() * 60 + date.getMinutes(),
      seconds: date.getSeconds(),
    };
  }
  return {
    date: `${year}-${month}-${day}`,
    minutes: Number(hour) * 60 + Number(minute),
    seconds: Number(second),
  };
}

function parseIsoDate(date: string): Date {
  return new Date(`${date}T12:00:00.000Z`);
}

function addDays(date: string, days: number): string {
  const d = parseIsoDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayForIsoDate(date: string): number {
  return parseIsoDate(date).getUTCDay();
}

function localMinuteIndex(date: string, minutes: number): number {
  const [year, month, day] = date.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 60_000 + minutes;
}

function dateAtEasternTime(date: string, minutes: number): Date {
  const [year, month, day] = date.split("-").map(Number);
  let ms = Date.UTC(year, month - 1, day, Math.floor(minutes / 60), minutes % 60);
  const desired = localMinuteIndex(date, minutes);
  for (let i = 0; i < 3; i++) {
    const actual = getEasternDateTime(new Date(ms));
    const diff = desired - localMinuteIndex(actual.date, actual.minutes);
    if (diff === 0) break;
    ms += diff * 60_000;
  }
  return new Date(ms);
}

function nextDailyRunAt(now = new Date()): string {
  const eastern = getEasternDateTime(now);
  let runDate = eastern.date;
  let runAt = dateAtEasternTime(runDate, 6 * 60);
  if (runAt.getTime() <= now.getTime()) {
    runDate = addDays(runDate, 1);
    runAt = dateAtEasternTime(runDate, 6 * 60);
  }
  return runAt.toISOString();
}

function nextAutoRetryRunAt(date: string, now = new Date()): string | null {
  const eastern = getEasternDateTime(now);
  if (eastern.date !== date) return null;
  const weekday = weekdayForIsoDate(eastern.date);
  if (weekday === 0 || weekday === 6) return null;

  const startMinutes = 6 * 60 + 30;
  const stopMinutes = 17 * 60;
  const secondsInDay = eastern.minutes * 60 + eastern.seconds;
  if (secondsInDay > stopMinutes * 60) return null;

  const boundaryMinutes = secondsInDay <= startMinutes * 60
    ? startMinutes
    : Math.ceil(secondsInDay / (30 * 60)) * 30;
  if (boundaryMinutes > stopMinutes) return null;
  return dateAtEasternTime(eastern.date, boundaryMinutes).toISOString();
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asFailures(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item): item is string => Boolean(item))
    : [];
}

function classifyFailure(record: NativeBriefingRunRecord): BriefingFailureKind {
  const text = record.failures.join(" ").toLowerCase();
  if (text.includes("rate limit") || text.includes("rate_limit") || text.includes("rate-limited")) {
    return "rate_limit";
  }
  if (record.status === "invalid") return "model";
  return "unknown";
}

function resolveVaultPath(options?: BriefingStatusOptions): string {
  return options?.vaultPath
    || process.env.BRIDGE_VAULT_PATH
    || process.env.HILT_WORKING_FOLDER
    || path.join(os.homedir(), "work", "bridge");
}

function resolveDataDir(options?: BriefingStatusOptions): string {
  return options?.dataDir || process.env.DATA_DIR || "data";
}

async function dailyBriefingExists(date: string, options?: BriefingStatusOptions): Promise<boolean> {
  const filePath = path.join(resolveVaultPath(options), "briefings", `${date}.md`);
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readRunRecord(date: string, options?: BriefingStatusOptions): Promise<NativeBriefingRunRecord | null> {
  const filePath = path.join(resolveDataDir(options), "briefing-runs", `${date}.json`);
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const status = asString(parsed.status);
    const mode = asString(parsed.mode);
    const runAt = asString(parsed.run_at);
    const recordDate = asString(parsed.date);
    if (
      recordDate !== date
      || (mode !== "daily" && mode !== "weekend")
      || (status !== "ok" && status !== "invalid" && status !== "rate_limited")
      || !runAt
    ) {
      return null;
    }
    return {
      date: recordDate,
      mode,
      run_at: runAt,
      status,
      failures: asFailures(parsed.failures),
      ...(asString(parsed.draft_path) ? { draft_path: asString(parsed.draft_path) ?? undefined } : {}),
      ...(typeof parsed.committed === "boolean" ? { committed: parsed.committed } : {}),
      ...(typeof parsed.pushed === "boolean" ? { pushed: parsed.pushed } : {}),
    };
  } catch {
    return null;
  }
}

export async function getBriefingFailureForDate(
  date: string,
  options?: BriefingStatusOptions,
): Promise<BriefingRunFailure | null> {
  if (!ISO_DATE_RE.test(date)) return null;
  if (await dailyBriefingExists(date, options)) return null;

  const record = await readRunRecord(date, options);
  if (!record || record.mode !== "daily" || record.status === "ok") return null;

  const failures = record.failures.length
    ? record.failures
    : record.status === "rate_limited"
      ? ["Claude rate limit while generating briefing"]
      : ["Briefing validation failed"];

  return {
    status: "failed",
    kind: classifyFailure({ ...record, failures }),
    date,
    jobId: DAILY_JOB_ID,
    jobName: DAILY_JOB_NAME,
    runAt: record.run_at,
    nextRunAt: nextDailyRunAt(options?.now),
    autoRetryNextRunAt: nextAutoRetryRunAt(date, options?.now),
    error: failures.join("; "),
    outputPath: record.draft_path ?? null,
  };
}

export async function getNativeBriefingFailureForDate(
  date: string,
  options?: BriefingStatusOptions,
): Promise<BriefingRunFailure | null> {
  return getBriefingFailureForDate(date, options);
}

export async function getHermesBriefingFailureForDate(
  date: string,
  options?: BriefingStatusOptions,
): Promise<BriefingRunFailure | null> {
  return getBriefingFailureForDate(date, options);
}
