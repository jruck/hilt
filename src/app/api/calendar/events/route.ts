import { NextRequest, NextResponse } from "next/server";
import { queryCalendarAvailabilityBlocks, queryCalendarEvents, queryCalendarHolidayEvents } from "@/lib/calendar/db";
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

  return NextResponse.json({
    events: attachGranolaMeetingNotes(queryCalendarEvents(filters)),
    availabilityBlocks: queryCalendarAvailabilityBlocks(filters),
    holidayEvents: queryCalendarHolidayEvents({ start, end }),
  });
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
