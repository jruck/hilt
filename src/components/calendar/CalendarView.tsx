"use client";

import "temporal-polyfill/global";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Clock,
  LayoutGrid,
  LayoutList,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Sun,
} from "lucide-react";
import { ScheduleXCalendar, useNextCalendarApp } from "@schedule-x/react";
import {
  createViewDay,
  createViewMonthAgenda,
  createViewMonthGrid,
  createViewWeek,
  type BackgroundEvent,
  type CalendarEventExternal,
  type CalendarType,
} from "@schedule-x/calendar";
import { createEventsServicePlugin } from "@schedule-x/events-service";
import { createCalendarControlsPlugin } from "@schedule-x/calendar-controls";
import { createCurrentTimePlugin } from "@schedule-x/current-time";
import { createScrollControllerPlugin } from "@schedule-x/scroll-controller";
import { createEventModalPlugin } from "@schedule-x/event-modal";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import { useScope } from "@/contexts/ScopeContext";
import { CalendarEventPopoverContent } from "./CalendarEventPopover";
import {
  mutateCalendarCaches,
  setCalendarSelected,
  syncCalendarSources,
  useCalendarEvents,
  useCalendarSources,
} from "@/hooks/useCalendar";
import { useWeatherForecast } from "@/hooks/useWeather";
import {
  CALENDAR_EVENT_OPEN_EVENT,
  PENDING_CALENDAR_EVENT_STORAGE_KEY,
  type CalendarEventOpenDetail,
} from "@/lib/calendar/deeplink";
import { calendarSourcesNeedSync } from "@/lib/calendar/freshness";
import { LoadingState } from "@/components/ui/LoadingState";
import { displayCalendarEventTitle } from "@/lib/calendar/title";
import type { CalendarDefinition, CalendarEvent, CalendarSource } from "@/lib/calendar/types";
import { isVisibleCalendarForegroundEvent } from "@/lib/calendar/visibility";
import type { WeatherForecastDay, WeatherIconKey } from "@/lib/weather/types";

type CalendarMode = "day" | "week" | "month" | "agenda";
type CalendarPeriodPosition = "before" | "today" | "after";
type MiniMonthDay = {
  date: string;
  day: number;
  inMonth: boolean;
};
type MiniMonthModel = {
  key: string;
  label: string;
  offset: number;
  days: MiniMonthDay[];
};
type MiniMonthActiveRange = {
  mode: CalendarMode;
  monthKey: string;
  start: string;
  end: string;
};
type HiltScheduleEvent = CalendarEventExternal & {
  hiltEvent?: CalendarEvent;
  joinLabel?: string | null;
  sourceText?: string;
  calendarColor?: string;
  calendarLabel?: string;
  sourceLabel?: string;
  availabilityWarning?: boolean;
};

type HiltEventModalProps = {
  calendarEvent?: HiltScheduleEvent;
};

type HiltWeekGridDateProps = {
  date?: string;
};

type EventPopoverPosition = {
  eventId: string;
  top: number;
  left: number;
};

const MODE_TO_VIEW: Record<CalendarMode, string> = {
  day: "day",
  week: "week",
  month: "month-grid",
  agenda: "month-agenda",
};

const MODE_STEPS: Record<CalendarMode, Temporal.DurationLike> = {
  day: { days: 1 },
  week: { weeks: 1 },
  month: { months: 1 },
  agenda: { months: 1 },
};

const JOIN_LABELS: Record<CalendarEvent["joinLinks"][number]["kind"], string> = {
  teams: "Teams",
  meet: "Meet",
  zoom: "Zoom",
  web: "Link",
};

// Deep link from a meeting note back to its calendar event: /event/<encoded id>/<YYYY-MM-DD>.
function parseCalendarEventDeepLink(scopePath: string): { id: string; date: string } | null {
  const match = scopePath.match(/^\/event\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), date: match[2] };
}

const TIME_ZONE = "America/New_York";
const DAY_BOUNDARIES = { start: "00:00", end: "24:00" };
const INITIAL_TIME_GRID_HOUR = 9;
const INITIAL_VISIBLE_TIME_GRID_HOURS = 10;
const TIME_GRID_FRAME_CHROME_PX = 122;
const TIME_GRID_HOUR_LABEL_OFFSET_PX = 9;
const TIME_GRID_INITIAL_LABEL_PADDING_PX = 4;
const TIME_GRID_INITIAL_SCROLL_SETTLE_MS = 3500;
const TIME_GRID_EVENT_FIT_PADDING_MINUTES = 8;
const TIME_GRID_MIN_VISIBLE_FIT_MINUTES = 6 * 60;
const TIME_GRID_MIN_HEIGHT = 960;
const TIME_GRID_MAX_HEIGHT = 3600;
const MOBILE_CALENDAR_MEDIA_QUERY = "(max-width: 640px)";
const MINI_MONTHS_VISIBLE_STORAGE_KEY = "hilt-calendar-mini-months-visible";
const MINI_MONTH_PAST_MONTHS = 12;
const MINI_MONTH_FUTURE_MONTHS = 12;
const MINI_MONTH_OFFSETS = Array.from(
  { length: MINI_MONTH_PAST_MONTHS + MINI_MONTH_FUTURE_MONTHS + 1 },
  (_, index) => index - MINI_MONTH_PAST_MONTHS,
);
const MINI_MONTH_WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MINI_MONTH_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "long", year: "numeric" });
const MINI_MONTH_DAY_LABEL_FORMATTER = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric", year: "numeric" });
const EVERCOMMERCE_WORKDAY_START_HOUR = 9;
const EVERCOMMERCE_WORKDAY_END_HOUR = 17;
const EMPTY_SOURCES: CalendarSource[] = [];
const EMPTY_CALENDARS: CalendarDefinition[] = [];
const EMPTY_EVENTS: CalendarEvent[] = [];
const EMPTY_WEATHER_DAYS: WeatherForecastDay[] = [];
const DEFAULT_WEEK_GRID_HEIGHT = 1440;
const HOURS_PER_DAY = 24;
const MINUTES_PER_DAY = HOURS_PER_DAY * 60;

interface TimeGridFit {
  kind: "fallback" | "fit";
  gridHeight: number;
  scrollMinute: number;
  signature: string;
}

function todayPlainDate(): string {
  return Temporal.Now.plainDateISO(TIME_ZONE).toString();
}

function defaultCalendarMode(): CalendarMode {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY).matches ? "day" : "week";
}

function isCalendarMobileViewport(): boolean {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY).matches;
}

