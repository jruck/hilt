"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import {
  AlarmClock,
  CalendarClock,
  Check,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Coffee,
  Hourglass,
  Moon,
  Smile,
  Sun,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCalendarEvents, useCalendarSources } from "@/hooks/useCalendar";
import { useBridgeWeekly } from "@/hooks/useBridgeWeekly";
import { LoadingState } from "@/components/ui/LoadingState";
import { useWeatherForecast } from "@/hooks/useWeather";
import { CalendarEventActions, CalendarEventPopoverContent } from "./calendar/CalendarEventPopover";
import { prepareCalendarDescription } from "@/lib/calendar/description";
import type { CalendarEventOpenDetail } from "@/lib/calendar/deeplink";
import { displayCalendarEventTitle } from "@/lib/calendar/title";
import { buildHudAgendaItems, hudAgendaConflictPositions, selectHudNextEventGroup } from "@/lib/calendar/hud-agenda";
import type { HudAgendaConflictPosition, HudAgendaItem } from "@/lib/calendar/hud-agenda";
import type { CalendarDefinition, CalendarEvent, CalendarSource } from "@/lib/calendar/types";
import { isVisibleCalendarForegroundEvent } from "@/lib/calendar/visibility";
import type { BridgeTask } from "@/lib/types";
import type { WeatherForecastDay, WeatherIconKey } from "@/lib/weather/types";

const TIME_ZONE = "America/New_York";
const UPCOMING_LOOKAHEAD_DAYS = 7;
const FREE_BLOCK_MINUTES = 30;
const MAX_SOON_ITEMS = 28;
const COLLAPSED_HUD_HORIZON_MS = 4 * 60 * 60_000;
const HUD_MANUAL_ENDED_STORAGE_KEY = "hilt:hud:manual-ended-events:v1";
const HUD_MANUAL_STARTED_STORAGE_KEY = "hilt:hud:manual-started-events:v1";
const HUD_MANUAL_ENDED_TTL_MS = 18 * 60 * 60_000;
const HUD_MANUAL_STARTED_TTL_MS = 18 * 60 * 60_000;
const HUD_EARLY_START_WINDOW_MINUTES = 30;
const HUD_MEETING_IMMINENT_MINUTES = 5;
const HUD_MEETING_SOON_MINUTES = 30;
const HUD_HANDOFF_BREAK_MINUTES = 15;
const NEXT_COUNTDOWN_DUPLICATE_TOLERANCE_MS = 60_000;
const EMPTY_ENDED_EVENT_IDS = new Set<string>();
const EMPTY_STARTED_EVENT_IDS = new Set<string>();
const EMPTY_WEATHER_DAYS: WeatherForecastDay[] = [];
const fadeEndMaskStyle: CSSProperties = {
  WebkitMaskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
  maskImage: "linear-gradient(to right, black calc(100% - 18px), transparent)",
};

interface AppHudProps {
  onCollapse: () => void;
  onOpenCalendarEvent?: (detail: CalendarEventOpenDetail) => void;
  onOpenTask?: (taskId: string) => void;
  placement: "top" | "bottom";
  variant?: "default" | "mobile";
}

type AgendaSection = { date: string; id: string; items: HudAgendaItem[]; label: string; tasks: BridgeTask[] };
type HudEventPopoverAnchor = { top: number; bottom: number; left: number; width: number };
type HudEventPopover = {
  anchor: HudEventPopoverAnchor;
  event: CalendarEvent;
  left: number;
  top: number;
};
type EventHeroStatusTone = "default" | "handoff";
type EventHeroTimeAction = { color: string; label: string; onClick: () => void; title: string };
type HandoffGap = { start: Date; end: Date; minutes: number };
type HudEarlyStartReason = "granola" | "manual";
type HudEndedEventReason = "granola" | "manual";
type HudPanelTone = "default" | "imminent";
type NowWatermarkState = { Icon: LucideIcon; label: string };

