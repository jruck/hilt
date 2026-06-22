import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import type { BriefingRunFailure } from "./briefing-status";

export type BriefingKind = "daily" | "weekend";
export type BriefingStatus = "ready" | "failed";

export interface BriefingDateRange {
  start: string;
  end: string;
}

export interface BriefingSummary {
  id: string;
  kind: BriefingKind;
  date: string;
  title: string;
  summary: string | null;
  dateRange?: BriefingDateRange;
  status?: BriefingStatus;
  run?: BriefingRunFailure;
}

export interface BriefingDetail extends BriefingSummary {
  content: string;
  /** Absolute path to the briefing markdown file — for portable references. */
  absPath: string;
}

interface ParsedBriefingId {
  id: string;
  kind: BriefingKind;
  date: string;
  relativePath: string;
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEKEND_ID_RE = /^weekend:(\d{4}-\d{2}-\d{2})$/;

export function makeDailyBriefingId(date: string): string {
  return date;
}

export function makeWeekendBriefingId(startDate: string): string {
  return `weekend:${startDate}`;
}

export function parseBriefingId(rawId: string): ParsedBriefingId | null {
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return null;
  }
  if (ISO_DATE_RE.test(id)) {
    return {
      id: makeDailyBriefingId(id),
      kind: "daily",
      date: id,
      relativePath: path.join("briefings", `${id}.md`),
    };
  }

  const weekend = id.match(WEEKEND_ID_RE);
  if (weekend) {
    const date = weekend[1];
    return {
      id: makeWeekendBriefingId(date),
      kind: "weekend",
      date,
      relativePath: path.join("briefings", "weekend", `${date}.md`),
    };
  }

  return null;
}

function asIsoDate(value: unknown): string | null {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) return value;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  return null;
}

function getDateRange(data: Record<string, unknown>, fallbackStart: string): BriefingDateRange | undefined {
  const nested = data.date_range;
  const start = typeof nested === "object" && nested
    ? asIsoDate((nested as Record<string, unknown>).start)
    : asIsoDate(data["date_range.start"]);
  const end = typeof nested === "object" && nested
    ? asIsoDate((nested as Record<string, unknown>).end)
    : asIsoDate(data["date_range.end"]);

  if (start && end) return { start, end };
  const fallbackEnd = new Date(`${fallbackStart}T00:00:00`);
  fallbackEnd.setDate(fallbackEnd.getDate() + 1);
  return { start: fallbackStart, end: fallbackEnd.toISOString().slice(0, 10) };
}

function formatDateRangeTitle(range: BriefingDateRange): string {
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: sameYear ? undefined : "numeric",
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: start.getMonth() === end.getMonth() ? undefined : "short",
    day: "numeric",
    year: "numeric",
  }).format(end);
  return `Weekend Briefing — ${startLabel}-${endLabel}`;
}

function buildBriefingPayload(
  parsed: ParsedBriefingId,
  raw: string,
  includeContent: false
): BriefingSummary;
function buildBriefingPayload(
  parsed: ParsedBriefingId,
  raw: string,
  includeContent: true,
  absPath: string
): BriefingDetail;
function buildBriefingPayload(
  parsed: ParsedBriefingId,
  raw: string,
  includeContent: boolean,
  absPath?: string
): BriefingSummary | BriefingDetail {
  const { data, content } = matter(raw);
  const dateRange = parsed.kind === "weekend" ? getDateRange(data, parsed.date) : undefined;
  const title = typeof data.title === "string" && data.title.trim()
    ? data.title.trim()
    : parsed.kind === "weekend" && dateRange
      ? formatDateRangeTitle(dateRange)
      : `Briefing — ${parsed.date}`;

  const summary: BriefingSummary = {
    id: parsed.id,
    kind: parsed.kind,
    date: parsed.date,
    title,
    summary: typeof data.summary === "string" && data.summary.trim() ? data.summary.trim() : null,
    ...(dateRange ? { dateRange } : {}),
  };

  if (!includeContent) return summary;
  return {
    ...summary,
    content: content.trim(),
    absPath: absPath ?? "",
  };
}

async function listMarkdownDates(dir: string): Promise<string[]> {
  try {
    const files = await fs.readdir(dir);
    return files
      .filter((file) => file.endsWith(".md") && ISO_DATE_RE.test(file.replace(/\.md$/, "")))
      .map((file) => file.replace(/\.md$/, ""));
  } catch {
    return [];
  }
}

export async function listBriefingSummaries(vaultPath: string): Promise<BriefingSummary[]> {
  const briefingsDir = path.join(vaultPath, "briefings");
  const [dailyDates, weekendDates] = await Promise.all([
    listMarkdownDates(briefingsDir),
    listMarkdownDates(path.join(briefingsDir, "weekend")),
  ]);

  const parsedIds = [
    ...dailyDates.map((date) => parseBriefingId(makeDailyBriefingId(date))),
    ...weekendDates.map((date) => parseBriefingId(makeWeekendBriefingId(date))),
  ].filter((parsed): parsed is ParsedBriefingId => Boolean(parsed));

  const briefings = await Promise.all(
    parsedIds.map(async (parsed) => {
      const raw = await fs.readFile(path.join(vaultPath, parsed.relativePath), "utf-8");
      return buildBriefingPayload(parsed, raw, false);
    })
  );

  briefings.sort((a, b) => {
    const dateCompare = b.date.localeCompare(a.date);
    if (dateCompare !== 0) return dateCompare;
    if (a.kind !== b.kind) return a.kind === "weekend" ? -1 : 1;
    return b.id.localeCompare(a.id);
  });

  return briefings;
}

export async function readBriefingById(vaultPath: string, id: string): Promise<BriefingDetail | null> {
  const parsed = parseBriefingId(id);
  if (!parsed) return null;

  const filePath = path.join(vaultPath, parsed.relativePath);
  const raw = await fs.readFile(filePath, "utf-8");
  return buildBriefingPayload(parsed, raw, true, filePath);
}