function defaultMiniMonthsVisible(): boolean {
  if (typeof window === "undefined" || isCalendarMobileViewport()) return false;
  try {
    return window.localStorage.getItem(MINI_MONTHS_VISIBLE_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function useCalendarMobileViewport(): boolean {
  const [isMobile, setIsMobile] = useState(isCalendarMobileViewport);

  useEffect(() => {
    const media = window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY);
    setIsMobile(media.matches);
    const onChange = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

function shouldIgnoreCalendarPeriodGesture(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest([
    "a",
    "button",
    "input",
    "select",
    "textarea",
    "[role='button']",
    ".sx__event",
    ".sx__event-modal",
  ].join(",")));
}

function dateFromPlainDate(date: string, time = "12:00"): Date {
  const plain = Temporal.PlainDate.from(date);
  const zoned = plain.toPlainDateTime(Temporal.PlainTime.from(time)).toZonedDateTime(TIME_ZONE);
  return new Date(zoned.epochMilliseconds);
}

function formatMiniMonthLabel(monthDate: string): string {
  return MINI_MONTH_LABEL_FORMATTER.format(dateFromPlainDate(monthDate));
}

function formatMiniMonthDayLabel(date: string): string {
  return MINI_MONTH_DAY_LABEL_FORMATTER.format(dateFromPlainDate(date));
}

function buildMiniMonth(anchorDate: string, monthOffset: number): MiniMonthModel {
  const month = Temporal.PlainDate.from(anchorDate).with({ day: 1 }).add({ months: monthOffset });
  const firstCell = month.subtract({ days: month.dayOfWeek % 7 });
  const days = Array.from({ length: 42 }, (_, index) => {
    const day = firstCell.add({ days: index });
    return {
      date: day.toString(),
      day: day.day,
      inMonth: day.year === month.year && day.month === month.month,
    };
  });
  return { key: month.toString(), label: formatMiniMonthLabel(month.toString()), offset: monthOffset, days };
}

function isMiniMonthBeforeCurrentMonth(monthDate: string, today: string): boolean {
  const month = Temporal.PlainDate.from(monthDate).with({ day: 1 });
  const currentMonth = Temporal.PlainDate.from(today).with({ day: 1 });
  return Temporal.PlainDate.compare(month, currentMonth) < 0;
}

function miniMonthActiveRange(mode: CalendarMode, selectedDate: string): MiniMonthActiveRange {
  const range = plainDateRangeAround(mode, selectedDate);
  const selectedMonth = Temporal.PlainDate.from(selectedDate).with({ day: 1 }).toString();
  return { ...range, mode, monthKey: selectedMonth };
}

function miniMonthDateIsActive(day: MiniMonthDay, month: MiniMonthModel, activeRange: MiniMonthActiveRange): boolean {
  if (month.key !== activeRange.monthKey) return false;
  if (day.date < activeRange.start || day.date > activeRange.end) return false;
  if (activeRange.mode === "month" || activeRange.mode === "agenda") return day.inMonth;
  return true;
}

function parseCssPixelValue(value: string, fallback: number): number {
  const trimmed = value.trim();
  if (!trimmed) return fallback;
  const numeric = Number.parseFloat(trimmed);
  if (!Number.isFinite(numeric)) return fallback;
  if (trimmed.endsWith("rem")) {
    const rootFontSize = Number.parseFloat(window.getComputedStyle(document.documentElement).fontSize);
    return numeric * (Number.isFinite(rootFontSize) ? rootFontSize : 16);
  }
  return numeric;
}

function rangeAround(mode: CalendarMode, date: string): { start: Date; end: Date } {
  let start = Temporal.PlainDate.from(date);
  let end = start;
  if (mode === "day") {
    end = start;
  } else if (mode === "week") {
    start = start.subtract({ days: start.dayOfWeek % 7 });
    end = start.add({ days: 6 });
  } else {
    start = start.with({ day: 1 });
    end = start.add({ months: 1 });
  }
  return {
    start: dateFromPlainDate(start.toString(), "00:00"),
    end: dateFromPlainDate(end.toString(), "23:59:59.999"),
  };
}

function plainDateRangeAround(mode: CalendarMode, date: string): { start: string; end: string } {
  let start = Temporal.PlainDate.from(date);
  let end = start;
  if (mode === "week") {
    start = start.subtract({ days: start.dayOfWeek % 7 });
    end = start.add({ days: 6 });
  } else if (mode === "month" || mode === "agenda") {
    start = start.with({ day: 1 });
    end = start.add({ months: 1 }).subtract({ days: 1 });
  }
  return { start: start.toString(), end: end.toString() };
}

function periodPositionForDate(mode: CalendarMode, date: string, today = todayPlainDate()): CalendarPeriodPosition {
  const range = plainDateRangeAround(mode, date);
  const todayDate = Temporal.PlainDate.from(today);
  if (Temporal.PlainDate.compare(todayDate, Temporal.PlainDate.from(range.start)) < 0) return "after";
  if (Temporal.PlainDate.compare(todayDate, Temporal.PlainDate.from(range.end)) > 0) return "before";
  return "today";
}

function scheduleDateFromEventStart(event: CalendarEvent): Temporal.ZonedDateTime | Temporal.PlainDate {
  if (event.allDay) return Temporal.PlainDate.from(event.start.slice(0, 10));
  return Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE);
}

function scheduleDateFromEventEnd(event: CalendarEvent): Temporal.ZonedDateTime | Temporal.PlainDate {
  if (!event.allDay) return Temporal.Instant.from(event.end).toZonedDateTimeISO(TIME_ZONE);
  const start = Temporal.PlainDate.from(event.start.slice(0, 10));
  const rawEnd = Temporal.PlainDate.from(event.end.slice(0, 10));
  const inclusiveEnd = rawEnd.subtract({ days: 1 });
  return Temporal.PlainDate.compare(inclusiveEnd, start) < 0 ? start : inclusiveEnd;
}

function calendarEventToScheduleEvent(event: CalendarEvent, options: {
  focused?: boolean;
  availabilityWarning?: boolean;
  calendar?: CalendarDefinition | null;
  source?: CalendarSource | null;
} = {}): HiltScheduleEvent {
  const join = event.joinLinks[0];
  const sourceText = event.duplicateSourceCount > 1 ? `${event.duplicateSourceCount} calendars` : "";
  const additionalClasses = [
    options.focused ? "hilt-calendar-event-focused" : null,
    options.availabilityWarning ? "hilt-calendar-event-unblocked" : null,
  ].filter(Boolean) as string[];
  return {
    id: event.id,
    title: displayCalendarEventTitle(event.title),
    start: scheduleDateFromEventStart(event),
    end: scheduleDateFromEventEnd(event),
    calendarId: event.calendarId,
    people: event.attendees.map((attendee) => attendee.name || attendee.email || "").filter(Boolean),
    location: event.location || undefined,
    description: event.description || undefined,
    _options: { disableDND: true, disableResize: true, additionalClasses },
    joinLabel: join ? JOIN_LABELS[join.kind] : null,
    sourceText,
    calendarColor: options.calendar?.color,
    calendarLabel: options.calendar?.name,
    sourceLabel: options.source?.label,
    availabilityWarning: options.availabilityWarning,
    hiltEvent: event,
  };
}

function calendarEventToBackgroundEvent(event: CalendarEvent): BackgroundEvent {
  return {
    start: scheduleDateFromEventStart(event),
    end: scheduleDateFromEventEnd(event),
    title: "EverCommerce blocked time",
    style: {
      background: "repeating-linear-gradient(135deg, var(--hilt-calendar-blocker-stripe) 0 4px, transparent 4px 9px)",
      borderInlineStart: "1px solid var(--hilt-calendar-blocker-edge)",
      pointerEvents: "none",
    },
  };
}

function isCoveredByEverCommerce(event: CalendarEvent, coverageEvents: CalendarEvent[]): boolean {
  if (event.sourceId === "evercommerce" || event.sourceIds.includes("evercommerce") || event.allDay) return true;
  return coverageEvents.some((coverage) => (
    coverage.sortStart <= event.sortStart && coverage.sortEnd >= event.sortEnd
  ));
}

function holidayDateKeys(events: CalendarEvent[]): Set<string> {
  const dates = new Set<string>();
  for (const event of events) {
    const start = Temporal.PlainDate.from(event.start.slice(0, 10));
    const rawEnd = Temporal.PlainDate.from(event.end.slice(0, 10));
    const inclusiveEnd = event.allDay ? rawEnd.subtract({ days: 1 }) : rawEnd;
    let day = start;
    while (Temporal.PlainDate.compare(day, inclusiveEnd) <= 0) {
      dates.add(day.toString());
      day = day.add({ days: 1 });
    }
  }
  return dates;
}

function isPublicHolidayEvent(event: CalendarEvent): boolean {
  return event.sourceId === "us-holidays" && /\bpublic holiday\b/i.test(event.description || "");
}

function businessClosureDateKeys(events: CalendarEvent[]): Set<string> {
  return holidayDateKeys(events.filter(isPublicHolidayEvent));
}

function isEverCommerceBusinessDay(day: Temporal.PlainDate, holidays: Set<string>): boolean {
  return day.dayOfWeek <= 5 && !holidays.has(day.toString());
}

function occursOnEverCommerceBusinessDay(event: CalendarEvent, holidays: Set<string>): boolean {
  const start = event.allDay
    ? Temporal.PlainDate.from(event.start.slice(0, 10))
    : Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE).toPlainDate();
  const rawEnd = event.allDay
    ? Temporal.PlainDate.from(event.end.slice(0, 10)).subtract({ days: 1 })
    : Temporal.Instant.from(event.end).toZonedDateTimeISO(TIME_ZONE).toPlainDate();
  let day = start;
  while (Temporal.PlainDate.compare(day, rawEnd) <= 0) {
    if (isEverCommerceBusinessDay(day, holidays)) return true;
    day = day.add({ days: 1 });
  }
  return false;
}

function overlapsEverCommerceWorkday(event: CalendarEvent, holidays: Set<string>): boolean {
  if (event.allDay) return false;
  const start = Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE);
  const end = Temporal.Instant.from(event.end).toZonedDateTimeISO(TIME_ZONE);
  let day = start.toPlainDate();
  const finalDay = end.toPlainDate();

  while (Temporal.PlainDate.compare(day, finalDay) <= 0) {
    if (!isEverCommerceBusinessDay(day, holidays)) {
      day = day.add({ days: 1 });
      continue;
    }
    const workdayStart = day
      .toPlainDateTime(Temporal.PlainTime.from({ hour: EVERCOMMERCE_WORKDAY_START_HOUR }))
      .toZonedDateTime(TIME_ZONE);
    const workdayEnd = day
      .toPlainDateTime(Temporal.PlainTime.from({ hour: EVERCOMMERCE_WORKDAY_END_HOUR }))
      .toZonedDateTime(TIME_ZONE);
    if (start.epochMilliseconds < workdayEnd.epochMilliseconds && end.epochMilliseconds > workdayStart.epochMilliseconds) {
      return true;
    }
    day = day.add({ days: 1 });
  }

  return false;
}

function calendarsForScheduleX(calendars: CalendarDefinition[]): Record<string, CalendarType> {
  return Object.fromEntries(calendars.map((calendar) => [
    calendar.id,
    {
      colorName: colorNameForCalendar(calendar.id),
      label: calendar.name,
      readonly: true,
      lightColors: {
        main: calendar.color,
        container: alphaHex(calendar.color, "24"),
        onContainer: "#1f2937",
      },
      darkColors: {
        main: calendar.color,
        container: alphaHex(calendar.color, "55"),
        onContainer: "#f8fafc",
      },
    },
  ]));
}

function colorNameForCalendar(id: string): string {
  return id.replace(/[^a-z0-9_-]/gi, "-");
}

function alphaHex(color: string, alpha: string): string {
  return /^#[0-9a-f]{6}$/i.test(color) ? `${color}${alpha}` : color;
}

function rangeFromScheduleX(range: { start: Temporal.ZonedDateTime; end: Temporal.ZonedDateTime }) {
  return {
    start: new Date(range.start.epochMilliseconds),
    end: new Date(range.end.epochMilliseconds),
  };
}

function popoverPositionForEvent(anchorRect: DOMRect, frameRect?: DOMRect | null): Omit<EventPopoverPosition, "eventId"> {
  const margin = 12;
  const gap = 10;
  const width = Math.min(400, window.innerWidth - margin * 2);
  const estimatedHeight = 320;
  let left = anchorRect.right + gap;
  if (left + width > window.innerWidth - margin) left = anchorRect.left - width - gap;
  if (left < margin) {
    left = frameRect ? Math.max(margin, Math.min(frameRect.left, window.innerWidth - width - margin)) : margin;
  }
  const top = Math.min(
    Math.max(anchorRect.top, margin),
    Math.max(margin, window.innerHeight - estimatedHeight - margin),
  );
  return { top: Math.round(top), left: Math.round(left) };
}

function fallbackPopoverPosition(frameRect?: DOMRect | null): Omit<EventPopoverPosition, "eventId"> {
  const margin = 12;
  const width = Math.min(400, window.innerWidth - margin * 2);
  const estimatedHeight = 320;
  const left = Math.min(
    Math.max((frameRect?.right ?? window.innerWidth) - width - margin, margin),
    Math.max(margin, window.innerWidth - width - margin),
  );
  const top = Math.min(
    Math.max((frameRect?.top ?? 72) + 24, margin),
    Math.max(margin, window.innerHeight - estimatedHeight - margin),
  );
  return { top: Math.round(top), left: Math.round(left) };
}

function shiftPlainDate(date: string, mode: CalendarMode, direction: -1 | 1): string {
  const duration = MODE_STEPS[mode];
  const plain = Temporal.PlainDate.from(date);
  return direction === 1 ? plain.add(duration).toString() : plain.subtract(duration).toString();
}

function formatCalendarTitle(mode: CalendarMode, selectedDate: string): string {
  const date = dateFromPlainDate(selectedDate);
  if (mode === "day") {
    return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "long", month: "long", day: "numeric" }).format(date);
  }
  if (mode === "week") {
    const range = rangeAround(mode, selectedDate);
    const formatter = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "short", day: "numeric" });
    return `${formatter.format(range.start)} - ${formatter.format(range.end)}`;
  }
  return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "long", year: "numeric" }).format(date);
}

