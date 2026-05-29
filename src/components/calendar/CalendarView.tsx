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
  ExternalLink,
  LayoutList,
  Link as LinkIcon,
  Loader2,
  MapPin,
  MoreHorizontal,
  NotebookPen,
  RefreshCw,
  Sun,
  UserRound,
  UsersRound,
  Video,
  X,
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
import {
  mutateCalendarCaches,
  setCalendarSelected,
  syncCalendarSources,
  useCalendarEvents,
  useCalendarSources,
} from "@/hooks/useCalendar";
import { useWeatherForecast } from "@/hooks/useWeather";
import type { CalendarDefinition, CalendarEvent, CalendarSource } from "@/lib/calendar/types";
import type { WeatherForecastDay, WeatherIconKey } from "@/lib/weather/types";

type CalendarMode = "day" | "week" | "month" | "agenda";
type HiltScheduleEvent = CalendarEventExternal & {
  hiltEvent?: CalendarEvent;
  joinLabel?: string | null;
  sourceText?: string;
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

// Name the external destination so "open in provider" reads differently from an in-app jump.
function providerLinkLabel(url: string, sourceLabel?: string | null): string {
  try {
    const host = new URL(url).hostname;
    if (/(^|\.)google\./.test(host)) return "Open in Google";
    if (/(^|\.)(outlook|office|live|microsoft)\./.test(host)) return "Open in Outlook";
  } catch {
    // Fall through to the source label.
  }
  return sourceLabel ? `Open in ${sourceLabel}` : "Open link";
}

// Deep link from a meeting note back to its calendar event: /event/<encoded id>/<YYYY-MM-DD>.
function parseCalendarEventDeepLink(scopePath: string): { id: string; date: string } | null {
  const match = scopePath.match(/^\/event\/([^/]+)\/(\d{4}-\d{2}-\d{2})$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), date: match[2] };
}

const TIME_ZONE = "America/New_York";
const DAY_BOUNDARIES = { start: "00:00", end: "24:00" };
const INITIAL_TIME_GRID_HOUR = 9;
const MOBILE_CALENDAR_MEDIA_QUERY = "(max-width: 640px)";
const EVERCOMMERCE_WORKDAY_START_HOUR = 9;
const EVERCOMMERCE_WORKDAY_END_HOUR = 17;
const EMPTY_SOURCES: CalendarSource[] = [];
const EMPTY_CALENDARS: CalendarDefinition[] = [];
const EMPTY_EVENTS: CalendarEvent[] = [];
const EMPTY_WEATHER_DAYS: WeatherForecastDay[] = [];
const DEFAULT_WEEK_GRID_HEIGHT = 1440;

function todayPlainDate(): string {
  return Temporal.Now.plainDateISO(TIME_ZONE).toString();
}

function defaultCalendarMode(): CalendarMode {
  return typeof window !== "undefined" && window.matchMedia(MOBILE_CALENDAR_MEDIA_QUERY).matches ? "day" : "week";
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

function rangeAround(mode: CalendarMode, date: string): { start: Date; end: Date } {
  let start = Temporal.PlainDate.from(date);
  let end = start;
  if (mode === "day") {
    end = start.add({ days: 1 });
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
  }
  return { start: start.toString(), end: end.toString() };
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
    title: event.title,
    start: scheduleDateFromEventStart(event),
    end: scheduleDateFromEventEnd(event),
    calendarId: event.calendarId,
    people: event.attendees.map((attendee) => attendee.name || attendee.email || "").filter(Boolean),
    location: event.location || undefined,
    description: event.description || undefined,
    _options: { disableDND: true, disableResize: true, additionalClasses },
    joinLabel: join ? JOIN_LABELS[join.kind] : null,
    sourceText,
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

function formatEventTime(event: CalendarEvent): string {
  if (event.allDay) return "All day";
  const start = new Date(event.start);
  const end = new Date(event.end);
  const day = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "short", month: "short", day: "numeric" }).format(start);
  const time = new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, hour: "numeric", minute: "2-digit" });
  return `${day}, ${time.format(start)} - ${time.format(end)}`;
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
      <div className="hilt-week-grid-date-row">
        <div className="sx__week-grid__date-number">{plainDate.day}</div>
        {forecast ? (
          <WeatherForecastLink forecast={forecast} fullDate={fullDate} locationLabel={locationLabel} />
        ) : null}
      </div>
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
      <WeatherConditionIcon icon={forecast.icon} />
      <span className="hilt-weather-temp">{high}&deg;/{low}&deg;</span>
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