export function AppHud({ onCollapse, onOpenCalendarEvent, onOpenTask, placement, variant = "default" }: AppHudProps) {
  const now = useLiveNow();
  const mobileLayout = variant === "mobile";
  const eventPopoverRef = useRef<HTMLDivElement>(null);
  const [eventPopover, setEventPopover] = useState<HudEventPopover | null>(null);
  const { manuallyEndedEventIds, markEventEnded } = useManualHudEndedEvents();
  const { manuallyStartedEventIds, markEventStarted } = useManualHudStartedEvents();
  const {
    agendaSections: calendarAgendaSections,
    allDayEvents,
    calendarColors,
    calendarsById,
    currentEvent,
    endedCurrentEvent,
    endedCurrentEventReason,
    error,
    isLoading,
    nextEvent,
    nextEvents,
    currentEventEarlyReason,
    sourcesById,
  } = useHudCalendarSnapshot(now, manuallyEndedEventIds, manuallyStartedEventIds);
  const hideNextCountdown = nextCountdownDuplicatesNow(currentEvent, nextEvent);
  const highlightNextTime = !currentEvent && nextEvent ? isNextEventImminent(nextEvent, now) : false;
  const handoffGap = !isLoading && !error && currentEvent && nextEvent ? currentMeetingHandoffGap(currentEvent, nextEvent) : null;
  const todayWeatherKey = dateKeyInTimeZone(now);
  const bridgeWeeklyQuery = useBridgeWeekly();
  const dueTasksByDate = useMemo(
    () => buildHudDueTasksByDate(bridgeWeeklyQuery.data?.tasks ?? [], todayWeatherKey, UPCOMING_LOOKAHEAD_DAYS),
    [bridgeWeeklyQuery.data?.tasks, todayWeatherKey]
  );
  const agendaSections = useMemo(
    () => mergeAgendaSectionsWithDueTasks(calendarAgendaSections, dueTasksByDate, now),
    [calendarAgendaSections, dueTasksByDate, now]
  );
  const weatherRange = useMemo(() => ({
    start: todayWeatherKey,
    end: addPlainDateDays(todayWeatherKey, UPCOMING_LOOKAHEAD_DAYS - 1),
  }), [todayWeatherKey]);
  const weatherQuery = useWeatherForecast(weatherRange);
  const weatherDays = weatherQuery.data?.days ?? EMPTY_WEATHER_DAYS;
  const weatherByDate = useMemo(() => new Map(weatherDays.map((day) => [day.date, day])), [weatherDays]);
  const todayWeather = weatherByDate.get(todayWeatherKey) ?? null;
  const openCalendarEvent = useCallback((event: CalendarEvent, target: HTMLElement) => {
    const anchor = hudPopoverAnchor(target);
    const position = hudPopoverPosition(anchor, placement);
    setEventPopover({ anchor, event, ...position });
  }, [placement]);
  const openEventInCalendar = useCallback((event: CalendarEvent) => {
    setEventPopover(null);
    onOpenCalendarEvent?.({
      id: event.id,
      date: dateKeyInTimeZone(new Date(event.start)),
    });
  }, [onOpenCalendarEvent]);
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
        mobileLayout
          ? "h-[164px] min-h-[164px] max-h-[164px] overflow-hidden border-b border-[var(--border-default)]"
          : placement === "top"
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
      <div className={`${mobileLayout ? "gap-2 px-3 py-2" : "gap-2 px-4 py-3 sm:px-5"} flex h-full min-h-0 flex-col`}>
        <div className="flex shrink-0 items-center justify-between gap-3">
          {mobileLayout ? (
            <button
              type="button"
              className="flex min-w-0 cursor-n-resize items-center gap-2 rounded-md px-1 py-0.5 text-left active:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
              onClick={onCollapse}
              title="Hide HUD"
              aria-label="Hide HUD"
            >
              <CalendarClock className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              <div className="min-w-0 truncate text-sm font-semibold">{formatHudDate(now)}</div>
              <HudTodayWeather forecast={todayWeather} />
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-2">
              <CalendarClock className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
              <div className="min-w-0 truncate text-sm font-semibold">{formatHudDate(now)}</div>
              <HudTodayWeather forecast={todayWeather} />
            </div>
          )}
          <div className="flex min-w-0 shrink items-center justify-end gap-1.5">
            {allDayEvents.map((event) => {
              const displayTitle = displayCalendarEventTitle(event.title);
              return (
                <button
                  type="button"
                  key={event.id}
                  className={`${mobileLayout ? "hidden" : "hidden sm:inline"} max-w-[150px] truncate rounded-full bg-[var(--bg-secondary)] px-2 py-0.5 text-left text-[11px] text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)]`}
                  title={`Open details for ${displayTitle}`}
                  data-hud-event-trigger
                  onClick={(clickEvent) => openCalendarEvent(event, clickEvent.currentTarget)}
                >
                  {displayTitle}
                </button>
              );
            })}
            <span className="shrink-0 tabular-nums text-sm font-medium text-[var(--text-secondary)]">
              {formatClock(now)}
            </span>
          </div>
        </div>

        <div
          className={
            mobileLayout
              ? handoffGap
                ? "grid min-h-0 flex-1 grid-cols-[minmax(160px,48vw)_48px_minmax(180px,54vw)_minmax(260px,78vw)] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-2 pt-1"
                : "grid min-h-0 flex-1 grid-cols-[minmax(160px,48vw)_minmax(180px,54vw)_minmax(260px,78vw)] gap-2 overflow-x-auto overflow-y-hidden overscroll-x-contain px-1 pb-2 pt-1"
              : handoffGap
                ? "grid min-h-0 flex-1 grid-cols-[minmax(190px,0.9fr)_56px_minmax(220px,1fr)_minmax(280px,1.35fr)] gap-3 overflow-x-auto px-0 pb-0 pt-0"
                : "grid min-h-0 flex-1 grid-cols-[minmax(190px,0.9fr)_minmax(220px,1fr)_minmax(280px,1.35fr)] gap-3 overflow-x-auto px-0 pb-0 pt-0"
          }
        >
          <section className="min-h-0 min-w-0">
            {isLoading ? (
              <HudPanel compact={mobileLayout} title="Now"><HudEmptyState label="Loading calendar" loading /></HudPanel>
            ) : error ? (
              <HudPanel compact={mobileLayout} title="Now"><HudEmptyState label="Calendar unavailable" /></HudPanel>
            ) : (
              <NowPanel
                calendarColor={currentEvent ? calendarColors.get(currentEvent.calendarId) : undefined}
                compact={mobileLayout}
                currentEvent={currentEvent}
                currentEventEarlyReason={currentEventEarlyReason}
                endedCurrentEvent={endedCurrentEvent}
                endedCurrentEventReason={endedCurrentEventReason}
                nextEvent={nextEvent}
                now={now}
                onEndCurrentEvent={markEventEnded}
                onOpenEvent={openCalendarEvent}
                showActions={!mobileLayout}
                sourceLabel={currentEvent ? sourcesById.get(currentEvent.sourceId)?.label : undefined}
              />
            )}
          </section>

          {handoffGap ? <HandoffGapMarker compact={mobileLayout} gap={handoffGap} now={now} /> : null}

          <section className="min-h-0 min-w-0">
            {isLoading ? (
              <HudPanel compact={mobileLayout} title="Next"><HudEmptyState label="Loading calendar" loading /></HudPanel>
            ) : error ? (
              <HudPanel compact={mobileLayout} title="Next"><HudEmptyState label="Calendar unavailable" /></HudPanel>
            ) : (
              <NextPanel
                compact={mobileLayout}
                calendarColors={calendarColors}
                events={nextEvents}
                highlightTime={highlightNextTime}
                now={now}
                onOpenEvent={openCalendarEvent}
                onStartEventEarly={markEventStarted}
                showActions={!mobileLayout}
                showCountdown={!hideNextCountdown}
                sourcesById={sourcesById}
              />
            )}
          </section>

          <section className="min-h-0 min-w-0">
            <HudPanel compact={mobileLayout}>
              {isLoading ? (
                <HudEmptyState label="Loading agenda" loading />
              ) : error ? (
                <HudEmptyState label="Calendar unavailable" />
              ) : agendaSections.length > 0 ? (
                <SoonList
                  calendarColors={calendarColors}
                  compact={mobileLayout}
                  now={now}
                  onOpenEvent={openCalendarEvent}
                  onOpenTask={onOpenTask}
                  sections={agendaSections}
                  weatherByDate={weatherByDate}
                />
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
            calendarColor={calendarColors.get(eventPopover.event.calendarId)}
            calendarLabel={calendarsById.get(eventPopover.event.calendarId)?.name}
            event={eventPopover.event}
            onClose={() => setEventPopover(null)}
            onTitleClick={onOpenCalendarEvent ? openEventInCalendar : undefined}
            sourceLabel={sourcesById.get(eventPopover.event.sourceId)?.label}
          />
        </div>
      ) : null}
    </aside>
  );
}