function formatHourLabel(hour: number): string {
  const normalizedHour = ((hour % 24) + 24) % 24;
  const displayHour = normalizedHour % 12 || 12;
  return `${displayHour} ${normalizedHour < 12 ? "AM" : "PM"}`;
}

function WeekGridHourLabel({ hour, gridStep }: { hour?: number; gridStep?: { hour?: number; minute?: number } }) {
  const stepHour = gridStep?.hour ?? hour;
  const minute = gridStep?.minute ?? 0;
  if (typeof stepHour !== "number" || minute !== 0) return null;
  return (
    <span className="sx__week-grid__hour-text hilt-week-grid-hour-label" data-testid="calendar-time-axis-hour">
      {formatHourLabel(stepHour)}
    </span>
  );
}

function WeekGridDateHeader({
  date,
  forecast,
  locationLabel,
}: {
  date?: string;
  forecast?: WeatherForecastDay | null;
  locationLabel?: string | null;
}) {
  if (!date) return null;
  const plainDate = Temporal.PlainDate.from(date);
  const fullDate = new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dateFromPlainDate(date));
  const weekday = new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    weekday: "short",
  }).format(dateFromPlainDate(date)).toUpperCase();

  return (
    <div className="hilt-week-grid-date-header">
      <div className="sx__week-grid__day-name">{weekday}</div>
      {forecast ? (
        <WeatherForecastLink forecast={forecast} fullDate={fullDate} locationLabel={locationLabel} />
      ) : null}
      <div className="sx__week-grid__date-number">{plainDate.day}</div>
    </div>
  );
}

function WeatherForecastLink({
  forecast,
  fullDate,
  locationLabel,
}: {
  forecast: WeatherForecastDay;
  fullDate: string;
  locationLabel?: string | null;
}) {
  const high = Math.round(forecast.highF);
  const low = Math.round(forecast.lowF);
  const precipitation = typeof forecast.precipitationProbability === "number"
    ? `, ${forecast.precipitationProbability}% precipitation`
    : "";
  const locationText = locationLabel ? ` in ${locationLabel}` : "";
  const label = `${fullDate}${locationText}: ${forecast.condition}, high ${high}\u00b0, low ${low}\u00b0${precipitation}`;

  return (
    <a
      href={forecast.detailsUrl}
      target="_blank"
      rel="noreferrer"
      className="hilt-weather-chip"
      title={label}
      aria-label={label}
      data-testid={`calendar-weather-${forecast.date}`}
      data-weather-icon={forecast.icon}
    >
      <span className="hilt-weather-temp">{high}&deg;/{low}&deg;</span>
      <WeatherConditionIcon icon={forecast.icon} />
      <span className="hilt-weather-condition">{forecast.shortCondition}</span>
    </a>
  );
}

function WeatherConditionIcon({ icon }: { icon: WeatherIconKey }) {
  const className = "hilt-weather-icon";
  if (icon === "sun") return <Sun className={className} aria-hidden="true" />;
  if (icon === "cloud-sun") return <CloudSun className={className} aria-hidden="true" />;
  if (icon === "fog") return <CloudFog className={className} aria-hidden="true" />;
  if (icon === "drizzle") return <CloudDrizzle className={className} aria-hidden="true" />;
  if (icon === "rain") return <CloudRain className={className} aria-hidden="true" />;
  if (icon === "snow") return <CloudSnow className={className} aria-hidden="true" />;
  if (icon === "storm") return <CloudLightning className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

function useResolvedDarkTheme(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function useVisibleTimeGridHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(DEFAULT_WEEK_GRID_HEIGHT / (HOURS_PER_DAY / INITIAL_VISIBLE_TIME_GRID_HOURS));

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setHeight(Math.max(560, Math.round(rect.height - TIME_GRID_FRAME_CHROME_PX)));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [ref]);

  return height;
}

