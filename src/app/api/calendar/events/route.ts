import { NextRequest, NextResponse } from "next/server";
import { queryCalendarAvailabilityBlocks, queryCalendarEvents, queryCalendarHolidayEvents } from "@/lib/calendar/db";
import type { CalendarEvent } from "@/lib/calendar/types";
import { attachPeopleNoteTargetsToCalendarEvents } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";
import { attachGranolaMeetingNotes } from "@/lib/granola/calendar-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const search = request.nextUrl.searchParams;
  const now = new Date();
  const start = parseDate(search.get("start")) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const end = parseDate(search.get("end")) ?? new Date(now.getFullYear(), now.getMonth(), now.getDate() + 31);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
    return NextResponse.json({ error: "Invalid start/end range" }, { status: 400 });
  }

  const filters = {
    start,
    end,
    sourceIds: csv(search.get("sourceIds")),
    calendarIds: csv(search.get("calendarIds")),
  };

  const events = await attachCalendarNotes(queryCalendarEvents(filters));

  return NextResponse.json({
    events,
    availabilityBlocks: queryCalendarAvailabilityBlocks(filters),
    holidayEvents: queryCalendarHolidayEvents({ start, end }),
  });
}

async function attachCalendarNotes(events: CalendarEvent[]): Promise<CalendarEvent[]> {
  const withGranolaNotes = attachGranolaMeetingNotes(events);
  try {
    return attachPeopleNoteTargetsToCalendarEvents(withGranolaNotes, await getVaultPath());
  } catch (error) {
    console.warn("[calendar/events] Failed to attach People note targets", error);
    return withGranolaNotes;
  }
}

function parseDate(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function csv(value: string | null): string[] | undefined {
  const items = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return items?.length ? items : undefined;
}
