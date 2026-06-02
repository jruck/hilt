"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { CalendarClock } from "lucide-react";
import { useCalendarEvents, useCalendarSources } from "@/hooks/useCalendar";
import { CalendarEventPopoverContent } from "./calendar/CalendarEventPopover";
import type { CalendarDefinition, CalendarEvent } from "@/lib/calendar/types";
import { isVisibleCalendarForegroundEvent } from "@/lib/calendar/visibility";

const TIME_ZONE = "America/New_York";
const UPCOMING_LOOKAHEAD_DAYS = 7;
const FREE_BLOCK_MINUTES = 30;
const MAX_SOON_ITEMS = 28;
const fadeEndMaskStyle: CSSProperties = {
  WebkitMaskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
  maskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
};

interface AppHudProps {
  onCollapse: () => void;
  placement: "top" | "bottom";
}

type AgendaItem =
  | { kind: "event"; event: CalendarEvent }
  | { kind: "free"; id: string; start: Date; end: Date; minutes: number };
type AgendaSection = { id: string; items: AgendaItem[]; label: string };
type HudEventPopoverAnchor = { top: number; bottom: number; left: number; width: number };
type HudEventPopover = {
  anchor: HudEventPopoverAnchor;
  event: CalendarEvent;
  left: number;
  top: number;
};