function useTimeGridFit(
  visibleGridHeight: number,
  mode: CalendarMode,
  events: CalendarEvent[],
  visibleRange: { start: Date; end: Date },
): TimeGridFit {
  return useMemo(() => {
    const defaultGridHeight = Math.max(
      DEFAULT_WEEK_GRID_HEIGHT,
      visibleGridHeight * (HOURS_PER_DAY / INITIAL_VISIBLE_TIME_GRID_HOURS),
    );
    if (mode !== "day" && mode !== "week") {
      return {
        kind: "fallback",
        gridHeight: defaultGridHeight,
        scrollMinute: INITIAL_TIME_GRID_HOUR * 60,
        signature: `fallback:${mode}:${Math.round(defaultGridHeight)}`,
      };
    }

    const fit = timedEventBounds(events, visibleRange);
    if (!fit) {
      return {
        kind: "fallback",
        gridHeight: defaultGridHeight,
        scrollMinute: INITIAL_TIME_GRID_HOUR * 60,
        signature: `fallback:${mode}:${Math.round(defaultGridHeight)}`,
      };
    }

    const paddedStart = Math.max(0, fit.startMinute - TIME_GRID_EVENT_FIT_PADDING_MINUTES);
    const paddedEnd = Math.min(MINUTES_PER_DAY, fit.endMinute + TIME_GRID_EVENT_FIT_PADDING_MINUTES);
    const spanMinutes = Math.max(TIME_GRID_MIN_VISIBLE_FIT_MINUTES, paddedEnd - paddedStart);
    const scrollMinute = Math.max(0, Math.min(paddedStart, MINUTES_PER_DAY - spanMinutes));
    const gridHeight = clamp(
      visibleGridHeight * (MINUTES_PER_DAY / spanMinutes),
      TIME_GRID_MIN_HEIGHT,
      TIME_GRID_MAX_HEIGHT,
    );

    return {
      kind: "fit",
      gridHeight: Math.round(gridHeight),
      scrollMinute: Math.round(scrollMinute),
      signature: `fit:${mode}:${fit.signature}:${Math.round(gridHeight)}:${Math.round(scrollMinute)}`,
    };
  }, [events, mode, visibleGridHeight, visibleRange]);
}

function timedEventBounds(events: CalendarEvent[], visibleRange: { start: Date; end: Date }): {
  startMinute: number;
  endMinute: number;
  signature: string;
} | null {
  const rangeStart = visibleRange.start.getTime();
  const rangeEnd = visibleRange.end.getTime();
  let startMinute = MINUTES_PER_DAY;
  let endMinute = 0;
  const signatureParts: string[] = [];

  for (const event of events) {
    if (event.allDay || event.sortEnd < rangeStart || event.sortStart > rangeEnd) continue;
    const start = Temporal.Instant.from(event.start).toZonedDateTimeISO(TIME_ZONE);
    const end = Temporal.Instant.from(event.end).toZonedDateTimeISO(TIME_ZONE);
    const multiDay = Temporal.PlainDate.compare(start.toPlainDate(), end.toPlainDate()) !== 0;
    const eventStart = multiDay ? 0 : zonedMinuteOfDay(start);
    const eventEnd = multiDay ? MINUTES_PER_DAY : zonedMinuteOfDay(end, true);
    if (eventEnd <= eventStart) continue;
    startMinute = Math.min(startMinute, eventStart);
    endMinute = Math.max(endMinute, eventEnd);
    signatureParts.push(`${event.id}:${event.start}:${event.end}`);
  }

  if (!signatureParts.length) return null;
  return {
    startMinute,
    endMinute,
    signature: signatureParts.sort().join("|"),
  };
}

function zonedMinuteOfDay(time: Temporal.ZonedDateTime, end = false): number {
  if (end && time.hour === 0 && time.minute === 0 && time.second === 0 && time.millisecond === 0) {
    return MINUTES_PER_DAY;
  }
  const rawMinute = time.hour * 60 + time.minute + (time.second * 1000 + time.millisecond) / 60_000;
  return Math.min(
    MINUTES_PER_DAY,
    Math.max(0, end ? Math.ceil(rawMinute) : Math.floor(rawMinute)),
  );
}

function scrollToTimeGridSlice(frame: HTMLElement | null, fit: TimeGridFit): boolean {
  const viewContainer = frame?.querySelector(".sx__view-container");
  const weekGrid = frame?.querySelector(".sx__week-grid");
  const weekHeader = frame?.querySelector(".sx__week-header");
  if (!(viewContainer instanceof HTMLElement) || !(weekGrid instanceof HTMLElement) || !(weekHeader instanceof HTMLElement)) {
    return false;
  }

  const viewRect = viewContainer.getBoundingClientRect();
  const weekGridRect = weekGrid.getBoundingClientRect();
  const weekGridContentTop = weekGridRect.top - viewRect.top + viewContainer.scrollTop;
  const stickyHeaderHeight = weekHeader.getBoundingClientRect().height;
  const labelOffset = fit.kind === "fallback" ? TIME_GRID_HOUR_LABEL_OFFSET_PX + TIME_GRID_INITIAL_LABEL_PADDING_PX : 0;
  const pixelsPerMinute = (weekGridRect.height || fit.gridHeight) / MINUTES_PER_DAY;
  const targetTop = weekGridContentTop
    + fit.scrollMinute * pixelsPerMinute
    - labelOffset
    - stickyHeaderHeight;

  viewContainer.scrollTo({ top: Math.max(0, targetTop), behavior: "auto" });
  return true;
}

function watchTimeGridScroll(
  frame: HTMLElement | null,
  fit: TimeGridFit,
  fallbackScroll: () => void,
): () => void {
  if (!frame) return () => undefined;

  let disposed = false;
  let frameId = 0;
  let didScroll = false;
  let resizeObserver: ResizeObserver | null = null;
  let mutationObserver: MutationObserver | null = null;
  let userInteracted = false;

  const cleanup = () => {
    disposed = true;
    if (frameId) window.cancelAnimationFrame(frameId);
    resizeObserver?.disconnect();
    mutationObserver?.disconnect();
    frame.removeEventListener("wheel", markUserInteracted, true);
    frame.removeEventListener("touchstart", markUserInteracted, true);
    frame.removeEventListener("pointerdown", markUserInteracted, true);
    frame.removeEventListener("keydown", markUserInteracted, true);
    window.clearTimeout(timeoutId);
  };

  const attachResizeObserver = () => {
    if (resizeObserver || typeof ResizeObserver === "undefined") return;
    const elements = [
      frame.querySelector(".sx__view-container"),
      frame.querySelector(".sx__week-grid"),
      frame.querySelector(".sx__week-header"),
    ].filter((element): element is HTMLElement => element instanceof HTMLElement);
    if (!elements.length) return;
    resizeObserver = new ResizeObserver(queueScroll);
    elements.forEach((element) => resizeObserver?.observe(element));
  };

  function queueScroll() {
    if (disposed || userInteracted || frameId) return;
    frameId = window.requestAnimationFrame(() => {
      frameId = 0;
      if (disposed || userInteracted) return;
      didScroll = scrollToTimeGridSlice(frame, fit) || didScroll;
      attachResizeObserver();
    });
  }

  function markUserInteracted() {
    userInteracted = true;
  }

  const timeoutId = window.setTimeout(() => {
    if (!didScroll && !userInteracted) fallbackScroll();
    cleanup();
  }, TIME_GRID_INITIAL_SCROLL_SETTLE_MS);

  if (typeof MutationObserver !== "undefined") {
    mutationObserver = new MutationObserver(queueScroll);
    mutationObserver.observe(frame, { childList: true, subtree: true });
  }
  frame.addEventListener("wheel", markUserInteracted, { capture: true, passive: true });
  frame.addEventListener("touchstart", markUserInteracted, { capture: true, passive: true });
  frame.addEventListener("pointerdown", markUserInteracted, { capture: true });
  frame.addEventListener("keydown", markUserInteracted, { capture: true });

  queueScroll();
  return cleanup;
}

function clearCurrentCalendarDayMarker(cell: HTMLElement) {
  delete cell.dataset.hiltCurrentCalendarDay;
  delete cell.dataset.hiltSelectedDateGridDay;
  delete cell.dataset.hiltClearSelectedDay;
  cell.style.removeProperty("background");
}

function markCurrentCalendarDayCell(cell: HTMLElement) {
  cell.dataset.hiltCurrentCalendarDay = "true";
  cell.style.background = "var(--hilt-calendar-active-day-bg)";
}