export function AppHudCollapsedBar({ onExpand }: { onExpand: () => void }) {
  const now = useLiveNow();
  const { manuallyEndedEventIds } = useManualHudEndedEvents();
  const { manuallyStartedEventIds } = useManualHudStartedEvents();
  const {
    calendarColors,
    currentEventEarlyReason,
    currentEvent,
    error,
    isLoading,
    nextEvent,
  } = useHudCalendarSnapshot(now, manuallyEndedEventIds, manuallyStartedEventIds);
  const event = currentEvent ?? nextEvent;
  const displayTitle = event ? displayCalendarEventTitle(event.title) : "";
  const color = event ? calendarColors.get(event.calendarId) ?? "var(--interactive-default)" : "var(--border-strong)";
  const trackStyle = event ? hudProgressTrackStyle(color) : undefined;
  const progress = collapsedHudProgress(currentEvent, nextEvent, now);
  const marker = clamp(progress, 3, 97);
  const primary = collapsedHudPrimary(currentEvent, nextEvent, now, { currentEventEarlyReason, error: Boolean(error), isLoading });
  const secondary = isLoading
    ? "Calendar"
    : error
      ? "Tap to expand"
      : displayTitle || "No upcoming meetings";

  return (
    <button
      type="button"
      aria-label="Show HUD"
      className="grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_80px] items-center gap-3 border-b border-[var(--border-default)] bg-[var(--bg-primary)] px-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--interactive-default)]"
      data-testid="app-hud-collapsed"
      onClick={onExpand}
      title="Show HUD"
    >
      <span className="flex min-w-0 items-baseline gap-2">
        <span className="shrink-0 text-xs font-semibold tabular-nums text-[var(--text-primary)]">{primary}</span>
        <span className="min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">{secondary}</span>
      </span>
      <span className="relative h-1.5 min-w-0 overflow-hidden rounded-full bg-[var(--bg-tertiary)]" style={trackStyle} aria-hidden="true">
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${progress}%`, backgroundColor: color }}
        />
        <span
          className="absolute top-1/2 h-3 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ left: `${marker}%`, backgroundColor: color }}
        />
      </span>
    </button>
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

function useManualHudEndedEvents() {
  const [manuallyEndedEvents, setManuallyEndedEvents] = useState<Record<string, number>>(() => readManualHudEndedEvents());
  const manuallyEndedEventIds = useMemo(() => new Set(Object.keys(manuallyEndedEvents)), [manuallyEndedEvents]);

  useEffect(() => {
    writeManualHudEndedEvents(manuallyEndedEvents);
  }, [manuallyEndedEvents]);

  const markEventEnded = useCallback((event: CalendarEvent) => {
    setManuallyEndedEvents((current) => pruneManualHudEndedEvents({
      ...current,
      [event.id]: Date.now(),
    }));
  }, []);

  return { manuallyEndedEventIds, markEventEnded };
}

function useManualHudStartedEvents() {
  const [manuallyStartedEvents, setManuallyStartedEvents] = useState<Record<string, number>>(() => readManualHudStartedEvents());
  const manuallyStartedEventIds = useMemo(() => new Set(Object.keys(manuallyStartedEvents)), [manuallyStartedEvents]);

  useEffect(() => {
    writeManualHudStartedEvents(manuallyStartedEvents);
  }, [manuallyStartedEvents]);

  const markEventStarted = useCallback((event: CalendarEvent) => {
    setManuallyStartedEvents((current) => pruneManualHudStartedEvents({
      ...current,
      [event.id]: Date.now(),
    }));
  }, []);

  return { manuallyStartedEventIds, markEventStarted };
}

function useHudCalendarSnapshot(
  now: Date,
  manuallyEndedEventIds: Set<string> = EMPTY_ENDED_EVENT_IDS,
  manuallyStartedEventIds: Set<string> = EMPTY_STARTED_EVENT_IDS,
) {
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
  const scheduledCurrentEvent = timedEvents.find((event) => isEventCurrent(event, now) && !hudEndedEventReason(event, now, manuallyEndedEventIds)) ?? null;
  const earlyCurrentEvent = scheduledCurrentEvent
    ? null
    : timedEvents.find((event) => hudEarlyStartReason(event, now, manuallyStartedEventIds, manuallyEndedEventIds)) ?? null;
  const currentEvent = scheduledCurrentEvent ?? earlyCurrentEvent;
  const currentEventEarlyReason = earlyCurrentEvent
    ? hudEarlyStartReason(earlyCurrentEvent, now, manuallyStartedEventIds, manuallyEndedEventIds)
    : null;
  const endedCurrentEvent = timedEvents.find((event) => isEventCurrent(event, now) && hudEndedEventReason(event, now, manuallyEndedEventIds)) ?? null;
  const endedCurrentEventReason = endedCurrentEvent ? hudEndedEventReason(endedCurrentEvent, now, manuallyEndedEventIds) : null;
  const activeTimedEvents = useMemo(
    () => timedEvents.filter((event) => !hudEndedEventReason(event, now, manuallyEndedEventIds)),
    [manuallyEndedEventIds, now, timedEvents],
  );
  const nextEvents = useMemo(() => selectHudNextEventGroup(activeTimedEvents, currentEvent, now), [activeTimedEvents, currentEvent, now]);
  const nextEvent = nextEvents[0] ?? null;
  const soonItems = useMemo(() => buildHudAgendaItems(activeTimedEvents, now, currentEvent, {
    freeBlockMinutes: FREE_BLOCK_MINUTES,
    maxItems: MAX_SOON_ITEMS,
  }), [activeTimedEvents, currentEvent, now]);
  const agendaSections = useMemo(() => buildAgendaSections(soonItems, now), [now, soonItems]);
  const allDayEvents = visibleEvents
    .filter((event) => allDayEventOccursOnDate(event, dateKeyInTimeZone(now)))
    .slice(0, 3);

  return {
    agendaSections,
    allDayEvents,
    calendarColors,
    calendarsById,
    currentEvent,
    currentEventEarlyReason,
    endedCurrentEvent,
    endedCurrentEventReason,
    error,
    isLoading,
    nextEvent,
    nextEvents,
    sourcesById,
  };
}

function NowPanel({
  calendarColor,
  compact = false,
  currentEvent,
  currentEventEarlyReason,
  endedCurrentEvent,
  endedCurrentEventReason,
  nextEvent,
  now,
  onEndCurrentEvent,
  onOpenEvent,
  showActions = true,
  sourceLabel,
}: {
  calendarColor?: string;
  compact?: boolean;
  currentEvent: CalendarEvent | null;
  currentEventEarlyReason?: HudEarlyStartReason | null;
  endedCurrentEvent?: CalendarEvent | null;
  endedCurrentEventReason?: HudEndedEventReason | null;
  nextEvent: CalendarEvent | null;
  now: Date;
  onEndCurrentEvent?: (event: CalendarEvent) => void;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
  showActions?: boolean;
  sourceLabel?: string | null;
}) {
  if (currentEvent) {
    const progress = eventCompletion(currentEvent, now);
    const progressColor = calendarColor ?? "var(--interactive-default)";
    const displayTitle = displayCalendarEventTitle(currentEvent.title);
    const canEndCurrentEvent = showActions && Boolean(onEndCurrentEvent);
    const statusTone = currentEventEarlyReason || (nextEvent && isCurrentMeetingHandoffImminent(currentEvent, nextEvent, now)) ? "handoff" : "default";
    const status = currentEventEarlyReason
      ? formatEarlyStartStatus(currentEventEarlyReason)
      : formatRemaining(currentEvent, now) ?? "In progress";
    return (
      <HudPanel compact={compact} color={calendarColor} title="Now" onClick={(target) => onOpenEvent(currentEvent, target)} ariaLabel={`Open details for ${displayTitle}`}>
        <EventHero
          calendarColor={calendarColor}
          compact={compact}
          event={currentEvent}
          now={now}
          showActions={showActions}
          showDetails={!canEndCurrentEvent}
          sourceLabel={sourceLabel}
          status={status}
          statusTone={statusTone}
        />
        <CurrentEventProgress
          color={progressColor}
          onEnd={canEndCurrentEvent && onEndCurrentEvent ? () => onEndCurrentEvent(currentEvent) : undefined}
          progress={progress}
        />
      </HudPanel>
    );
  }

  if (nextEvent) {
    const wrappedCopy = endedCurrentEvent ? `${formatEndedCurrentEventReason(endedCurrentEventReason)} · ` : "";
    const watermark = nowWatermark(nextEvent, now);
    const imminent = isNextEventImminent(nextEvent, now);
    const upcomingStatus = imminent
      ? `meeting starts at ${formatCompactEventStart(nextEvent, now)}`
      : `free until ${formatCompactEventStart(nextEvent, now)}`;
    const displayTitle = displayCalendarEventTitle(nextEvent.title);
    return (
      <HudPanel compact={compact} title="Now" tone={imminent ? "imminent" : "default"}>
        <div className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
          <NowWatermark compact={compact} watermark={watermark} />
          <div className={`relative z-10 min-w-0 ${compact ? "" : "pr-24"}`}>
            <div className={`${compact ? "text-base" : imminent ? "text-xl" : "text-lg"} font-semibold tabular-nums text-[var(--text-primary)]`}>
              {formatFreeUntil(nextEvent, now)}
            </div>
            <div className={`mt-1 min-w-0 truncate ${compact ? "text-[11px]" : "text-xs"} text-[var(--text-tertiary)]`} title={displayTitle}>
              {wrappedCopy}{upcomingStatus}
            </div>
          </div>
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel compact={compact} title="Now">
      <div className="relative flex min-h-0 flex-1 flex-col justify-center overflow-hidden">
        <NowWatermark compact={compact} watermark={nowWatermark(null, now)} />
        <div className={`relative z-10 min-w-0 ${compact ? "" : "pr-24"}`}>
          <div className="text-sm text-[var(--text-tertiary)]">Free now</div>
          {endedCurrentEvent ? (
            <div className="mt-1 truncate text-xs text-[var(--text-tertiary)]">{formatEndedCurrentEventReason(endedCurrentEventReason)}</div>
          ) : null}
        </div>
      </div>
    </HudPanel>
  );
}

function HandoffGapMarker({ compact, gap, now }: { compact?: boolean; gap: HandoffGap; now: Date }) {
  const label = `${formatFreeBlock(gap.minutes)} break`;
  const range = formatCompactTimeRange(gap.start, gap.end, now);
  return (
    <div
      className={`flex min-h-0 min-w-0 items-center justify-center self-stretch text-center ${
        compact ? "px-0" : "px-0.5"
      }`}
      aria-label={`${label} between meetings`}
      title={`${label} · ${range}`}
    >
      <div className="flex min-w-0 flex-col items-center justify-center text-[var(--text-tertiary)]">
        <span className={`${compact ? "w-6" : "w-9"} h-px rounded-full bg-[var(--border-strong)]`} aria-hidden="true" />
        <span className="mt-1.5 whitespace-nowrap text-xs tabular-nums text-[var(--text-tertiary)]">
          {formatFreeBlock(gap.minutes)}
        </span>
        <span className="whitespace-nowrap text-xs text-[var(--text-tertiary)]">
          break
        </span>
      </div>
    </div>
  );
}

function NowWatermark({ compact, watermark }: { compact?: boolean; watermark: NowWatermarkState }) {
  const Icon = watermark.Icon;
  const watermarkStyle = {
    color: "var(--hud-watermark, var(--text-tertiary))",
    opacity: "var(--hud-watermark-opacity, 0.12)",
  } as CSSProperties;
  return (
    <Icon
      aria-hidden="true"
      className={`pointer-events-none absolute right-1 z-0 ${
        compact ? "top-2 h-6 w-6" : "top-1/2 h-20 w-20 -translate-y-1/2"
      }`}
      style={watermarkStyle}
    />
  );
}

function CurrentEventProgress({
  color,
  onEnd,
  progress,
}: {
  color: string;
  onEnd?: () => void;
  progress: number;
}) {
  const progressStyle = { "--hud-progress": `${progress}%` } as CSSProperties;
  if (!onEnd) {
    return (
      <div className="mt-auto h-3">
        <div className="h-3 w-full overflow-hidden rounded-md bg-[var(--bg-tertiary)]" style={hudProgressTrackStyle(color)}>
          <div className="h-full rounded-md" style={{ width: `${progress}%`, backgroundColor: color }} />
        </div>
      </div>
    );
  }

  return (
    <div className="relative mt-auto h-10 overflow-visible">
      <button
        type="button"
        className="group/end absolute inset-x-0 bottom-0 h-3 overflow-hidden rounded-md text-left transition-[height] duration-200 ease-out hover:h-8 focus:h-8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
        style={progressStyle}
        title="Treat this meeting as ended"
        onClick={(clickEvent) => {
          clickEvent.preventDefault();
          clickEvent.stopPropagation();
          onEnd();
        }}
        onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
      >
        <span
          className="absolute inset-x-0 bottom-0 h-full overflow-hidden rounded-md"
          style={hudProgressTrackStyle(color)}
          aria-hidden="true"
        >
          <span
            className="block h-full w-[var(--hud-progress)] rounded-md transition-[width] duration-300 ease-out group-hover/end:w-full group-focus/end:w-full"
            style={{ backgroundColor: color }}
          />
        </span>
        <span className="relative z-10 flex h-full w-full translate-y-1 items-center justify-center gap-1.5 px-2 text-xs font-semibold text-[var(--text-inverted)] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/end:translate-y-0 group-hover/end:opacity-100 group-focus/end:translate-y-0 group-focus/end:opacity-100">
          <Check className="h-3.5 w-3.5" />
          End meeting
        </span>
      </button>
    </div>
  );
}

function NextPanel({
  calendarColors,
  compact = false,
  events,
  highlightTime = false,
  now,
  onOpenEvent,
  onStartEventEarly,
  showActions = true,
  showCountdown = true,
  sourcesById,
}: {
  calendarColors: Map<string, string>;
  compact?: boolean;
  events: CalendarEvent[];
  highlightTime?: boolean;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
  onStartEventEarly?: (event: CalendarEvent) => void;
  showActions?: boolean;
  showCountdown?: boolean;
  sourcesById: Map<string, CalendarSource>;
}) {
  const event = events[0] ?? null;
  const calendarColor = event ? calendarColors.get(event.calendarId) : undefined;
  const displayTitle = event ? displayCalendarEventTitle(event.title) : "";
  const canStartEarly = Boolean(event && showActions && onStartEventEarly && canStartEventEarly(event, now));
  const nextTimeClassName = highlightTime
    ? "min-w-0 truncate font-medium tabular-nums text-[var(--interactive-default)]"
    : "min-w-0 truncate tabular-nums";
  const nextTimeStyle: CSSProperties | undefined = highlightTime && calendarColor ? { color: calendarColor } : undefined;

  if (events.length > 1) {
    return (
      <HudPanel compact={compact} title="Next">
        <div className="flex min-h-0 flex-1 flex-col justify-center gap-1.5 overflow-hidden">
          <div className="flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--text-secondary)]">
            {showCountdown && event ? (
              <span className="font-medium tabular-nums text-[var(--interactive-default)]">
                {formatStartsIn(event, now)}
              </span>
            ) : null}
            {event ? <span className={nextTimeClassName} style={nextTimeStyle}>{formatCompactEventStart(event, now)}</span> : null}
            <span className="shrink-0 text-[11px] text-[var(--text-tertiary)]">{events.length} choices</span>
          </div>
          <div className="grid min-h-0 flex-1 gap-1.5" style={{ gridTemplateColumns: `repeat(${events.length}, minmax(0, 1fr))` }}>
            {events.map((forkEvent) => (
              <NextForkOption
                calendarColor={calendarColors.get(forkEvent.calendarId) ?? "var(--interactive-default)"}
                event={forkEvent}
                key={forkEvent.id}
                now={now}
                onOpenEvent={onOpenEvent}
                sourceLabel={sourcesById.get(forkEvent.sourceId)?.label}
              />
            ))}
          </div>
        </div>
      </HudPanel>
    );
  }

  return (
    <HudPanel
      compact={compact}
      color={calendarColor}
      title="Next"
      onClick={event ? (target) => onOpenEvent(event, target) : undefined}
      ariaLabel={event ? `Open details for ${displayTitle}` : undefined}
    >
      {event ? (
        <>
          <EventHero
            calendarColor={calendarColor}
            compact={compact}
            event={event}
            now={now}
            showActions={showActions}
            highlightTime={highlightTime}
            sourceLabel={sourcesById.get(event.sourceId)?.label}
            status={showCountdown ? formatStartsIn(event, now) : null}
            timeAction={canStartEarly && onStartEventEarly ? {
              color: calendarColor ?? "var(--interactive-default)",
              label: "Start early",
              onClick: () => onStartEventEarly(event),
              title: "Treat this meeting as started early",
            } : undefined}
          />
        </>
      ) : (
        <HudEmptyState label="No upcoming meetings" />
      )}
    </HudPanel>
  );
}

function NextForkOption({
  calendarColor,
  event,
  now,
  onOpenEvent,
  sourceLabel,
}: {
  calendarColor: string;
  event: CalendarEvent;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
  sourceLabel?: string | null;
}) {
  const detail = [formatCompactEventTime(event, now), sourceLabel].filter(Boolean).join(" · ");
  const displayTitle = displayCalendarEventTitle(event.title);
  const style = {
    background: `color-mix(in oklab, ${calendarColor} 11%, var(--content-surface))`,
    borderColor: `color-mix(in oklab, ${calendarColor} 45%, var(--border-default))`,
  };
  return (
    <button
      type="button"
      data-hud-event-trigger
      className="flex min-h-0 min-w-0 flex-col justify-center overflow-hidden rounded-md border px-2 py-1 text-left transition hover:border-[var(--interactive-default)] hover:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      style={style}
      title={`Open details for ${displayTitle}`}
      onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
    >
      <span className="mb-1 h-1 w-7 shrink-0 rounded-full" style={{ backgroundColor: calendarColor }} />
      <span className="min-w-0 overflow-hidden text-xs font-semibold leading-tight text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere]">
        {displayTitle}
      </span>
      {detail ? (
        <span className="mt-0.5 min-w-0 truncate text-[11px] text-[var(--text-tertiary)]">
          {detail}
        </span>
      ) : null}
    </button>
  );
}

function EventHero({
  calendarColor,
  compact = false,
  event,
  highlightTime = false,
  now,
  showActions = true,
  showDetails = true,
  sourceLabel,
  status,
  statusTone = "default",
  timeAction,
}: {
  calendarColor?: string;
  compact?: boolean;
  event: CalendarEvent;
  highlightTime?: boolean;
  now: Date;
  showActions?: boolean;
  showDetails?: boolean;
  sourceLabel?: string | null;
  status?: string | null;
  statusTone?: EventHeroStatusTone;
  timeAction?: EventHeroTimeAction;
}) {
  const details = compact || !showDetails ? [] : eventDetailLines(event);
  const displayTitle = displayCalendarEventTitle(event.title);
  const statusStyle: CSSProperties | undefined = statusTone === "handoff" ? undefined : calendarColor ? { color: calendarColor } : undefined;
  const statusClassName = statusTone === "handoff"
    ? "inline-flex h-6 shrink-0 items-center rounded-full bg-[var(--text-primary)] px-2.5 text-[11px] font-semibold tabular-nums text-[var(--content-surface)] shadow-sm"
    : "font-medium tabular-nums text-[var(--interactive-default)]";
  const timeClassName = highlightTime
    ? "min-w-0 truncate font-medium tabular-nums text-[var(--interactive-default)]"
    : "min-w-0 truncate tabular-nums";
  const timeStyle: CSSProperties | undefined = highlightTime && calendarColor ? { color: calendarColor } : undefined;
  return (
    <div className="relative z-10 flex min-h-0 flex-1 flex-col justify-center overflow-hidden" style={{ justifyContent: "safe center" }}>
      <div
        className={`${compact ? "text-sm leading-snug" : "text-base leading-tight"} min-w-0 shrink-0 overflow-hidden font-semibold text-[var(--text-primary)] [display:-webkit-box] [-webkit-box-orient:vertical] [-webkit-line-clamp:2] [overflow-wrap:anywhere] [text-wrap:balance]`}
        title={displayTitle}
      >
        {displayTitle}
      </div>
      <div className="mt-1.5 flex min-w-0 shrink-0 flex-nowrap items-center gap-2 overflow-hidden whitespace-nowrap text-xs text-[var(--text-secondary)]">
        {status ? (
          <span className={statusClassName} style={statusStyle}>
            {status}
          </span>
        ) : null}
        {timeAction ? (
          <EventHeroTimeActionButton
            action={timeAction}
            idleClassName={highlightTime ? "font-medium text-[var(--interactive-default)]" : ""}
            style={timeStyle}
            time={formatHeroEventTime(event, now)}
          />
        ) : (
          <span className={timeClassName} style={timeStyle}>{formatHeroEventTime(event, now)}</span>
        )}
      </div>
      {showActions ? (
        <CalendarEventActions
          accentColor={calendarColor}
          className="mt-3"
          event={event}
          sourceLabel={sourceLabel}
          stopPropagation
          variant="compact"
        />
      ) : null}
      {details.length > 0 ? (
        <div className={`${showActions ? "mt-1" : "mt-3"} min-h-0 overflow-hidden space-y-0.5 text-xs leading-snug text-[var(--text-tertiary)]`}>
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

function EventHeroTimeActionButton({
  action,
  idleClassName,
  style,
  time,
}: {
  action: EventHeroTimeAction;
  idleClassName?: string;
  style?: CSSProperties;
  time: string;
}) {
  const actionStyle = { ...style, "--hud-time-action-color": action.color } as CSSProperties;
  return (
    <button
      type="button"
      aria-label={action.title}
      className="group/time-action relative inline-flex h-6 min-w-[82px] shrink-0 items-center justify-center overflow-hidden rounded-full border border-transparent px-2 text-xs tabular-nums text-[var(--text-secondary)] transition-colors hover:border-[var(--hud-time-action-color)] focus:border-[var(--hud-time-action-color)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      style={actionStyle}
      title={action.title}
      onClick={(clickEvent) => {
        clickEvent.preventDefault();
        clickEvent.stopPropagation();
        action.onClick();
      }}
      onKeyDown={(keyEvent) => keyEvent.stopPropagation()}
    >
      <span className={`min-w-0 truncate transition-opacity duration-150 ease-out group-hover/time-action:opacity-0 group-focus/time-action:opacity-0 ${idleClassName ?? ""}`}>
        {time}
      </span>
      <span className="absolute inset-0 flex translate-y-0.5 items-center justify-center gap-1.5 rounded-full bg-[var(--hud-time-action-color)] px-2 font-semibold text-[var(--text-inverted)] opacity-0 transition-[opacity,transform] duration-150 ease-out group-hover/time-action:translate-y-0 group-hover/time-action:opacity-100 group-focus/time-action:translate-y-0 group-focus/time-action:opacity-100">
        <AlarmClock className="h-3.5 w-3.5" />
        {action.label}
      </span>
    </button>
  );
}

function SoonList({
  calendarColors,
  compact = false,
  now,
  onOpenEvent,
  onOpenTask,
  sections,
  weatherByDate,
}: {
  calendarColors: Map<string, string>;
  compact?: boolean;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
  onOpenTask?: (taskId: string) => void;
  sections: AgendaSection[];
  weatherByDate: Map<string, WeatherForecastDay>;
}) {
  const conflictPositionsBySection = useMemo(() => new Map(
    sections.map((section) => [section.id, hudAgendaConflictPositions(section.items)]),
  ), [sections]);
  const listClassName = compact
    ? "min-h-0 flex-1 overflow-x-hidden overflow-y-auto pr-0.5"
    : "-ml-3 min-h-0 flex-1 overflow-x-hidden overflow-y-auto pl-3 pr-1";

  return (
    <div className={listClassName} data-testid="hud-agenda-list">
      <div className="space-y-0.5">
        {sections.map((section) => (
          <section key={section.id} data-testid="hud-agenda-section">
            <AgendaHeading compact={compact} forecast={weatherByDate.get(section.date) ?? null} label={section.label} />
            <div className="space-y-0.5">
              {section.tasks.map((task) => (
                <TaskAgendaItem key={task.id} now={now} onOpenTask={onOpenTask} task={task} />
              ))}
              {section.items.map((item) => {
                if (item.kind === "free") return <FreeAgendaItem item={item} key={item.id} now={now} />;
                const conflictPosition = conflictPositionsBySection.get(section.id)?.get(item.event.id);
                return (
                  <EventAgendaItem
                    calendarColor={calendarColors.get(item.event.calendarId) ?? "var(--interactive-default)"}
                    conflictPosition={conflictPosition}
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

function TaskAgendaItem({ now, onOpenTask, task }: { now: Date; onOpenTask?: (taskId: string) => void; task: BridgeTask }) {
  const overdue = isTaskOverdue(task, now);
  const badgeClassName = overdue
    ? "bg-red-500/15 text-red-500"
    : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]";
  return (
    <button
      type="button"
      data-testid="hud-agenda-task"
      className="grid w-full grid-cols-[12px_minmax(0,1fr)_max-content] items-center gap-2 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-tertiary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      title={`Open task ${task.title}`}
      onClick={() => onOpenTask?.(task.id)}
    >
      <span className="relative -left-px mx-auto h-2.5 w-2.5 rounded-[3px] border border-[var(--interactive-default)] bg-[var(--content-surface)]" />
      <span className="min-w-0 overflow-hidden whitespace-nowrap text-sm font-medium leading-snug text-[var(--text-primary)]" style={fadeEndMaskStyle}>
        {task.title}
      </span>
      <span className={`ml-1 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase leading-none tracking-wide ${badgeClassName}`}>
        task
      </span>
    </button>
  );
}

function AgendaHeading({ compact = false, forecast, label }: { compact?: boolean; forecast?: WeatherForecastDay | null; label: string }) {
  const className = compact
    ? "relative z-0 flex items-center justify-between gap-2 bg-[var(--content-surface)] px-1.5 pb-1 pt-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
    : "sticky top-0 z-30 -ml-3 -mr-1 flex items-center justify-between gap-2 bg-[var(--content-surface)] pb-1.5 pl-[18px] pr-[10px] pt-0 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] before:absolute before:-top-2 before:left-0 before:right-0 before:h-2 before:bg-[var(--content-surface)] before:content-['']";
  return (
    <div
      data-testid="hud-agenda-heading"
      className={className}
    >
      <span>{label}</span>
      {forecast ? <HudWeatherIcon className="h-3.5 w-3.5 opacity-75" forecast={forecast} /> : null}
    </div>
  );
}

function HudTodayWeather({ forecast }: { forecast?: WeatherForecastDay | null }) {
  if (!forecast) return null;
  const high = Math.round(forecast.highF);
  const low = Math.round(forecast.lowF);
  return (
    <span
      className="flex shrink-0 items-center gap-1 rounded-full bg-[var(--bg-secondary)] px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-[var(--text-secondary)]"
      title={`${forecast.condition}, high ${high}\u00b0, low ${low}\u00b0`}
      aria-label={`${forecast.condition}, high ${high}\u00b0, low ${low}\u00b0`}
    >
      <HudWeatherIcon className="h-3.5 w-3.5" forecast={forecast} />
      <span>{high}&deg;/{low}&deg;</span>
    </span>
  );
}

function HudWeatherIcon({ className, forecast }: { className: string; forecast: WeatherForecastDay }) {
  return (
    <span className="hilt-hud-weather" data-weather-icon={forecast.icon} title={forecast.condition} aria-label={forecast.condition}>
      <WeatherConditionIcon className={`${className} hilt-hud-weather-icon`} icon={forecast.icon} />
    </span>
  );
}

function WeatherConditionIcon({ className, icon }: { className: string; icon: WeatherIconKey }) {
  if (icon === "sun") return <Sun className={className} aria-hidden="true" />;
  if (icon === "cloud-sun") return <CloudSun className={className} aria-hidden="true" />;
  if (icon === "fog") return <CloudFog className={className} aria-hidden="true" />;
  if (icon === "drizzle") return <CloudDrizzle className={className} aria-hidden="true" />;
  if (icon === "rain") return <CloudRain className={className} aria-hidden="true" />;
  if (icon === "snow") return <CloudSnow className={className} aria-hidden="true" />;
  if (icon === "storm") return <CloudLightning className={className} aria-hidden="true" />;
  return <Cloud className={className} aria-hidden="true" />;
}

function EventAgendaItem({
  calendarColor,
  conflictPosition,
  event,
  now,
  onOpenEvent,
}: {
  calendarColor: string;
  conflictPosition?: HudAgendaConflictPosition;
  event: CalendarEvent;
  now: Date;
  onOpenEvent: (event: CalendarEvent, target: HTMLElement) => void;
}) {
  const displayTitle = displayCalendarEventTitle(event.title);
  return (
    <button
      type="button"
      data-testid="hud-agenda-event"
      data-hud-event-trigger
      className="relative grid w-full grid-cols-[12px_minmax(0,1fr)_max-content] items-center gap-2 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-[var(--bg-secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]"
      title={`Open details for ${displayTitle}`}
      onClick={(clickEvent) => onOpenEvent(event, clickEvent.currentTarget)}
    >
      <span className="relative mx-auto h-2.5 w-2.5 rounded-full" style={{ backgroundColor: calendarColor }} />
      <span
        className="min-w-0 overflow-hidden whitespace-nowrap text-sm font-medium leading-snug text-[var(--text-primary)]"
        style={fadeEndMaskStyle}
      >
        {displayTitle}
      </span>
      <span className="ml-1 shrink-0 whitespace-nowrap tabular-nums text-[11px] text-[var(--text-tertiary)]">
        {formatCompactEventTime(event, now)}
      </span>
      {conflictPosition ? <AgendaConflictRail position={conflictPosition} /> : null}
    </button>
  );
}

function AgendaConflictRail({ position }: { position: HudAgendaConflictPosition }) {
  return <span aria-hidden="true" className={agendaConflictRailClass(position)} data-testid="hud-agenda-conflict-rail" />;
}

function agendaConflictRailClass(position: HudAgendaConflictPosition): string {
  const base = "pointer-events-none absolute left-[-12px] z-10 w-[3px] bg-amber-500/95 dark:bg-amber-400";
  if (position === "single") return `${base} top-1 bottom-1 rounded-full`;
  if (position === "start") return `${base} top-1 -bottom-0.5 rounded-t-full`;
  if (position === "end") return `${base} -top-0.5 bottom-1 rounded-b-full`;
  return `${base} -top-0.5 -bottom-0.5`;
}

function FreeAgendaItem({ item, now }: { item: Extract<HudAgendaItem, { kind: "free" }>; now: Date }) {
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
  compact = false,
  color,
  tone = "default",
  title,
  onClick,
  ariaLabel,
}: {
  children: ReactNode;
  compact?: boolean;
  color?: string;
  tone?: HudPanelTone;
  title?: string;
  onClick?: (target: HTMLDivElement) => void;
  ariaLabel?: string;
}) {
  const className = `flex h-full min-h-0 w-full flex-col rounded-lg border ${compact ? "px-2.5 py-2" : "px-3 py-2"} shadow-sm ${
    onClick ? "cursor-pointer text-left transition hover:border-[var(--interactive-default)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--interactive-default)]" : ""
  }`;
  const style = hudPanelStyle({ color, tone });
  const content = (
    <>
      {title ? <div className="mb-1.5 shrink-0 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">{title}</div> : null}
      {children}
    </>
  );
  return (
    <div
      aria-label={ariaLabel}
      className={className}
      data-hud-event-trigger={onClick ? true : undefined}
      onClick={onClick ? (event) => onClick(event.currentTarget) : undefined}
      onKeyDown={onClick ? (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        onClick(event.currentTarget);
      } : undefined}
      role={onClick ? "button" : undefined}
      style={style}
      tabIndex={onClick ? 0 : undefined}
    >
      {content}
    </div>
  );
}

function hudPanelStyle({ color, tone }: { color?: string; tone: HudPanelTone }): CSSProperties {
  if (tone === "imminent") {
    return {
      "--text-primary": "#fffaf0",
      "--text-secondary": "rgba(255, 250, 240, 0.76)",
      "--text-tertiary": "rgba(255, 250, 240, 0.58)",
      "--hud-watermark": "#fffaf0",
      "--hud-watermark-opacity": "0.26",
      background: "linear-gradient(135deg, #282725 0%, #151514 100%)",
      borderColor: "rgba(255, 250, 240, 0.2)",
      boxShadow: "0 10px 24px rgba(0, 0, 0, 0.18), inset 0 0 0 1px rgba(255, 250, 240, 0.04)",
    } as CSSProperties;
  }

  return {
    background: color ? `color-mix(in oklab, ${color} 12%, var(--content-surface))` : "var(--content-surface)",
    borderColor: color ? `color-mix(in oklab, ${color} 42%, var(--border-default))` : "var(--border-default)",
  };
}

function HudEmptyState({ label, loading = false }: { label: string; loading?: boolean }) {
  if (loading) return <LoadingState label={label} size="sm" className="min-h-0 text-xs" />;
  return <div className="flex min-h-0 flex-1 items-center text-sm text-[var(--text-tertiary)]">{label}</div>;
}

function selectHudEvents(events: CalendarEvent[], now: Date): CalendarEvent[] {
  return events
    .filter(isVisibleCalendarForegroundEvent)
    .filter((event) => event.allDay || new Date(event.end) > now)
    .sort((a, b) => a.sortStart - b.sortStart);
}

function allDayEventOccursOnDate(event: CalendarEvent, dateKey: string): boolean {
  if (!event.allDay) return false;
  const startKey = event.start.slice(0, 10);
  const rawEndKey = event.end.slice(0, 10);
  const endKey = rawEndKey > startKey ? rawEndKey : addPlainDateDays(startKey, 1);
  return startKey <= dateKey && dateKey < endKey;
}

function buildAgendaSections(items: HudAgendaItem[], now: Date): AgendaSection[] {
  const sections: AgendaSection[] = [];
  let currentDayKey: string | null = null;
  let currentSection: AgendaSection | null = null;

  for (const item of items) {
    const start = agendaItemStart(item);
    const dayKey = dateKeyInTimeZone(start);
    if (dayKey !== currentDayKey) {
      currentSection = {
        date: dayKey,
        id: `section-${dayKey}`,
        items: [],
        label: agendaHeadingLabel(start, now),
        tasks: [],
      };
      sections.push(currentSection);
    }
    currentDayKey = dayKey;
    currentSection?.items.push(item);
  }

  return sections;
}

function buildHudDueTasksByDate(tasks: BridgeTask[], startDateKey: string, days: number): Map<string, BridgeTask[]> {
  const endDateKey = addPlainDateDays(startDateKey, days - 1);
  const tasksByDate = new Map<string, BridgeTask[]>();

  tasks.forEach((task) => {
    if (task.done || !task.dueDate) return;
    if (task.dueDate > endDateKey) return;
    const sectionDate = task.dueDate < startDateKey ? startDateKey : task.dueDate;
    const dayTasks = tasksByDate.get(sectionDate) ?? [];
    dayTasks.push(task);
    tasksByDate.set(sectionDate, dayTasks);
  });

  return tasksByDate;
}

function isTaskOverdue(task: BridgeTask, now: Date): boolean {
  if (!task.dueDate || task.done) return false;
  return task.dueDate < dateKeyInTimeZone(now);
}

function mergeAgendaSectionsWithDueTasks(
  sections: AgendaSection[],
  tasksByDate: Map<string, BridgeTask[]>,
  now: Date
): AgendaSection[] {
  if (tasksByDate.size === 0) return sections;

  const sectionsByDate = new Map<string, AgendaSection>(
    sections.map((section) => [
      section.date,
      { ...section, tasks: tasksByDate.get(section.date) ?? [] },
    ])
  );

  tasksByDate.forEach((tasks, date) => {
    if (tasks.length === 0 || sectionsByDate.has(date)) return;
    sectionsByDate.set(date, {
      date,
      id: `section-${date}`,
      items: [],
      label: agendaHeadingLabel(dateFromLocalKey(date), now),
      tasks,
    });
  });

  return Array.from(sectionsByDate.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function agendaItemStart(item: HudAgendaItem): Date {
  return item.kind === "event" ? new Date(item.event.start) : item.start;
}

function isEventCurrent(event: CalendarEvent, now: Date): boolean {
  if (event.allDay) return false;
  const start = new Date(event.start);
  const end = new Date(event.end);
  return start <= now && end > now;
}

function hudEndedEventReason(event: CalendarEvent, now: Date, manuallyEndedEventIds: Set<string>): HudEndedEventReason | null {
  if (manuallyEndedEventIds.has(event.id)) return "manual";
  if (!isEventCurrent(event, now)) return null;
  if (hasGranolaEndedSignal(event)) return "granola";
  return null;
}

function hasGranolaEndedSignal(event: CalendarEvent): boolean {
  return Boolean(event.meetingNotes?.some((note) => typeof note.meetingEndCount === "number" && note.meetingEndCount > 0));
}

function hasGranolaOpenSignal(event: CalendarEvent): boolean {
  return Boolean(event.meetingNotes?.some((note) => note.meetingEndCount === 0));
}

function hudEarlyStartReason(
  event: CalendarEvent,
  now: Date,
  manuallyStartedEventIds: Set<string>,
  manuallyEndedEventIds: Set<string>,
): HudEarlyStartReason | null {
  if (!canStartEventEarly(event, now)) return null;
  if (manuallyEndedEventIds.has(event.id) || hasGranolaEndedSignal(event)) return null;
  if (manuallyStartedEventIds.has(event.id)) return "manual";
  if (hasGranolaOpenSignal(event)) return "granola";
  return null;
}

function canStartEventEarly(event: CalendarEvent, now: Date): boolean {
  if (event.allDay) return false;
  const start = new Date(event.start).getTime();
  const nowMs = now.getTime();
  if (start <= nowMs) return false;
  return start - nowMs <= HUD_EARLY_START_WINDOW_MINUTES * 60_000;
}

function formatEarlyStartStatus(reason: HudEarlyStartReason): string {
  return reason === "granola" ? "Recording live" : "Started early";
}

function nowWatermark(nextEvent: CalendarEvent | null, now: Date): NowWatermarkState {
  if (!nextEvent) return { Icon: Smile, label: "Free now" };

  const nextStart = new Date(nextEvent.start);
  const millisecondsUntilStart = nextStart.getTime() - now.getTime();
  const minutesUntilStart = Math.ceil(millisecondsUntilStart / 60_000);
  if (minutesUntilStart <= HUD_MEETING_IMMINENT_MINUTES) return { Icon: AlarmClock, label: "Meeting imminent" };
  if (minutesUntilStart <= HUD_MEETING_SOON_MINUTES) return { Icon: Hourglass, label: "Meeting soon" };
  if (differenceInLocalDays(nextStart, now) > 0) return { Icon: Moon, label: "Done for the day" };
  if (minutesUntilStart >= 60) return { Icon: Coffee, label: "Open block" };
  return { Icon: Smile, label: "Free block" };
}

function isNextEventImminent(nextEvent: CalendarEvent, now: Date): boolean {
  const millisecondsUntilStart = new Date(nextEvent.start).getTime() - now.getTime();
  return millisecondsUntilStart <= HUD_MEETING_IMMINENT_MINUTES * 60_000;
}

function isCurrentMeetingHandoffImminent(currentEvent: CalendarEvent, nextEvent: CalendarEvent, now: Date): boolean {
  const currentEnd = new Date(currentEvent.end).getTime();
  const remainingMilliseconds = currentEnd - now.getTime();
  if (remainingMilliseconds <= 0 || remainingMilliseconds > HUD_MEETING_IMMINENT_MINUTES * 60_000) return false;
  const nextStart = new Date(nextEvent.start).getTime();
  return Math.abs(nextStart - currentEnd) <= NEXT_COUNTDOWN_DUPLICATE_TOLERANCE_MS;
}

function currentMeetingHandoffGap(currentEvent: CalendarEvent, nextEvent: CalendarEvent): HandoffGap | null {
  const start = new Date(currentEvent.end);
  const end = new Date(nextEvent.start);
  const gapMilliseconds = end.getTime() - start.getTime();
  const minutes = Math.round(gapMilliseconds / 60_000);
  if (minutes <= HUD_HANDOFF_BREAK_MINUTES) return null;
  return { start, end, minutes };
}

function formatEndedCurrentEventReason(reason?: HudEndedEventReason | null): string {
  if (reason === "manual") return "ended manually";
  return "wrapped early";
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

function formatCompactEventStart(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start);
  const prefix = formatCompactDatePrefix(start, now);
  const time = formatCompactTime(compactTimeParts(start), true);
  return prefix ? `${prefix} ${time}` : time;
}

function formatCompactEventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return "all day";
  return formatCompactTimeRange(new Date(event.start), new Date(event.end), now);
}

function formatHeroEventTime(event: CalendarEvent, now: Date): string {
  if (event.allDay) return "all day";
  const start = new Date(event.start);
  return formatCompactTimeRange(start, new Date(event.end), now, {
    includeStartDate: differenceInLocalDays(start, now) !== 0,
  });
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
  if (dayDifference === 1) return "tomorrow";
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

function addPlainDateDays(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
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
  const text = prepareCalendarDescription(description).visible
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
  return `${formatDuration(milliseconds, { secondsBelowMinute: true, secondsBelowMinutes: HUD_MEETING_IMMINENT_MINUTES })} left`;
}

function formatStartsIn(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start).getTime();
  const milliseconds = Math.max(0, start - now.getTime());
  if (milliseconds < 1000) return "starting now";
  return `in ${formatDuration(milliseconds, { secondsBelowMinute: true, secondsBelowMinutes: HUD_MEETING_IMMINENT_MINUTES })}`;
}

function nextCountdownDuplicatesNow(currentEvent: CalendarEvent | null, nextEvent: CalendarEvent | null): boolean {
  if (!nextEvent) return false;
  if (!currentEvent) return true;
  const currentEnd = new Date(currentEvent.end).getTime();
  const nextStart = new Date(nextEvent.start).getTime();
  return Math.abs(nextStart - currentEnd) <= NEXT_COUNTDOWN_DUPLICATE_TOLERANCE_MS;
}

function collapsedHudPrimary(
  currentEvent: CalendarEvent | null,
  nextEvent: CalendarEvent | null,
  now: Date,
  state: { currentEventEarlyReason?: HudEarlyStartReason | null; error: boolean; isLoading: boolean }
): string {
  if (state.isLoading) return "Loading";
  if (state.error) return "Calendar unavailable";
  if (currentEvent && state.currentEventEarlyReason) return `Now ${formatEarlyStartStatus(state.currentEventEarlyReason).toLowerCase()}`;
  if (currentEvent) return `Now ${formatRemaining(currentEvent, now) ?? "in progress"}`;
  if (nextEvent) return `Next ${formatStartsIn(nextEvent, now)}`;
  return "Free now";
}

function collapsedHudProgress(currentEvent: CalendarEvent | null, nextEvent: CalendarEvent | null, now: Date): number {
  if (currentEvent) return eventCompletion(currentEvent, now);
  if (!nextEvent) return 100;
  const millisecondsUntilStart = Math.max(0, new Date(nextEvent.start).getTime() - now.getTime());
  return clamp(100 - (millisecondsUntilStart / COLLAPSED_HUD_HORIZON_MS) * 100, 0, 100);
}

function hudProgressTrackStyle(color: string): CSSProperties {
  return {
    backgroundColor: `color-mix(in oklab, ${color} 18%, var(--content-surface))`,
  };
}

function formatFreeUntil(event: CalendarEvent, now: Date): string {
  const start = new Date(event.start).getTime();
  const milliseconds = Math.max(0, start - now.getTime());
  return formatDuration(milliseconds, { secondsBelowMinute: true, secondsBelowMinutes: HUD_MEETING_IMMINENT_MINUTES });
}

function formatDuration(milliseconds: number, options: { secondsBelowMinute?: boolean; secondsBelowMinutes?: number } = {}): string {
  const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (options.secondsBelowMinutes && totalSeconds <= options.secondsBelowMinutes * 60) {
    return formatMinutesAndSeconds(totalSeconds);
  }
  if (totalSeconds < 60 && options.secondsBelowMinute) return `${totalSeconds}s`;

  const totalMinutes = Math.max(1, Math.ceil(totalSeconds / 60));
  if (totalMinutes < 60) return `${totalMinutes}m`;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

function formatMinutesAndSeconds(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${seconds}s`;
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

function readManualHudEndedEvents(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HUD_MANUAL_ENDED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const records: Record<string, number> = {};
    Object.entries(parsed).forEach(([id, endedAt]) => {
      if (typeof endedAt === "number" && Number.isFinite(endedAt)) records[id] = endedAt;
    });
    return pruneManualHudEndedEvents(records);
  } catch {
    return {};
  }
}

function readManualHudStartedEvents(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(HUD_MANUAL_STARTED_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const records: Record<string, number> = {};
    Object.entries(parsed).forEach(([id, startedAt]) => {
      if (typeof startedAt === "number" && Number.isFinite(startedAt)) records[id] = startedAt;
    });
    return pruneManualHudStartedEvents(records);
  } catch {
    return {};
  }
}

function writeManualHudEndedEvents(records: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const pruned = pruneManualHudEndedEvents(records);
    if (Object.keys(pruned).length === 0) {
      window.localStorage.removeItem(HUD_MANUAL_ENDED_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(HUD_MANUAL_ENDED_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Ignore storage failures; the HUD can still apply the in-memory override.
  }
}

function writeManualHudStartedEvents(records: Record<string, number>) {
  if (typeof window === "undefined") return;
  try {
    const pruned = pruneManualHudStartedEvents(records);
    if (Object.keys(pruned).length === 0) {
      window.localStorage.removeItem(HUD_MANUAL_STARTED_STORAGE_KEY);
      return;
    }
    window.localStorage.setItem(HUD_MANUAL_STARTED_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Ignore storage failures; the HUD can still apply the in-memory override.
  }
}

function pruneManualHudEndedEvents(records: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - HUD_MANUAL_ENDED_TTL_MS;
  return Object.fromEntries(Object.entries(records).filter(([, endedAt]) => endedAt >= cutoff));
}

function pruneManualHudStartedEvents(records: Record<string, number>): Record<string, number> {
  const cutoff = Date.now() - HUD_MANUAL_STARTED_TTL_MS;
  return Object.fromEntries(Object.entries(records).filter(([, startedAt]) => startedAt >= cutoff));
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
