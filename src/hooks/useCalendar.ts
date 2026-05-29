"use client";

import useSWR, { mutate as mutateCache } from "swr";
import type {
  CalendarDefinition,
  CalendarEvent,
  CalendarHealth,
  CalendarSource,
  CalendarSyncReport,
} from "@/lib/calendar/types";

export interface CalendarSourcesResponse {
  sources: CalendarSource[];
  calendars: CalendarDefinition[];
}

export interface CalendarEventsResponse {
  events: CalendarEvent[];
  availabilityBlocks: CalendarEvent[];
  holidayEvents: CalendarEvent[];
}

export interface CalendarSetupStatus extends CalendarHealth {
  configured: boolean;
}

interface CalendarEventQuery {
  start: Date;
  end: Date;
  sourceIds?: string[];
  calendarIds?: string[];
}

const fetcher = async <T>(url: string): Promise<T> => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`);
  return response.json() as Promise<T>;
};

export function useCalendarSetupStatus() {
  return useSWR<CalendarSetupStatus>("/api/calendar/setup/status", fetcher);
}

export function useCalendarSources() {
  return useSWR<CalendarSourcesResponse>("/api/calendar/sources", fetcher);
}

export function useCalendarHealth() {
  return useSWR<CalendarHealth>("/api/calendar/health", fetcher);
}

export function useCalendarEvents(query: CalendarEventQuery) {
  return useSWR<CalendarEventsResponse>(calendarEventsKey(query), fetcher, {
    keepPreviousData: true,
  });
}

export async function syncCalendarSources(sourceIds?: string[]): Promise<CalendarSyncReport> {
  const response = await fetch("/api/calendar/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceIds }),
  });
  if (!response.ok) throw new Error(`Calendar sync failed with status ${response.status}`);
  const report = await response.json() as CalendarSyncReport;
  await mutateCalendarCaches();
  return report;
}

export async function setCalendarSelected(id: string, selected: boolean): Promise<CalendarDefinition> {
  const response = await fetch(`/api/calendar/calendars/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ selected }),
  });
  if (!response.ok) throw new Error(`Calendar update failed with status ${response.status}`);
  const data = await response.json() as { calendar: CalendarDefinition };
  await mutateCalendarCaches();
  return data.calendar;
}

export async function mutateCalendarCaches() {
  await Promise.all([
    mutateCache("/api/calendar/setup/status"),
    mutateCache("/api/calendar/sources"),
    mutateCache("/api/calendar/health"),
    mutateCache((key) => typeof key === "string" && key.startsWith("/api/calendar/events")),
  ]);
}

function calendarEventsKey(query: CalendarEventQuery): string {
  const search = new URLSearchParams({
    start: query.start.toISOString(),
    end: query.end.toISOString(),
  });
  if (query.sourceIds?.length) search.set("sourceIds", query.sourceIds.join(","));
  if (query.calendarIds?.length) search.set("calendarIds", query.calendarIds.join(","));
  return `/api/calendar/events?${search.toString()}`;
}