function syncCurrentCalendarDay(frame: HTMLElement | null, today: string): () => void {
  if (!frame) return () => undefined;

  let frameId = 0;
  const apply = () => {
    frameId = 0;
    frame.querySelectorAll<HTMLElement>([
      ".sx__date-grid-day[data-hilt-current-calendar-day]",
      ".sx__date-grid-day[data-hilt-selected-date-grid-day]",
      ".sx__time-grid-day[data-hilt-current-calendar-day]",
      ".sx__time-grid-day[data-hilt-clear-selected-day]",
    ].join(", ")).forEach(clearCurrentCalendarDayMarker);

    frame.querySelectorAll<HTMLElement>(".sx__time-grid-day.is-selected").forEach((cell) => {
      if (cell.dataset.timeGridDate === today) return;
      cell.dataset.hiltClearSelectedDay = "true";
      cell.style.background = "transparent";
    });

    const dateGridToday = frame.querySelector<HTMLElement>(`.sx__date-grid-day[data-date-grid-date="${today}"]`);
    const timeGridToday = frame.querySelector<HTMLElement>(`.sx__time-grid-day[data-time-grid-date="${today}"]`);
    if (dateGridToday) markCurrentCalendarDayCell(dateGridToday);
    if (timeGridToday) markCurrentCalendarDayCell(timeGridToday);
  };
  const queueApply = () => {
    if (frameId) window.cancelAnimationFrame(frameId);
    frameId = window.requestAnimationFrame(apply);
  };

  queueApply();
  const observer = new MutationObserver(queueApply);
  observer.observe(frame, { childList: true, subtree: true });

  return () => {
    if (frameId) window.cancelAnimationFrame(frameId);
    observer.disconnect();
    frame.querySelectorAll<HTMLElement>([
      ".sx__date-grid-day[data-hilt-current-calendar-day]",
      ".sx__date-grid-day[data-hilt-selected-date-grid-day]",
      ".sx__time-grid-day[data-hilt-current-calendar-day]",
      ".sx__time-grid-day[data-hilt-clear-selected-day]",
    ].join(", ")).forEach(clearCurrentCalendarDayMarker);
  };
}

