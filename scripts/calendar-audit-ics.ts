import { loadEnvConfig } from "@next/env";
import ICAL from "ical.js";
import { CALENDAR_SOURCE_CONFIGS, getSyncWindow, sourceUrl, type CalendarSourceConfig } from "../src/lib/calendar/config";
import { parseIcsFeed } from "../src/lib/calendar/ics";

interface AuditIssue {
  sourceId: string;
  uid: string | null;
  recurrenceId: string;
  summary: string;
  start: string;
  end: string;
}

interface AuditResult {
  sourceId: string;
  configured: boolean;
  rawExceptionsInWindow: number;
  parsedEventsWithRecurrenceIds: number;
  missingExceptions: AuditIssue[];
}

loadEnvConfig(process.cwd());

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const sourceFilter = stringFlag(flags.source);
  const sources = CALENDAR_SOURCE_CONFIGS.filter((source) => !sourceFilter || source.id === sourceFilter);
  if (!sources.length) throw new Error(`No calendar source matched: ${sourceFilter}`);

  const window = getSyncWindow();
  const results = await Promise.all(sources.map((source) => auditSource(source, window)));
  console.log(JSON.stringify({ window: { start: window.startIso, end: window.endIso }, results }, null, 2));

  const missingCount = results.reduce((sum, result) => sum + result.missingExceptions.length, 0);
  if (missingCount > 0) {
    process.exitCode = 1;
  }
}

async function auditSource(source: CalendarSourceConfig, window: ReturnType<typeof getSyncWindow>): Promise<AuditResult> {
  const url = sourceUrl(source);
  if (!url) {
    return {
      sourceId: source.id,
      configured: false,
      rawExceptionsInWindow: 0,
      parsedEventsWithRecurrenceIds: 0,
      missingExceptions: [],
    };
  }

  const ics = await fetchIcsText(url);
  const rawExceptions = rawRecurrenceExceptionsInWindow(source, ics, window);
  const parsed = parseIcsFeed(source, ics, window);
  const parsedExceptionKeys = new Set(parsed.events
    .filter((event) => event.uid && event.recurrenceId)
    .map((event) => exceptionKey(event.uid, event.recurrenceId)));
  const missingExceptions = rawExceptions.filter((event) => !parsedExceptionKeys.has(exceptionKey(event.uid, event.recurrenceId)));

  return {
    sourceId: source.id,
    configured: true,
    rawExceptionsInWindow: rawExceptions.length,
    parsedEventsWithRecurrenceIds: parsedExceptionKeys.size,
    missingExceptions,
  };
}

function rawRecurrenceExceptionsInWindow(
  source: CalendarSourceConfig,
  ics: string,
  window: ReturnType<typeof getSyncWindow>,
): AuditIssue[] {
  const parsed = ICAL.parse(ics);
  const calendar = new ICAL.Component(parsed);
  return calendar.getAllSubcomponents("vevent")
    .map((component) => new ICAL.Event(component))
    .filter((event) => event.isRecurrenceException())
    .map((event) => rawExceptionIssue(source, event))
    .filter((event): event is AuditIssue => Boolean(event))
    .filter((event) => Date.parse(event.end) >= window.start.getTime() && Date.parse(event.start) <= window.end.getTime());
}

function rawExceptionIssue(source: CalendarSourceConfig, event: ICAL.Event): AuditIssue | null {
  const recurrenceId = recurrenceIdString(event);
  if (!recurrenceId) return null;
  const uid = event.uid || stringValue(event.component.getFirstPropertyValue("uid"));
  const summary = normalizeText(stringValue(event.component.getFirstPropertyValue("summary")) || event.summary) || "Untitled event";
  const start = timeToStorage(event.startDate);
  const end = timeToStorage(event.endDate);
  if (source.id === "us-holidays" && !event.startDate.isDate) return null;
  return { sourceId: source.id, uid, recurrenceId, summary, start, end };
}

async function fetchIcsText(url: string): Promise<string> {
  const response = await fetch(url, { redirect: "follow", cache: "no-store" });
  if (!response.ok) throw new Error(`ICS fetch failed with status ${response.status}.`);
  const text = await response.text();
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("ICS feed did not return a calendar payload.");
  return text;
}

function recurrenceIdString(event: ICAL.Event): string | null {
  const value = event.component.getFirstPropertyValue("recurrence-id");
  if (!value) return null;
  if (typeof value === "object" && "toICALString" in value && typeof value.toICALString === "function") {
    return value.toICALString();
  }
  return stringValue(value);
}

function exceptionKey(uid: string | null, recurrenceId: string | null): string {
  return `${(uid || "").toLowerCase()}:${recurrenceId || ""}`;
}

function timeToStorage(time: ICAL.Time): string {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  return time.toJSDate().toISOString();
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return normalized || null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function parseFlags(args: string[]): Record<string, string | boolean> {
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
    const next = args[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else flags[key] = args[++i];
  }
  return flags;
}

function stringFlag(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