function useResponsiveWeekGridHeight(ref: React.RefObject<HTMLElement | null>): number {
  const [height, setHeight] = useState(DEFAULT_WEEK_GRID_HEIGHT);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      const visibleGridHeight = Math.max(560, Math.round(rect.height - 122));
      const next = Math.max(DEFAULT_WEEK_GRID_HEIGHT, visibleGridHeight * 2.2);
      setHeight(next);
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

export function CalendarView() {
  const { connected, subscribe, unsubscribe, on } = useEventSocketContext();
  const { scopePath } = useScope();
  const deepLink = useMemo(() => parseCalendarEventDeepLink(scopePath), [scopePath]);
  const [mode, setMode] = useState<CalendarMode>(defaultCalendarMode);
  const [selectedDate, setSelectedDate] = useState(() => parseCalendarEventDeepLink(scopePath)?.date ?? todayPlainDate());
  const [visibleRange, setVisibleRange] = useState(() => rangeAround(defaultCalendarMode(), parseCalendarEventDeepLink(scopePath)?.date ?? todayPlainDate()));
  const [focusedEventId, setFocusedEventId] = useState<string | null>(null);
  const steeredDeepLinkRef = useRef<string | null>(null);
  const openedDeepLinkRef = useRef<string | null>(null);
  const [calendarMenuOpen, setCalendarMenuOpen] = useState(false);
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoSyncRef = useRef(false);
  const appliedMobileDefaultRef = useRef(false);
  const periodGestureCooldownRef = useRef(0);
  const calendarFrameRef = useRef<HTMLDivElement>(null);
  const calendarMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const isDarkTheme = useResolvedDarkTheme();
  const weekGridHeight = useResponsiveWeekGridHeight(calendarFrameRef);
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
  const holidayDates = useMemo(() => holidayDateKeys(holidayEvents), [holidayEvents]);
  const evercommerceSelected = calendars.some((calendar) => calendar.sourceId === "evercommerce" && calendar.selected);
  const evercommerceCoverageEvents = useMemo(() => [
    ...availabilityBlocks,
    ...events.filter((event) => event.sourceId === "evercommerce"),
  ], [availabilityBlocks, events]);
  const scheduleEvents = useMemo(() => events.map((event) => calendarEventToScheduleEvent(event, {
    focused: event.id === focusedEventId,
    availabilityWarning: evercommerceSelected
      && overlapsEverCommerceWorkday(event, holidayDates)
      && !isCoveredByEverCommerce(event, evercommerceCoverageEvents),
    calendar: calendarsById.get(event.calendarId) ?? null,
    source: sourcesById.get(event.sourceId) ?? null,
  })), [calendarsById, evercommerceCoverageEvents, evercommerceSelected, events, focusedEventId, holidayDates, sourcesById]);
  const backgroundEvents = useMemo(() => availabilityBlocks
    .filter((event) => occursOnEverCommerceBusinessDay(event, holidayDates))
    .map(calendarEventToBackgroundEvent), [availabilityBlocks, holidayDates]);
  const scheduleCalendars = useMemo(() => calendarsForScheduleX(calendars), [calendars]);
  const closeEventModal = useCallback(() => {
    eventModal.close();
    setFocusedEventId(null);
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
    firstDayOfWeek: 7,
    timezone: TIME_ZONE,
    dayBoundaries: DAY_BOUNDARIES,
    weekOptions: {
      gridHeight: weekGridHeight,
      gridStep: 30,
      eventWidth: 95,
      eventOverlap: true,
      timeAxisFormatOptions: { hour: "numeric" },
    },
    monthGridOptions: { nEventsPerDay: 4 },
    monthAgendaOptions: { nEventIndicatorsPerDay: 4 },
    callbacks: {
      onRangeUpdate: (range) => setVisibleRange(rangeFromScheduleX(range)),
      onSelectedDateUpdate: (date) => setSelectedDate(date.toString()),
      onEventClick: (event) => setFocusedEventId(String(event.id)),
      onBeforeEventUpdate: () => false,
    },
  }, [eventsService, calendarControls, currentTimePlugin, scrollController, eventModal]);

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

  useEffect(() => {
    if (!calendarApp) return;
    calendarControls.setWeekOptions({
      gridHeight: weekGridHeight,
      gridStep: 30,
      eventWidth: 95,
      eventOverlap: true,
      timeAxisFormatOptions: { hour: "numeric" },
    });
  }, [calendarApp, calendarControls, weekGridHeight]);

  useEffect(() => {
    if (!calendarApp || (mode !== "day" && mode !== "week")) return;
    const frame = requestAnimationFrame(() => {
      try {
        scrollController.scrollTo(`${String(INITIAL_TIME_GRID_HOUR).padStart(2, "0")}:00`);
      } catch {
        // The plugin also owns initialScroll; this call only re-applies it after local layout changes.
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [calendarApp, mode, scrollController, selectedDate, weekGridHeight]);

  useEffect(() => {
    if (!calendarApp) return;
    calendarControls.setView(MODE_TO_VIEW[mode]);
    calendarControls.setDate(Temporal.PlainDate.from(selectedDate));
    setVisibleRange(rangeAround(mode, selectedDate));
    closeEventModal();
  }, [calendarApp, calendarControls, closeEventModal, mode, selectedDate]);

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
    setFocusedEventId(deepLink.id);
    let attempts = 0;
    let frame = requestAnimationFrame(function open() {
      const element = calendarFrameRef.current?.querySelector(".hilt-calendar-event-focused");
      if (element instanceof HTMLElement) {
        element.scrollIntoView({ block: "center" });
        element.click();
        return;
      }
      if (++attempts < 30) frame = requestAnimationFrame(open);
    });
    return () => cancelAnimationFrame(frame);
  }, [deepLink, events, mode, selectedDate]);

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
        if (!calendarMenuRef.current?.contains(target)) setCalendarMenuOpen(false);
        if (!moreMenuRef.current?.contains(target)) setMoreMenuOpen(false);
      }
      if (target instanceof Element && !target.closest(".sx__event-modal") && !target.closest(".sx__event")) {
        setFocusedEventId(null);
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
    if (!sources.length) return;
    const configured = sources.every((source) => source.configured);
    const needsInitialSync = configured && sources.some((source) => !source.lastSyncAt);
    if (!needsInitialSync) return;
    autoSyncRef.current = true;
    void runSync(true);
  }, [runSync, sources, sourcesQuery.isLoading]);

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
            <div className="min-w-[128px] flex-1">
              <div className="truncate text-sm font-semibold sm:text-base" data-testid="calendar-title">{formatCalendarTitle(mode, selectedDate)}</div>
            </div>

            <div className="order-3 flex min-w-0 shrink-0 items-center gap-1 sm:order-none">
              <button aria-label="Previous" type="button" className="calendar-icon-button" onClick={() => move(-1)}>
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button type="button" className="calendar-text-button" onClick={goToday}>Today</button>
              <button aria-label="Next" type="button" className="calendar-icon-button" onClick={() => move(1)}>
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="calendar-mode-control order-4 ml-auto sm:order-none sm:ml-0" data-testid="calendar-mode-control">
              <ModeButton mode="day" active={mode === "day"} onClick={handleMode} icon={<Clock className="h-4 w-4" />} />
              <ModeButton mode="week" active={mode === "week"} onClick={handleMode} icon={<CalendarDays className="h-4 w-4" />} />
              <ModeButton mode="month" active={mode === "month"} onClick={handleMode} icon={<CalendarDays className="h-4 w-4" />} />
              <ModeButton mode="agenda" active={mode === "agenda"} onClick={handleMode} icon={<LayoutList className="h-4 w-4" />} />
            </div>

            <div className="order-2 ml-auto flex shrink-0 items-center gap-1 sm:order-none sm:ml-0">
              <CalendarSourceMenu
                menuRef={calendarMenuRef}
                open={calendarMenuOpen}
                sources={sources}
                calendars={calendars}
                onOpenChange={setCalendarMenuOpen}
                onToggleSource={toggleSource}
              />
              <CalendarMoreMenu
                menuRef={moreMenuRef}
                open={moreMenuOpen}
                syncing={syncing}
                onOpenChange={setMoreMenuOpen}
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
          <main className="hilt-calendar-main flex min-w-0 flex-1 flex-col overflow-hidden px-3 pb-3 pt-3 sm:px-5">
            <div ref={calendarFrameRef} className="h-full min-h-0 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-sm" data-testid="calendar-frame">
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
                  <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">Loading calendar</div>
                )}
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
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