function scrollTimeString(minute: number): string {
  const bounded = Math.max(0, Math.min(MINUTES_PER_DAY - 1, Math.round(minute)));
  const hours = Math.floor(bounded / 60);
  const minutes = bounded % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function CalendarView() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();
  const { scopePath } = useScope();
  const deepLink = useMemo(() => parseCalendarEventDeepLink(scopePath), [scopePath]);
  const [mode, setMode] = useState<CalendarMode>(defaultCalendarMode);
  const [miniMonthsVisible, setMiniMonthsVisible] = useState(defaultMiniMonthsVisible);
  const [selectedDate, setSelectedDate] = useState(() => parseCalendarEventDeepLink(scopePath)?.date ?? todayPlainDate());
  const [visibleRange, setVisibleRange] = useState(() => rangeAround(defaultCalendarMode(), parseCalendarEventDeepLink(scopePath)?.date ?? todayPlainDate()));
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const [pendingEventOpen, setPendingEventOpen] = useState<CalendarEventOpenDetail | null>(null);
  const currentDate = todayPlainDate();
  const steeredDeepLinkRef = useRef<string | null>(null);
  const openedDeepLinkRef = useRef<string | null>(null);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoSyncRef = useRef(false);
  const appliedMobileDefaultRef = useRef(false);
  const periodGestureCooldownRef = useRef(0);
  const calendarFrameRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const isDarkTheme = useResolvedDarkTheme();
  const isCalendarMobile = useCalendarMobileViewport();
  const showMiniMonths = miniMonthsVisible && !isCalendarMobile;
  const visibleTimeGridHeight = useVisibleTimeGridHeight(calendarFrameRef);
  const [eventsService] = useState(() => createEventsServicePlugin());
  const [calendarControls] = useState(() => createCalendarControlsPlugin());
  const [currentTimePlugin] = useState(() => createCurrentTimePlugin({ fullWeekWidth: true }));
  const [scrollController] = useState(() => createScrollControllerPlugin({ initialScroll: `${String(INITIAL_TIME_GRID_HOUR).padStart(2, "0")}:00` }));
  const [eventModal] = useState(() => createEventModalPlugin());
  const views = useMemo(() => [
    createViewDay(),
    createViewWeek(),
    createViewMonthGrid(),
    createViewMonthAgenda(),
  ] as [
    ReturnType<typeof createViewDay>,
    ReturnType<typeof createViewWeek>,
    ReturnType<typeof createViewMonthGrid>,
    ReturnType<typeof createViewMonthAgenda>,
  ], []);

  const sourcesQuery = useCalendarSources();
  const eventsQuery = useCalendarEvents(visibleRange);
  const weatherRange = useMemo(() => (
    mode === "day" || mode === "week" ? plainDateRangeAround(mode, selectedDate) : null
  ), [mode, selectedDate]);
  const periodPosition = useMemo(() => periodPositionForDate(mode, selectedDate), [mode, selectedDate]);
  const miniMonths = useMemo(() => MINI_MONTH_OFFSETS.map((offset) => buildMiniMonth(selectedDate, offset)), [selectedDate]);
  const activeMiniMonthRange = useMemo(() => miniMonthActiveRange(mode, selectedDate), [mode, selectedDate]);
  const weatherQuery = useWeatherForecast(weatherRange);
  const sources = sourcesQuery.data?.sources ?? EMPTY_SOURCES;
  const calendars = sourcesQuery.data?.calendars ?? EMPTY_CALENDARS;
  const events = eventsQuery.data?.events ?? EMPTY_EVENTS;
  const availabilityBlocks = eventsQuery.data?.availabilityBlocks ?? EMPTY_EVENTS;
  const holidayEvents = eventsQuery.data?.holidayEvents ?? EMPTY_EVENTS;
  const weatherDays = weatherQuery.data?.days ?? EMPTY_WEATHER_DAYS;
  const weatherLocationLabel = weatherQuery.data?.location.label ?? null;
  const focusedEvent = focusedEventId ? events.find((event) => event.id === focusedEventId) ?? null : null;
  const sourcesById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const calendarsById = useMemo(() => new Map(calendars.map((calendar) => [calendar.id, calendar])), [calendars]);
  const weatherByDate = useMemo(() => new Map(weatherDays.map((day) => [day.date, day])), [weatherDays]);
  const businessClosureDates = useMemo(() => businessClosureDateKeys(holidayEvents), [holidayEvents]);
  const evercommerceSelected = calendars.some((calendar) => calendar.sourceId === "evercommerce" && calendar.selected);
  const evercommerceCoverageEvents = useMemo(() => [
    ...availabilityBlocks,
    ...events.filter((event) => event.sourceId === "evercommerce"),
  ], [availabilityBlocks, events]);
  const visibleForegroundEvents = useMemo(() => events.filter(isVisibleCalendarForegroundEvent), [events]);
  const timeGridFit = useTimeGridFit(visibleTimeGridHeight, mode, visibleForegroundEvents, visibleRange);
  const scheduleEvents = useMemo(() => visibleForegroundEvents.map((event) => calendarEventToScheduleEvent(event, {
    focused: event.id === focusedEventId,
    availabilityWarning: evercommerceSelected
      && overlapsEverCommerceWorkday(event, businessClosureDates)
      && !isCoveredByEverCommerce(event, evercommerceCoverageEvents),
    calendar: calendarsById.get(event.calendarId) ?? null,
    source: sourcesById.get(event.sourceId) ?? null,
  })), [businessClosureDates, calendarsById, evercommerceCoverageEvents, evercommerceSelected, focusedEventId, sourcesById, visibleForegroundEvents]);
  const backgroundEvents = useMemo(() => availabilityBlocks
    .filter((event) => occursOnEverCommerceBusinessDay(event, businessClosureDates))
    .map(calendarEventToBackgroundEvent), [availabilityBlocks, businessClosureDates]);
  const scheduleCalendars = useMemo(() => calendarsForScheduleX(calendars), [calendars]);
  const [requestedPopover, setRequestedPopover] = useState<EventPopoverPosition | null>(null);
  const requestedScheduleEvent = useMemo(() => (
    requestedPopover ? scheduleEvents.find((event) => String(event.id) === requestedPopover.eventId) ?? null : null
  ), [requestedPopover, scheduleEvents]);
  const closeEventModal = useCallback(() => {
    eventModal.close();
    setFocusedEventId(null);
    setRequestedPopover(null);
  }, [eventModal]);
  const customComponents = useMemo(() => ({
    weekGridHour: WeekGridHourLabel,
    weekGridDate: function HiltWeekGridDate(props: HiltWeekGridDateProps) {
      return (
        <WeekGridDateHeader
          date={props.date}
          forecast={props.date ? weatherByDate.get(props.date) : null}
          locationLabel={weatherLocationLabel}
        />
      );
    },
    eventModal: function HiltScheduleEventModal(props: HiltEventModalProps) {
      return <EventModalContent scheduleEvent={props.calendarEvent ?? null} onClose={closeEventModal} />;
    },
  }), [closeEventModal, weatherByDate, weatherLocationLabel]);

  const calendarApp = useNextCalendarApp({
    selectedDate: Temporal.PlainDate.from(selectedDate),
    defaultView: MODE_TO_VIEW[mode],
    views,
    calendars: scheduleCalendars,
    events: scheduleEvents,
    isDark: isDarkTheme,
    isResponsive: false,
    skipAnimations: true,
    firstDayOfWeek: 7,
    timezone: TIME_ZONE,
    dayBoundaries: DAY_BOUNDARIES,
    weekOptions: {
      gridHeight: timeGridFit.gridHeight,
      gridStep: 30,
      eventWidth: 100,
      eventOverlap: false,
      timeAxisFormatOptions: { hour: "numeric" },
    },
    monthGridOptions: { nEventsPerDay: 4 },
    monthAgendaOptions: { nEventIndicatorsPerDay: 4 },
    callbacks: {
      onRangeUpdate: (range) => setVisibleRange(rangeFromScheduleX(range)),
      onSelectedDateUpdate: (date) => setSelectedDate(date.toString()),
      onEventClick: (event) => {
        setRequestedPopover(null);
        setFocusedEventId(String(event.id));
      },
      onBeforeEventUpdate: () => false,
    },
  }, [eventsService, calendarControls, currentTimePlugin, scrollController, eventModal]);

  const openFocusedEventPopover = useCallback((eventId: string) => {
    setFocusedEventId(eventId);
    setRequestedPopover({
      eventId,
      ...fallbackPopoverPosition(calendarFrameRef.current?.getBoundingClientRect()),
    });
    let attempts = 0;
    let frame = requestAnimationFrame(function open() {
      const element = calendarFrameRef.current?.querySelector(".hilt-calendar-event-focused");
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center" });
        const position = popoverPositionForEvent(
          element.getBoundingClientRect(),
          calendarFrameRef.current?.getBoundingClientRect(),
        );
        setRequestedPopover({ eventId, ...position });
        return;
      }
      if (++attempts < 30) frame = requestAnimationFrame(open);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const openCalendarEventDetail = useCallback((detail: CalendarEventOpenDetail) => {
    openedDeepLinkRef.current = null;
    sessionStorage.removeItem(PENDING_CALENDAR_EVENT_STORAGE_KEY);
    if (selectedDate !== detail.date) {
      setSelectedDate(detail.date);
      setVisibleRange(rangeAround(mode, detail.date));
    }
    setPendingEventOpen(detail);
  }, [mode, selectedDate]);

  useEffect(() => {
    if (!calendarApp) return;
    eventsService.set(scheduleEvents);
    eventsService.setBackgroundEvents(backgroundEvents);
  }, [backgroundEvents, calendarApp, eventsService, scheduleEvents]);

  useLayoutEffect(() => {
    if (appliedMobileDefaultRef.current) return;
    appliedMobileDefaultRef.current = true;
    if (!window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY).matches) return;
    if (mode !== "day") {
      setMode("day");
      setVisibleRange(rangeAround("day", selectedDate));
    }
  }, [mode, selectedDate]);

  useEffect(() => {
    if (!calendarApp) return;
    calendarApp.setTheme(isDarkTheme ? "dark" : "light");
    calendarControls.setCalendars(scheduleCalendars);
  }, [calendarApp, calendarControls, isDarkTheme, scheduleCalendars]);

  useLayoutEffect(() => {
    if (!calendarApp) return;
    calendarControls.setWeekOptions({
      gridHeight: timeGridFit.gridHeight,
      gridStep: 30,
      eventWidth: 100,
      eventOverlap: false,
      timeAxisFormatOptions: { hour: "numeric" },
    });
    if (mode === "day" || mode === "week") {
      return watchTimeGridScroll(
        calendarFrameRef.current,
        timeGridFit,
        () => {
          try {
            scrollController.scrollTo(scrollTimeString(timeGridFit.scrollMinute));
          } catch {
            // The plugin also owns initialScroll; this call only re-applies it after local layout changes.
          }
        },
      );
    }
    return undefined;
  }, [calendarApp, calendarControls, mode, scrollController, timeGridFit]);

  useLayoutEffect(() => {
    if (!calendarApp || (mode !== "day" && mode !== "week")) return undefined;
    return syncCurrentCalendarDay(calendarFrameRef.current, currentDate);
  }, [calendarApp, currentDate, mode, selectedDate, visibleRange]);

  useEffect(() => {
    if (!calendarApp) return;
    calendarControls.setView(MODE_TO_VIEW[mode]);
    calendarControls.setDate(Temporal.PlainDate.from(selectedDate));
    setVisibleRange(rangeAround(mode, selectedDate));
    if (!deepLink || deepLink.date !== selectedDate) closeEventModal();
  }, [calendarApp, calendarControls, closeEventModal, deepLink, mode, selectedDate]);

  // Arriving from a meeting note (/event/<id>/<date>): land on the date, then focus and
  // open that event's popover once it loads. Steering the date happens once per deep link so
  // later manual navigation isn't yanked back, even if the event never loads (e.g. source off).
  useEffect(() => {
    if (!deepLink) return;
    if (steeredDeepLinkRef.current !== deepLink.id) {
      steeredDeepLinkRef.current = deepLink.id;
      if (selectedDate !== deepLink.date) {
        setSelectedDate(deepLink.date);
        setVisibleRange(rangeAround(mode, deepLink.date));
      }
    }
    if (openedDeepLinkRef.current === deepLink.id) return;
    if (selectedDate !== deepLink.date) return;
    if (!events.some((event) => event.id === deepLink.id)) return;
    openedDeepLinkRef.current = deepLink.id;
    return openFocusedEventPopover(deepLink.id);
  }, [deepLink, events, mode, openFocusedEventPopover, selectedDate]);

  useEffect(() => {
    if (!pendingEventOpen) return;
    if (selectedDate !== pendingEventOpen.date) return;
    if (!events.some((event) => event.id === pendingEventOpen.id)) return;
    const eventId = pendingEventOpen.id;
    setPendingEventOpen(null);
    return openFocusedEventPopover(eventId);
  }, [events, openFocusedEventPopover, pendingEventOpen, selectedDate]);

  useEffect(() => {
    function openCalendarEvent(event: Event) {
      const detail = (event as CustomEvent<{ id?: unknown; date?: unknown }>).detail;
      if (!detail || typeof detail.id !== "string" || typeof detail.date !== "string") return;
      openCalendarEventDetail({ id: detail.id, date: detail.date });
    }

    window.addEventListener(CALENDAR_EVENT_OPEN_EVENT, openCalendarEvent);
    return () => window.removeEventListener(CALENDAR_EVENT_OPEN_EVENT, openCalendarEvent);
  }, [openCalendarEventDetail]);

  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_CALENDAR_EVENT_STORAGE_KEY);
    if (!raw) return;
    try {
      const detail = JSON.parse(raw) as Partial<CalendarEventOpenDetail>;
      if (typeof detail.id === "string" && typeof detail.date === "string") {
        openCalendarEventDetail({ id: detail.id, date: detail.date });
      } else {
        sessionStorage.removeItem(PENDING_CALENDAR_EVENT_STORAGE_KEY);
      }
    } catch {
      sessionStorage.removeItem(PENDING_CALENDAR_EVENT_STORAGE_KEY);
    }
  }, [openCalendarEventDetail]);

  useEffect(() => {
    if (!connected) return;
    subscribe("calendar");
    const unsubscribeHandler = on("calendar", "changed", () => {
      void mutateCalendarCaches();
    });
    return () => {
      unsubscribeHandler();
      unsubscribe("calendar");
    };
  }, [connected, on, subscribe, unsubscribe]);

  useEffect(() => {
    function closeMenus(event: MouseEvent) {
      const target = event.target;
      if (target instanceof Node) {
        if (!moreMenuRef.current?.contains(target)) setMoreMenuOpen(false);
      }
      if (target instanceof Element && !target.closest(".sx__event-modal, .hilt-calendar-event-popover-wrapper") && !target.closest(".sx__event")) {
        setFocusedEventId(null);
        setRequestedPopover(null);
      }
    }
    document.addEventListener("mousedown", closeMenus);
    return () => document.removeEventListener("mousedown", closeMenus);
  }, []);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") closeEventModal();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [closeEventModal]);

  const runSync = useCallback(async (quiet = false) => {
    setSyncing(true);
    if (!quiet) setSyncError(null);
    try {
      await syncCalendarSources();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Calendar sync failed.";
      setSyncError(message);
      if (!quiet) console.warn("[calendar] sync failed", error);
    } finally {
      setSyncing(false);
    }
  }, []);

  useEffect(() => {
    if (autoSyncRef.current || sourcesQuery.isLoading) return;
    if (!calendarSourcesNeedSync(sources)) return;
    autoSyncRef.current = true;
    void runSync(true);
  }, [runSync, sources, sourcesQuery.isLoading]);

  useEffect(() => {
    if (typeof window === "undefined" || isCalendarMobile) return;
    try {
      window.localStorage.setItem(MINI_MONTHS_VISIBLE_STORAGE_KEY, miniMonthsVisible ? "true" : "false");
    } catch {
      // Local storage can be unavailable in hardened browser contexts.
    }
  }, [isCalendarMobile, miniMonthsVisible]);

  const handleMode = useCallback((next: CalendarMode) => {
    setMode(next);
    setVisibleRange(rangeAround(next, selectedDate));
  }, [selectedDate]);

  const move = useCallback((direction: -1 | 1) => {
    const next = shiftPlainDate(selectedDate, mode, direction);
    setSelectedDate(next);
    setVisibleRange(rangeAround(mode, next));
  }, [mode, selectedDate]);

  const moveByGesture = useCallback((direction: -1 | 1) => {
    const now = Date.now();
    if (now - periodGestureCooldownRef.current < 450) return;
    periodGestureCooldownRef.current = now;
    move(direction);
  }, [move]);

  useEffect(() => {
    const element = calendarFrameRef.current;
    if (!element) return;
    let touchStart: { x: number; y: number; target: EventTarget | null } | null = null;

    const onWheel = (event: WheelEvent) => {
      if (shouldIgnoreCalendarPeriodGesture(event.target)) return;
      const absX = Math.abs(event.deltaX);
      const absY = Math.abs(event.deltaY);
      if (absX < 80 || absX < absY * 1.35) return;
      event.preventDefault();
      moveByGesture(event.deltaX > 0 ? 1 : -1);
    };

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1 || shouldIgnoreCalendarPeriodGesture(event.target)) {
        touchStart = null;
        return;
      }
      const touch = event.touches[0];
      touchStart = { x: touch.clientX, y: touch.clientY, target: event.target };
    };

    const onTouchMove = (event: TouchEvent) => {
      if (!touchStart || event.touches.length !== 1) return;
      const touch = event.touches[0];
      const absX = Math.abs(touch.clientX - touchStart.x);
      const absY = Math.abs(touch.clientY - touchStart.y);
      if (absX > 16 && absX > absY * 1.25) event.preventDefault();
    };

    const onTouchEndNavigate = (event: TouchEvent) => {
      if (!touchStart || shouldIgnoreCalendarPeriodGesture(touchStart.target)) {
        touchStart = null;
        return;
      }
      const touch = event.changedTouches[0];
      const start = touchStart;
      touchStart = null;
      if (!touch) return;
      const deltaX = start.x - touch.clientX;
      const deltaY = start.y - touch.clientY;
      if (Math.abs(deltaX) < 60 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25) return;
      moveByGesture(deltaX > 0 ? 1 : -1);
    };

    const onTouchCancel = () => {
      touchStart = null;
    };

    element.addEventListener("wheel", onWheel, { passive: false });
    element.addEventListener("touchstart", onTouchStart, { passive: true });
    element.addEventListener("touchmove", onTouchMove, { passive: false });
    element.addEventListener("touchend", onTouchEndNavigate, { passive: true });
    element.addEventListener("touchcancel", onTouchCancel, { passive: true });
    return () => {
      element.removeEventListener("wheel", onWheel);
      element.removeEventListener("touchstart", onTouchStart);
      element.removeEventListener("touchmove", onTouchMove);
      element.removeEventListener("touchend", onTouchEndNavigate);
      element.removeEventListener("touchcancel", onTouchCancel);
    };
  }, [moveByGesture]);

  const goToday = useCallback(() => {
    const today = todayPlainDate();
    setSelectedDate(today);
    setVisibleRange(rangeAround(mode, today));
  }, [mode]);

  const selectMiniMonthDate = useCallback((date: string) => {
    closeEventModal();
    setSelectedDate(date);
    setVisibleRange(rangeAround(mode, date));
  }, [closeEventModal, mode]);

  const toggleSource = useCallback(async (sourceId: string, selected: boolean) => {
    const sourceCalendars = calendars.filter((calendar) => calendar.sourceId === sourceId);
    await Promise.all(sourceCalendars.map((calendar) => setCalendarSelected(calendar.id, selected)));
    if (!selected && focusedEvent && sourceCalendars.some((calendar) => calendar.id === focusedEvent.calendarId)) {
      closeEventModal();
    }
  }, [calendars, closeEventModal, focusedEvent]);

  return (
    <div className="h-full min-h-0 bg-[var(--bg-primary)] text-[var(--text-primary)]" data-testid="calendar-view">
      <div className="flex h-full min-h-0 flex-col">
        <div className="relative z-30 shrink-0 px-3 py-2 sm:px-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="order-1 flex min-w-0 flex-1 items-center gap-2 sm:order-none">
              <div className="min-w-[128px] max-w-full shrink truncate text-sm font-semibold sm:text-base" data-testid="calendar-title">{formatCalendarTitle(mode, selectedDate)}</div>

              <div
                className="calendar-mode-control min-w-0 shrink-0"
                data-period-position={periodPosition}
                data-testid="calendar-period-navigation"
              >
                <button
                  aria-label="Previous period"
                  aria-pressed={periodPosition === "before"}
                  className={`calendar-mode-button calendar-period-button ${periodPosition === "before" ? "calendar-mode-button-active" : ""}`}
                  data-period-position="before"
                  data-testid="calendar-period-previous"
                  type="button"
                  onClick={() => move(-1)}
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  aria-label="Today"
                  aria-pressed={periodPosition === "today"}
                  className={`calendar-mode-button calendar-period-button ${periodPosition === "today" ? "calendar-mode-button-active" : ""}`}
                  data-period-position="today"
                  data-testid="calendar-period-today"
                  type="button"
                  onClick={goToday}
                >
                  Today
                </button>
                <button
                  aria-label="Next period"
                  aria-pressed={periodPosition === "after"}
                  className={`calendar-mode-button calendar-period-button ${periodPosition === "after" ? "calendar-mode-button-active" : ""}`}
                  data-period-position="after"
                  data-testid="calendar-period-next"
                  type="button"
                  onClick={() => move(1)}
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="calendar-mode-control order-3 ml-auto sm:order-none" data-testid="calendar-mode-control">
              <ModeButton mode="day" active={mode === "day"} onClick={handleMode} icon={<Clock className="h-4 w-4" />} />
              <ModeButton mode="week" active={mode === "week"} onClick={handleMode} icon={<CalendarDays className="h-4 w-4" />} />
              <ModeButton mode="month" active={mode === "month"} onClick={handleMode} icon={<CalendarDays className="h-4 w-4" />} />
              <ModeButton mode="agenda" active={mode === "agenda"} onClick={handleMode} icon={<LayoutList className="h-4 w-4" />} />
            </div>

            {!isCalendarMobile ? (
              <button
                type="button"
                className={`calendar-icon-button order-4 ${miniMonthsVisible ? "calendar-icon-button-active" : ""} sm:order-none`}
                aria-label={miniMonthsVisible ? "Hide mini months" : "Show mini months"}
                aria-pressed={miniMonthsVisible}
                data-testid="calendar-mini-months-toggle"
                onClick={() => setMiniMonthsVisible((visible) => !visible)}
              >
                <LayoutGrid className="h-4 w-4" />
              </button>
            ) : null}

            <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:order-none sm:ml-0">
              <CalendarMoreMenu
                menuRef={moreMenuRef}
                open={moreMenuOpen}
                sources={sources}
                calendars={calendars}
                syncing={syncing}
                onOpenChange={setMoreMenuOpen}
                onToggleSource={toggleSource}
                onSync={() => runSync(false)}
              />
            </div>
          </div>
        </div>

        {syncError ? (
          <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-5 py-2 text-sm text-red-700 dark:text-red-200">
            {syncError}
          </div>
        ) : null}

        <div className="relative z-0 flex min-h-0 flex-1 overflow-hidden">
          <main className="hilt-calendar-main hilt-mobile-fixed-clearance hilt-mobile-fixed-extra-2 flex min-w-0 flex-1 flex-col gap-3 overflow-hidden px-3 pb-3 pt-3 sm:px-5">
            {showMiniMonths ? (
              <MiniMonthStrip
                activeRange={activeMiniMonthRange}
                months={miniMonths}
                today={currentDate}
                onSelectDate={selectMiniMonthDate}
              />
            ) : null}
            <div ref={calendarFrameRef} className="min-h-0 flex-1 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-sm" data-testid="calendar-frame">
              <div className="hilt-calendar-body h-full min-h-0 p-2 sm:p-3">
                {calendarApp ? (
                  <div
                    className={`hilt-calendar h-full ${focusedEventId ? "has-focused-event" : ""}`}
                    data-calendar-mode={mode}
                    data-testid="schedule-x-calendar"
                  >
                    <ScheduleXCalendar calendarApp={calendarApp} customComponents={customComponents} />
                  </div>
                ) : (
                  <LoadingState label="Loading calendar" />
                )}
              </div>
            </div>
          </main>
          {requestedScheduleEvent ? (
            <div
              className="hilt-calendar-event-popover-wrapper fixed z-[90] w-[min(400px,calc(100vw-24px))]"
              style={{ top: requestedPopover?.top ?? 12, left: requestedPopover?.left ?? 12 }}
            >
              <EventModalContent scheduleEvent={requestedScheduleEvent} onClose={closeEventModal} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function MiniMonthStrip({
  activeRange,
  months,
  today,
  onSelectDate,
}: {
  activeRange: MiniMonthActiveRange;
  months: MiniMonthModel[];
  today: string;
  onSelectDate: (date: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchorMonthKey = months[MINI_MONTH_PAST_MONTHS]?.key ?? "";

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;

    let frame = 0;
    const layoutAndAlignToAnchorMonths = () => {
      const current = scroll.querySelector<HTMLElement>('[data-mini-month-offset="0"]');
      if (!current) return;
      const previous = scroll.querySelector<HTMLElement>('[data-mini-month-offset="-1"]');
      const styles = window.getComputedStyle(scroll);
      const gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
      const paddingLeft = parseFloat(styles.paddingLeft || "0") || 0;
      const paddingRight = parseFloat(styles.paddingRight || "0") || 0;
      const availableWidth = Math.max(0, scroll.clientWidth - paddingLeft - paddingRight);
      const minCardWidth = parseCssPixelValue(styles.getPropertyValue("--calendar-mini-month-min-width"), 208);
      const maxVisibleCards = Number.parseInt(styles.getPropertyValue("--calendar-mini-month-max-visible"), 10) || 6;
      const visibleCards = Math.max(
        1,
        Math.min(maxVisibleCards, Math.floor((availableWidth + gap) / (minCardWidth + gap))),
      );
      const cardWidth = Math.max(1, (availableWidth - gap * (visibleCards - 1)) / visibleCards);
      scroll.style.setProperty("--calendar-mini-month-card-width", `${cardWidth}px`);

      const target = visibleCards >= 3 ? previous ?? current : current;
      const scrollRect = scroll.getBoundingClientRect();
      const targetRect = target.getBoundingClientRect();
      const leadingGutter = gap || paddingLeft;
      const nextScrollLeft = scroll.scrollLeft + targetRect.left - scrollRect.left - leadingGutter;
      scroll.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: "auto" });
    };
    const queueAlign = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(layoutAndAlignToAnchorMonths);
    };

    queueAlign();
    const observer = new ResizeObserver(queueAlign);
    observer.observe(scroll);
    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [anchorMonthKey]);

  return (
    <section className="calendar-mini-month-strip" aria-label="Mini month calendars" data-testid="calendar-mini-month-strip">
      <div ref={scrollRef} className="calendar-mini-month-scroll">
        {months.map((month) => {
          const isPastMonth = isMiniMonthBeforeCurrentMonth(month.key, today);
          return (
            <article
              key={month.key}
              className={`calendar-mini-month ${isPastMonth ? "is-past" : ""}`}
              style={isPastMonth ? { opacity: 0.6 } : undefined}
              aria-label={month.label}
              data-mini-month-offset={month.offset}
            >
              <div className="calendar-mini-month-header">{month.label}</div>
              <div className="calendar-mini-month-weekdays" aria-hidden="true">
                {MINI_MONTH_WEEKDAYS.map((weekday, index) => (
                  <div key={`${weekday}-${index}`}>{weekday}</div>
                ))}
              </div>
              <div className="calendar-mini-month-grid">
                {month.days.map((day, index) => {
                  const isToday = day.inMonth && day.date === today;
                  const isActiveRange = miniMonthDateIsActive(day, month, activeRange);
                  const previousDay = index > 0 ? month.days[index - 1] : null;
                  const nextDay = index < month.days.length - 1 ? month.days[index + 1] : null;
                  const isActiveRangeStart = isActiveRange && (index % 7 === 0 || !previousDay || !miniMonthDateIsActive(previousDay, month, activeRange));
                  const isActiveRangeEnd = isActiveRange && (index % 7 === 6 || !nextDay || !miniMonthDateIsActive(nextDay, month, activeRange));
                  const className = [
                    "calendar-mini-month-day",
                    day.inMonth ? "" : "is-outside",
                    isActiveRange ? "is-active-range" : "",
                    isActiveRangeStart ? "is-active-range-start" : "",
                    isActiveRangeEnd ? "is-active-range-end" : "",
                    isToday ? "is-today" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <button
                      key={day.date}
                      type="button"
                      className={className}
                      aria-current={isToday ? "date" : undefined}
                      aria-label={formatMiniMonthDayLabel(day.date)}
                      data-active-range={isActiveRange ? activeRange.mode : undefined}
                      onClick={() => onSelectDate(day.date)}
                    >
                      <span className="calendar-mini-month-day-label">{day.day}</span>
                    </button>
                  );
                })}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ModeButton({
  mode,
  active,
  icon,
  onClick,
}: {
  mode: CalendarMode;
  active: boolean;
  icon: React.ReactNode;
  onClick: (mode: CalendarMode) => void;
}) {
  return (
    <button
      type="button"
      className={`calendar-mode-button ${active ? "calendar-mode-button-active" : ""}`}
      onClick={() => onClick(mode)}
      aria-label={`${mode[0].toUpperCase() + mode.slice(1)} view`}
      aria-pressed={active}
      data-testid={`calendar-mode-${mode}`}
    >
      {icon}
      <span>{mode[0].toUpperCase() + mode.slice(1)}</span>
    </button>
  );
}

function CalendarMoreMenu({
  menuRef,
  open,
  sources,
  calendars,
  syncing,
  onOpenChange,
  onToggleSource,
  onSync,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  sources: CalendarSource[];
  calendars: CalendarDefinition[];
  syncing: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSource: (sourceId: string, selected: boolean) => void;
  onSync: () => void;
}) {
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label={syncing ? "Calendar sync running" : "Calendar actions"}
        className="calendar-icon-button"
        onClick={() => onOpenChange(!open)}
        title={syncing ? "Calendar sync running" : "Calendar actions"}
        data-testid="calendar-actions-menu"
      >
        {syncing ? <RefreshCw className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[80] mt-1 w-64 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Calendars
          </div>
          <div className="px-1 pb-1">
            {sources.map((source) => {
              const sourceCalendars = calendars.filter((calendar) => calendar.sourceId === source.id);
              const selected = sourceCalendars.length > 0 && sourceCalendars.every((calendar) => calendar.selected);
              const disabled = sourceCalendars.length === 0;
              return (
                <button
                  key={source.id}
                  type="button"
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${disabled ? "opacity-50" : "hover:bg-[var(--bg-tertiary)]"}`}
                  onClick={() => {
                    if (!disabled) onToggleSource(source.id, !selected);
                  }}
                  disabled={disabled}
                  aria-pressed={selected}
                  data-testid={`calendar-source-toggle-${source.id}`}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: source.color }} />
                  <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]">{source.label}</span>
                  {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" /> : null}
                </button>
              );
            })}
          </div>
          <div className="border-t border-[var(--border-subtle)]" />
          <button
            type="button"
            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
            onClick={() => {
              onOpenChange(false);
              onSync();
            }}
            disabled={syncing}
            data-testid="calendar-sync-button"
          >
            {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            <span>{syncing ? "Syncing" : "Sync now"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

function EventModalContent({
  scheduleEvent,
  onClose,
}: {
  scheduleEvent: HiltScheduleEvent | null;
  onClose: () => void;
}) {
  return (
    <CalendarEventPopoverContent
      availabilityWarning={scheduleEvent?.availabilityWarning}
      calendarColor={scheduleEvent?.calendarColor}
      calendarLabel={scheduleEvent?.calendarLabel}
      event={scheduleEvent?.hiltEvent ?? null}
      onClose={onClose}
      sourceLabel={scheduleEvent?.sourceLabel}
    />
  );
}