export function AppHud({ onCollapse, placement }: AppHudProps) {
  const now = useLiveNow();
  const eventPopoverRef = useRef<HTMLDivElement>(null);
  const [eventPopover, setEventPopover] = useState<HudEventPopover | null>(null);
  const todayKey = localDateKey(now);
  const range = useMemo(() => {
    const start = dateFromLocalKey(todayKey);
    const end = new Date(start);
    end.setDate(end.getDate() + UPCOMING_LOOKAHEAD_DAYS);
    return { start, end };
  }, [todayKey]);

  const { data, error, isLoading } = useCalendarEvents(range);
  const sourcesQuery = useCalendarSources();
  const calendarSources = sourcesQuery.data?.calendars;
  const sources = sourcesQuery.data?.sources;
  const calendarEvents = data?.events;
  const calendarColors = useMemo(() => calendarColorMap(calendarSources ?? []), [calendarSources]);
  const calendarsById = useMemo(() => new Map((calendarSources ?? []).map((calendar) => [calendar.id, calendar])), [calendarSources]);
  const sourcesById = useMemo(() => new Map((sources ?? []).map((source) => [source.id, source])), [sources]);
  const visibleEvents = useMemo(() => selectHudEvents(calendarEvents ?? [], now), [calendarEvents, now]);
  const timedEvents = useMemo(() => visibleEvents.filter((event) => !event.allDay), [visibleEvents]);
  const currentEvent = timedEvents.find((event) => isEventCurrent(event, now)) ?? null;
  const nextEvent = timedEvents.find((event) => !currentEvent || new Date(event.start) >= new Date(currentEvent.end)) ?? null;
  const soonItems = useMemo(() => buildSoonItems(timedEvents, now, currentEvent, nextEvent), [currentEvent, nextEvent, now, timedEvents]);
  const agendaSections = useMemo(() => buildAgendaSections(soonItems, now), [now, soonItems]);
  const allDayEvents = visibleEvents.filter((event) => event.allDay).slice(0, 3);
  const openCalendarEvent = useCallback((event: CalendarEvent, target: HTMLElement) => {
    const anchor = hudPopoverAnchor(target);
    const position = hudPopoverPosition(anchor, placement);
    setEventPopover({ anchor, event, ...position });
  }, [placement]);
  const repositionEventPopover = useCallback(() => {
    setEventPopover((current) => {
      const wrapper = eventPopoverRef.current;
      if (!current || !wrapper) return current;
      const rect = wrapper.getBoundingClientRect();
      const position = hudPopoverPosition(current.anchor, placement, rect.height, rect.width);
      if (current.top === position.top && current.left === position.left) return current;
      return { ...current, ...position };
    });
  }, [placement]);
  const eventPopoverLayoutKey = eventPopover
    ? `${eventPopover.event.id}:${eventPopover.anchor.top}:${eventPopover.anchor.bottom}:${eventPopover.anchor.left}:${eventPopover.anchor.width}`
    : "";

  useLayoutEffect(() => {
    if (!eventPopoverLayoutKey) return undefined;
    const frame = window.requestAnimationFrame(repositionEventPopover);
    window.addEventListener("resize", repositionEventPopover);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", repositionEventPopover);
    };
  }, [eventPopoverLayoutKey, repositionEventPopover]);

  useEffect(() => {
    if (!eventPopover) return undefined;

    function closeOnOutside(event: globalThis.MouseEvent) {
      const target = event.target;
      if (target instanceof Node && eventPopoverRef.current?.contains(target)) return;
      if (target instanceof Element && target.closest("[data-hud-event-trigger]")) return;
      setEventPopover(null);
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setEventPopover(null);
    }

    document.addEventListener("mousedown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [eventPopover]);

  return (
    <aside
      data-testid="app-hud"
      data-placement={placement}
      className={`relative shrink-0 bg-[var(--bg-primary)] text-[var(--text-primary)] ${
        placement === "top"
          ? "h-[22dvh] min-h-[174px] max-h-[260px] border-b border-[var(--border-default)]"
          : "h-[22dvh] min-h-[176px] max-h-[280px] border-t border-[var(--border-default)]"
      }`}
    >
      <button
        type="button"
        aria-label="Hide HUD"
        className={`absolute left-0 right-0 z-20 h-3 bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)] ${
          placement === "top" ? "-bottom-px cursor-n-resize" : "-top-px cursor-s-resize"
        }`}
        data-testid="app-hud-collapse-strip"
        title="Hide HUD"
        style={{ cursor: placement === "top" ? "n-resize" : "s-resize" }}
        onClick={onCollapse}
      />
      <div className="flex h-full min-h-0 flex-col gap-3 px-4 py-3 sm:px-5">
        <div className="flex shrink-0 items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <CalendarClock className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
            <div className="min-w-0 truncate text-sm font-semibold">{formatHudDate(now)}</div>
          </div>
          <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
            {allDayEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className="hidden max-w-[150px] truncate rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] sm:inline"
                title={`Open details for ${event.title}`}
                data-hud-event-trigger
                onClick={(clickEvent) => openCalendarEvent(event, clickEvent.currentTarget)}
              >
                {event.title}
              </button>
            ))}
            <span className="shrink-0 tabular-nums text-sm font-medium text-[var(--text-secondary)]">
              {formatClock(now)}
            </span>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-[minmax(190px,0.9fr)_minmax(220px,1fr)_minmax(280px,1.35fr)] gap-3 overflow-x-auto pb-1">
          <section className="min-h-0">
            {isLoading ? (
              <HudPanel title="Now"><HudEmptyState label="Loading calendar" /></HudPanel>
            ) : error ? (
              <HudPanel title="Now"><HudEmptyState label="Calendar unavailable" /></HudPanel>
            ) : (
              <NowPanel
                calendarColor={currentEvent ? calendarColors.get(currentEvent.calendarId) : undefined}
                currentEvent={currentEvent}
                nextEvent={nextEvent}
                now={now}
                onOpenEvent={openCalendarEvent}
              />
            )}
          </section>

          <section className="min-h-0">
            {isLoading ? (
              <HudPanel title="Next"><HudEmptyState label="Loading calendar" /></HudPanel>
            ) : error ? (
              <HudPanel title="Next"><HudEmptyState label="Calendar unavailable" /></HudPanel>
            ) : (
              <NextPanel
                calendarColor={nextEvent ? calendarColors.get(nextEvent.calendarId) : undefined}
                event={nextEvent}
                now={now}
                onOpenEvent={openCalendarEvent}
              />
            )}
          </section>

          <section className="min-h-0">
            <HudPanel>
              {isLoading ? (
                <HudEmptyState label="Loading agenda" />
              ) : error ? (
                <HudEmptyState label="Calendar unavailable" />
              ) : agendaSections.length > 0 ? (
                <SoonList calendarColors={calendarColors} now={now} onOpenEvent={openCalendarEvent} sections={agendaSections} />
              ) : (
                <HudEmptyState label="Nothing else soon" />
              )}
            </HudPanel>
          </section>
        </div>
      </div>
      {eventPopover ? (
        <div
          ref={eventPopoverRef}
          className="hilt-hud-event-popover-wrapper fixed z-[100] w-[min(400px,calc(100vw-24px))]"
          style={{ top: eventPopover.top, left: eventPopover.left }}
        >
          <CalendarEventPopoverContent
            calendarLabel={calendarsById.get(eventPopover.event.calendarId)?.name}
            event={eventPopover.event}
            onClose={() => setEventPopover(null)}
            sourceLabel={sourcesById.get(eventPopover.event.sourceId)?.label}
          />
        </div>
      ) : null}
    </aside>
  );
}

