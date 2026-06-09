import * as crypto from "crypto";
import * as path from "path";

export interface CalendarSourceConfig {
  id: "personal" | "priceless" | "evercommerce" | "us-holidays";
  label: string;
  providerHint: "google" | "outlook" | "ics";
  accountHint: string;
  envKey: string;
  color: string;
  priority: number;
  defaultUrl?: string;
}

export const CALENDAR_SOURCE_CONFIGS: CalendarSourceConfig[] = [
  {
    id: "evercommerce",
    label: "EverCommerce",
    providerHint: "outlook",
    accountHint: "jruckman@evercommerce.com",
    envKey: "HILT_CALENDAR_ICS_EVERCOMMERCE_URL",
    color: "#2563eb",
    priority: 0,
  },
  {
    id: "priceless",
    label: "Priceless",
    providerHint: "google",
    accountHint: "justin@pricelessmisc.com",
    envKey: "HILT_CALENDAR_ICS_PRICELESS_URL",
    color: "#059669",
    priority: 1,
  },
  {
    id: "personal",
    label: "Personal",
    providerHint: "google",
    accountHint: "justinruckman@gmail.com",
    envKey: "HILT_CALENDAR_ICS_PERSONAL_URL",
    color: "#dc2626",
    priority: 2,
  },
  {
    id: "us-holidays",
    label: "US Holidays",
    providerHint: "ics",
    accountHint: "Public US holidays",
    envKey: "HILT_CALENDAR_ICS_US_HOLIDAYS_URL",
    color: "#7c3aed",
    priority: 3,
    defaultUrl: "https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics",
  },
];

export function getCalendarDataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function getCalendarDbPath(): string {
  return process.env.HILT_CALENDAR_DB_PATH || path.join(getCalendarDataDir(), "calendar.sqlite");
}

export function getCalendarMarkerPath(): string {
  return path.join(getCalendarDataDir(), "calendar-sync-event.json");
}

export function getCalendarSyncLockPath(): string {
  return path.join(getCalendarDataDir(), "calendar-sync.lock");
}

export function getSyncPastDays(): number {
  return boundedInt(process.env.HILT_CALENDAR_SYNC_PAST_DAYS, 730, 1, 3650);
}

export function getSyncFutureDays(): number {
  return boundedInt(process.env.HILT_CALENDAR_SYNC_FUTURE_DAYS, 365, 1, 3650);
}

export function getSyncWindow(now = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  const start = new Date(now);
  start.setDate(start.getDate() - getSyncPastDays());
  start.setHours(0, 0, 0, 0);
  const end = new Date(now);
  end.setDate(end.getDate() + getSyncFutureDays());
  end.setHours(23, 59, 59, 999);
  return { start, end, startIso: start.toISOString(), endIso: end.toISOString() };
}

export function hashValue(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 16);
}

export function sourceUrl(config: CalendarSourceConfig): string | null {
  if (process.env.HILT_CALENDAR_FIXTURE_MODE === "1") return `fixture://${config.id}`;
  const url = process.env[config.envKey]?.trim();
  return url || config.defaultUrl || null;
}

function boundedInt(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