function CalendarSourceMenu({
  menuRef,
  sources,
  calendars,
  open,
  onOpenChange,
  onToggleSource,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  sources: CalendarSource[];
  calendars: CalendarDefinition[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggleSource: (sourceId: string, selected: boolean) => void;
}) {
  const selectedCount = sources.filter((source) => {
    const sourceCalendars = calendars.filter((calendar) => calendar.sourceId === source.id);
    return sourceCalendars.length > 0 && sourceCalendars.some((calendar) => calendar.selected);
  }).length;

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        className="calendar-text-button"
        onClick={() => onOpenChange(!open)}
        data-testid="calendar-source-menu"
      >
        <CalendarDays className="h-4 w-4" />
        <span className="hidden sm:inline">Calendars</span>
        <span className="sm:hidden">{selectedCount || sources.length}</span>
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[80] mt-1 w-60 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl">
          <div className="border-b border-[var(--border-subtle)] px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            Calendars
          </div>
          <div className="p-1">
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
        </div>
      ) : null}
    </div>
  );
}

function CalendarMoreMenu({
  menuRef,
  open,
  syncing,
  onOpenChange,
  onSync,
}: {
  menuRef: React.RefObject<HTMLDivElement | null>;
  open: boolean;
  syncing: boolean;
  onOpenChange: (open: boolean) => void;
  onSync: () => void;
}) {
  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-label="Calendar actions"
        className="calendar-icon-button"
        onClick={() => onOpenChange(!open)}
        data-testid="calendar-actions-menu"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-[80] mt-1 w-44 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-xl">
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
  const { navigateTo } = useScope();
  const contentRef = useRef<HTMLDivElement>(null);
  const event = scheduleEvent?.hiltEvent ?? null;
  useLayoutEffect(() => {
    const wrapper = contentRef.current?.closest(".sx__event-modal");
    if (!(wrapper instanceof HTMLElement)) return;
    const margin = 12;
    const clamp = () => {
      wrapper.style.maxHeight = `${Math.min(520, window.innerHeight - margin * 2)}px`;
      const rect = wrapper.getBoundingClientRect();
      const top = Math.min(Math.max(rect.top, margin), Math.max(margin, window.innerHeight - rect.height - margin));
      const left = Math.min(Math.max(rect.left, margin), Math.max(margin, window.innerWidth - rect.width - margin));
      wrapper.style.top = `${Math.round(top)}px`;
      wrapper.style.left = `${Math.round(left)}px`;
    };
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", clamp);
    };
  }, [scheduleEvent?.id]);

  if (!event) return null;
  return (
    <div
      ref={contentRef}
      className="flex max-h-[inherit] min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-elevated)] shadow-2xl"
      data-testid="calendar-event-popover"
    >
      <div className="flex min-h-[52px] shrink-0 items-start gap-2 border-b border-[var(--border-default)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="break-words text-sm font-semibold leading-5">
            {scheduleEvent?.availabilityWarning ? (
              <span className="mr-1.5 inline-flex h-4 w-4 translate-y-0.5 items-center justify-center rounded-full bg-amber-500 text-[10px] font-bold text-white" title="Not blocked on EverCommerce">!</span>
            ) : null}
            {event.title}
          </div>
        </div>
        <button type="button" aria-label="Close event details" className="calendar-icon-button h-8 w-8" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="space-y-4">
          {(event.joinLinks.length > 0 || event.meetingNotes?.length || event.providerUrl) ? (
            <div className="flex flex-wrap gap-2" data-testid="calendar-event-actions">
              {event.joinLinks.map((link, index) => (
                <a
                  key={`${link.kind}:${link.url}`}
                  href={link.url}
                  target="_blank"
                  rel="noreferrer"
                  className={
                    index === 0
                      ? "inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-3 text-sm font-medium text-[var(--text-inverted)] hover:bg-[var(--interactive-hover)]"
                      : "inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  }
                >
                  {link.kind === "web" ? <LinkIcon className="h-3.5 w-3.5" /> : <Video className="h-3.5 w-3.5" />}
                  {link.kind === "web" ? "Join" : `Join ${JOIN_LABELS[link.kind]}`}
                </a>
              ))}
              {event.meetingNotes?.map((note) => (
                <button
                  key={note.granolaId}
                  type="button"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                  onClick={() => {
                    navigateTo("people", `/__inbox__/meeting/${encodeURIComponent(note.granolaId)}`);
                    onClose();
                  }}
                  title={note.calendarMatchMethod
                    ? `Linked notes · ${note.calendarMatchMethod}${note.calendarMatchConfidence != null ? ` · ${Math.round(note.calendarMatchConfidence * 100)}%` : ""}`
                    : "Linked meeting notes"}
                >
                  <NotebookPen className="h-3.5 w-3.5" />
                  Notes
                </button>
              ))}
              {event.providerUrl ? (
                <a
                  href={event.providerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  {providerLinkLabel(event.providerUrl, scheduleEvent?.sourceLabel)}
                </a>
              ) : null}
            </div>
          ) : null}

          <DetailRow
            icon={<Clock className="h-4 w-4" />}
            label={(
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span>{formatEventTime(event)}</span>
                {event.recurrence.recurring ? (
                  <span
                    className="rounded-md border border-[var(--border-default)] px-2 py-0.5 text-xs text-[var(--text-secondary)]"
                    data-testid="calendar-event-recurring"
                  >
                    Recurring
                  </span>
                ) : null}
              </div>
            )}
          />
          <DetailRow icon={<CalendarDays className="h-4 w-4" />} label={scheduleEvent?.calendarLabel || scheduleEvent?.sourceLabel || "Calendar"} />
          {scheduleEvent?.availabilityWarning ? (
            <DetailRow icon={<Clock className="h-4 w-4" />} label="Not blocked on EverCommerce" />
          ) : null}
          {event.location ? <DetailRow icon={<MapPin className="h-4 w-4" />} label={event.location} /> : null}
          {event.organizer ? <DetailRow icon={<UserRound className="h-4 w-4" />} label={event.organizer.name || event.organizer.email || "Organizer"} /> : null}
          {event.attendees.length ? <DetailRow icon={<UsersRound className="h-4 w-4" />} label={`${event.attendees.length} attendees`} /> : null}
          {event.duplicateSourceCount > 1 ? <DetailRow icon={<Check className="h-4 w-4" />} label={`${event.duplicateSourceCount} sources`} /> : null}

          {event.description ? (
            <div className="space-y-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Description</div>
              <div className="whitespace-pre-wrap break-words rounded-md border border-[var(--border-subtle)] bg-[var(--bg-secondary)] p-3 text-sm leading-6 text-[var(--text-secondary)]">
                {event.description}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function DetailRow({ icon, label }: { icon: React.ReactNode; label: React.ReactNode }) {
  return (
    <div className="flex gap-3 text-sm">
      <div className="mt-0.5 shrink-0 text-[var(--text-tertiary)]">{icon}</div>
      <div className="min-w-0 flex-1 break-words text-[var(--text-secondary)]">{label}</div>
    </div>
  );
}