function useLiveNow(): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  return now;
}

function NowPanel({
  calendarColor,
  currentEvent,
  nextEvent,
  now,
  onOpenEvent,
}: {
  calendarColor?: string;
  currentEvent: CalendarEvent | null;
  nextEvent: CalendarEvent | null;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
}) {
  if (currentEvent) {
    const progress = eventCompletion(currentEvent, now);
    return (
      <HudPanel color={calendarColor} title="Now" onClick={(clickEvent) => onOpenEvent(currentEvent, clickEvent.currentTarget)} ariaLabel={`Open details for ${currentEvent.title}`}>
        <EventHero event={currentEvent} now={now} status={formatRemaining(currentEvent, now) ?? "In progress"} />
        <div className="mt-auto h-1.5 overflow-hidden rounded-full bg-[var(--bg-tertiary)]">
          <div className="h-full rounded-full" style={{ width: `${progress}%`, backgroundColor: calendarColor ?? "var(--interactive-default)" }} />
        </div>
      </HudPanel>
    );
  }

  if (nextEvent) {
    return (
      <HudPanel title="Now">
        <div className="flex min-h-0 flex-1 flex-col justify-center">
          <div className="text-lg font-semibold tabular-nums text-[var(--text-primary)]">
            {formatFreeUntil(nextEvent, now)}
          </div>
          <div className="mt-1 min-w-0 truncate text-xs text-[var(--text-tertiary)]" title={nextEvent.title}>
            free until {formatEventStart(nextEvent, now)}
          </div>
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel title="Now">
      <div className="flex min-h-0 flex-1 items-center text-sm text-[var(--text-tertiary)]">Free now</div>
    </HudPanel>
  );
}

function NextPanel({
  calendarColor,
  event,
  now,
  onOpenEvent,
}: {
  calendarColor?: string;
  event: CalendarEvent | null;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
}) {
  return (
    <HudPanel
      color={calendarColor}
      title="Next"
      onClick={event ? (clickEvent) => onOpenEvent(event, clickEvent.currentTarget) : undefined}
      ariaLabel={event ? `Open details for ${event.title}` : undefined}
    >
      {event ? (
        <EventHero event={event} now={now} status={formatStartsIn(event, now)} />
      ) : (
        <HudEmptyState label="No upcoming meetings" />
      )}
    </HudPanel>
  );
}

function EventHero({
  event,
  now,
  status,
}: {
  event: CalendarEvent;
  now: Date;
  status: string;
}) {
  const details = eventDetailLines(event);
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-center">
      <div
        className="min-w-0 overflow-hidden text-base font-semibold leading-tight text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere] [text-wrap:balance]"
        title={event.title}
      >
        {event.title}
      </div>
      <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
        <span className="font-medium tabular-nums text-[var(--interactive-default)]">{status}</span>
        <span className="tabular-nums">{formatEventTime(event, now)}</span>
      </div>
      {details.length > 0 ? (
        <div className="mt-1.5 space-y-0.5 text-xs leading-snug text-[var(--text-tertiary)]">
          {details.map((line) => (
            <div
              key={line}
              className="min-w-0 overflow-hidden [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:1] [overflow-wrap:anywhere]"
              title={line}
            >
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function SoonList({
  calendarColors,
  now,
  onOpenEvent,
  sections,
}: {
  calendarColors: Map<string, string>;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
  sections: AgendaSection[];
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1" data-testid="hud-agenda-list">
      <div className="space-y-0.5">
        {sections.map((section) => (
          <section key={section.id} data-testid="hud-agenda-section">
            <AgendaHeading label={section.label} />
            <div className="space-y-0.5">
              {section.items.map((item) => {
                if (item.kind === "free") return <FreeAgendaItem item={item} key={item.id} now={now} />;
                return (
                  <EventAgendaItem
                    calendarColor={calendarColors.get(item.event.calendarId) ?? "var(--interactive-default)"}
                    event={item.event}
                    key={item.event.id}
                    now={now}
                    onOpenEvent={onOpenEvent}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function AgendaHeading({ label }: { label: string }) {
  return (
    <div
      data-testid="hud-agenda-heading"
      className="sticky top-0 z-10 bg-[var(--content-surface)] px-1.5 pb-0.5 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
    >
      {label}
    </div>
  );
}

function EventAgendaItem({
  calendarColor,
  event,
  now,
  onOpenEvent,
}: {
  calendarColor: string;
  event: CalendarEvent;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
}) {
  return (
    <button
      type="button"
      data-testid="hud-agenda-event"
      data-hud-event-trigger
      className="grid w-full grid-cols-[12px_minmax(0,1fr)_max-content] items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      title={`Open details for ${event.title}`}
      onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
    >
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: calendarColor }} />
      <span
        className="min-w-0 overflow-hidden whitespace-nowrap text-sm font-medium leading-snug text-[var(--text-primary)]"
        style={fadeEndMaskStyle}
      >
        {event.title}
      </span>
      <span className="ml-1 shrink-0 whitespace-nowrap tabular-nums text-[11px] text-[var(--text-tertiary)]">
        {formatCompactEventTime(event, now)}
      </span>
    </button>
  );
}

function FreeAgendaItem({ item, now }: { item: Extract<AgendaItem, { kind: "free" }>; now: Date }) {
  return (
    <div data-testid="hud-agenda-free" className="grid grid-cols-[12px_minmax(0,1fr)_max-content] items-center gap-2 px-1.5 py-0.5 text-xs text-[var(--text-tertiary)]">
      <span className="mx-auto h-px w-2 rounded-full bg-[var(--border-strong)]" />
      <span className="min-w-0 overflow-hidden whitespace-nowrap" style={fadeEndMaskStyle}>
        {formatFreeBlock(item.minutes)} break
      </span>
      <span className="ml-1 shrink-0 whitespace-nowrap tabular-nums text-[11px]">
        {formatCompactTimeRange(item.start, item.end, now)}
      </span>
    </div>
  );
}

function HudPanel({
  children,
  color,
  title,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  color?: string;
  title?: string;
  onClick?: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  ariaLabel?: string;
}) {
  const className = `flex h-full min-h-0 w-full flex-col rounded-lg border px-3 py-2 shadow-sm ${
    onClick ? "text-left transition hover:border-[var(--interactive-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]" : ""
  }`;
  const style = {
    background: color ? `color-mix(in oklab, ${color} 12%, var(--content-surface))` : "var(--content-surface)",
    borderColor: color ? `color-mix(in oklab, ${color} 42%, var(--border-default))` : "var(--border-default)",
  };
  const content = (
    <>
      {title ? <div className="mb-1.5 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{title}</div> : null}
      {children}
    </>
  );
  return onClick ? (
    <button type="button" className={className} style={style} onClick={onClick} aria-label={ariaLabel} data-hud-event-trigger>
      {content}
    </button>
  ) : (
    <div className={className} style={style}>
      {content}
    </div>
  );
}

function HudEmptyState({ label }: { label: string }) {
  return <div className="flex min-h-0 flex-1 items-center text-sm text-[var(--text-tertiary)]">{label}</div>;
}

function selectHudEvents(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return events
    .filter(isVisibleCalendarForegroundEvent)
    .filter((event) => event.allDay || new Date(event.end) > now)
    .sort((a, b) => a.sortStart - b.sortStart);
}

function buildSoonItems(events: CalendarEvent[], now: Date, currentEvent: CalendarEvent | null, nextEvent: CalendarEvent | null): AgendaItem[] {
  const items: AgendaItem[] = [];
  const startAfter = nextEvent ? new Date(nextEvent.end) : currentEvent ? new Date(currentEvent.end) : now;
  let cursor = startAfter;

  for (const event of events) {
    if (currentEvent && event.id === currentEvent.id) continue;
    if (nextEvent && event.id === nextEvent.id) continue;
    const eventStart = new Date(event.start);
    const eventEnd = new Date(event.end);
    if (eventEnd <= cursor) continue;
    if (eventStart < cursor) {
      items.push({ kind: "event", event });
      if (eventEnd > cursor) cursor = eventEnd;
      continue;
    }

    const freeMinutes = Math.floor((eventStart.getTime() - cursor.getTime()) / 60_000);
    if (freeMinutes >= FREE_BLOCK_MINUTES) {
      items.push({
        kind: "free",
        id: `free-${cursor.toISOString()}-${event.start}`,
        start: cursor,
        end: eventStart,
        minutes: freeMinutes,
      });
    }

    items.push({ kind: "event", event });
    cursor = eventEnd > cursor ? eventEnd : cursor;
    if (items.length >= MAX_SOON_ITEMS) break;
  }

  return items.slice(0, MAX_SOON_ITEMS);
}

function buildAgendaSections(items: AgendaItem[], now: Date): AgendaSection[] {
  const sections: AgendaSection[] = [];
  let currentDayKey: string | null = null;
  let currentSection: AgendaSection | null = null;

  for (const item of items) {
    const start = agendaItemStart(item);
    const dayKey = dateKeyInTimeZone(start);
    if (dayKey !== currentDayKey) {
      currentSection = {
        id: `section-${dayKey}`,
        items: [],
        label: agendaHeadingLabel(start, now),
      };
      sections.push(currentSection);
    }
    currentDayKey = dayKey;
    currentSection?.items.push(item);
  }

  return sections;
}

function agendaItemStart(item: AgendaItem): Date {
  return item.kind === "event" ? new Date(item.event.start) : item.start;
}

function isEventCurrent(event: CalendarEvent, now: Date): boolean {
  if (event.allDay) return false;
  const start = new Date(event.start);
  const end = new Date(event.end);
  return start <= now && end > now;
}

function formatHudDate(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatClock(date: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function formatEventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return "All day";
  return formatTimeRange(new Date(event.start), new Date(event.end), now);
}

function formatEventStart(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start);
  const prefix = formatDatePrefix(start, now);
  const time = new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(start);
  return prefix ? `${prefix} ${time}` : time;
}

function formatTimeRange(start: Date, end: Date, now: Date): string {
  const formatter = new Intl.DateTimeFormat(undefined, {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  const prefix = formatDatePrefix(start, now);
  const endPrefix = differenceInLocalDays(end, start) === 0 ? "" : formatDatePrefix(end, now);
  const startTime = prefix ? `${prefix} ${formatter.format(start)}` : formatter.format(start);
  const endTime = endPrefix ? `${endPrefix} ${formatter.format(end)}` : formatter.format(end);
  return `${startTime} - ${endTime}`;
}

function formatDatePrefix(date: Date, now: Date): string {
  const dayDifference = differenceInLocalDays(date, now);
  if (dayDifference === 0) return "";
  if (dayDifference === 1) return "Tomorrow";
  if (dayDifference > 1 && dayDifference < 7) {
    return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(date);
}

function formatCompactEventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return "all day";
  return formatCompactTimeRange(new Date(event.start), new Date(event.end), now);
}

function formatCompactTimeRange(start: Date, end: Date, now: Date, options: { includeStartDate?: boolean } = {}): string {
  const startPrefix = options.includeStartDate ? formatCompactDatePrefix(start, now) : "";
  const endPrefix = differenceInLocalDays(end, start) === 0 ? "" : formatCompactDatePrefix(end, now);
  const startParts = compactTimeParts(start);
  const endParts = compactTimeParts(end);
  const sameLocalDay = differenceInLocalDays(end, start) === 0;
  const samePeriod = sameLocalDay && startParts.period === endParts.period;
  const startTime = `${startPrefix ? `${startPrefix} ` : ""}${formatCompactTime(startParts, !samePeriod)}`;
  const endTime = `${endPrefix ? `${endPrefix} ` : ""}${formatCompactTime(endParts, true)}`;
  return `${startTime}-${endTime}`;
}

function formatCompactDatePrefix(date: Date, now: Date): string {
  const dayDifference = differenceInLocalDays(date, now);
  if (dayDifference === 0) return "";
  if (dayDifference === 1) return "Tmrw";
  if (dayDifference > 1 && dayDifference < 7) {
    return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "numeric", day: "numeric" }).format(date);
}

function agendaHeadingLabel(date: Date, now: Date): string {
  const dayDifference = differenceInLocalDays(date, now);
  if (dayDifference === 0) return "Today";
  if (dayDifference === 1) return "Tomorrow";
  if (dayDifference > 1 && dayDifference < 7) {
    return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, weekday: "short" }).format(date);
  }
  return new Intl.DateTimeFormat(undefined, { timeZone: TIME_ZONE, month: "short", day: "numeric" }).format(date);
}

function compactTimeParts(date: Date): { hour: number; minute: number; period: "a" | "p" } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "12");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const dayPeriod = parts.find((part) => part.type === "dayPeriod")?.value.toLowerCase() ?? "am";
  return { hour, minute, period: dayPeriod.startsWith("p") ? "p" : "a" };
}

function formatCompactTime(parts: { hour: number; minute: number; period: "a" | "p" }, includePeriod: boolean): string {
  const time = parts.minute ? `${parts.hour}:${String(parts.minute).padStart(2, "0")}` : String(parts.hour);
  return includePeriod ? `${time}${parts.period}` : time;
}

function dateKeyInTimeZone(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value ?? String(date.getFullYear());
  const month = parts.find((part) => part.type === "month")?.value ?? String(date.getMonth() + 1).padStart(2, "0");
  const day = parts.find((part) => part.type === "day")?.value ?? String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function eventDetailLines(event: CalendarEvent): string[] {
  return [
    formatParticipantSummary(event),
    event.location?.trim() || null,
    compactDescription(event.description),
  ].filter((line): line is string => Boolean(line)).slice(0, 2);
}

function formatParticipantSummary(event: CalendarEvent): string | null {
  const participants = event.attendees
    .map((attendee) => attendee.name?.trim() || attendee.email?.trim() || "")
    .filter(Boolean);
  if (participants.length === 0) {
    const organizer = event.organizer?.name?.trim() || event.organizer?.email?.trim();
    return organizer ? `Organizer: ${organizer}` : null;
  }
  const shown = participants.slice(0, 3).join(", ");
  const remaining = participants.length - 3;
  return remaining > 0 ? `${shown} +${remaining}` : shown;
}

function compactDescription(description: string | null): string | null {
  const text = description
    ?.replace(/<[^>]*>/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text || null;
}

function hudPopoverAnchor(target: HTMLElement): HudEventPopoverAnchor {
  const rect = target.getBoundingClientRect();
  return {
    bottom: rect.bottom,
    left: rect.left,
    top: rect.top,
    width: rect.width,
  };
}

function hudPopoverPosition(anchor: HudEventPopoverAnchor, placement: AppHudProps["placement"], measuredHeight?: number, measuredWidth?: number): { top: number; left: number } {
  const margin = 12;
  const gap = 10;
  const width = Math.min(measuredWidth || 400, window.innerWidth - margin * 2);
  const maxHeight = Math.min(520, window.innerHeight - margin * 2);
  const height = Math.min(measuredHeight || maxHeight, maxHeight);
  const anchorCenter = anchor.left + anchor.width / 2;
  const left = clamp(anchorCenter - width / 2, margin, Math.max(margin, window.innerWidth - width - margin));
  const preferredTop = placement === "bottom" ? anchor.top - height - gap : anchor.bottom + gap;
  const top = clamp(preferredTop, margin, Math.max(margin, window.innerHeight - height - margin));
  return { top: Math.round(top), left: Math.round(left) };
}

function formatRemaining(event: CalendarEvent, now: Date): string | null {
  const end = new Date(event.end).getTime();
  const milliseconds = end - now.getTime();
  if (milliseconds <= 0) return null;
  return `${formatDuration(milliseconds, { secondsBelowMinute: true })} left`;
}

function formatStartsIn(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start).getTime();
  const milliseconds = Math.max(0, start - now.getTime());
  if (milliseconds < 1000) return "starting now";
  return `in ${formatDuration(milliseconds, { secondsBelowMinute: true })}`;
}

function formatFreeUntil(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start).getTime();
  const milliseconds = Math.max(0, start - now.getTime());
  return formatDuration(milliseconds, { secondsBelowMinute: true });
}

function formatDuration(milliseconds: number, options: { secondsBelowMinute?: boolean } = {}): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (totalSeconds < 60 && options.secondsBelowMinute) return `${totalSeconds}s`;

  const totalMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatFreeBlock(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours}h ${remainder}m` : `${hours}h`;
}

function eventCompletion(event: CalendarEvent, now: Date): number {
  const start = new Date(event.start).getTime();
  const end = new Date(event.end).getTime();
  return clamp(((now.getTime() - start) / Math.max(1, end - start)) * 100, 0, 100);
}

function calendarColorMap(calendars: CalendarDefinition[]): Map<string, string> {
  return new Map(calendars.map((calendar) => [calendar.id, calendar.color]));
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function differenceInLocalDays(date: Date, reference: Date): number {
  const start = startOfLocalDay(date).getTime();
  const referenceStart = startOfLocalDay(reference).getTime();
  return Math.round((start - referenceStart) / 86_400_000);
}

function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function dateFromLocalKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
