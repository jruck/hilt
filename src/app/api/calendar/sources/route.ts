import { NextResponse } from "next/server";
import { listCalendarSources, listCalendars } from "@/lib/calendar/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json({
    sources: listCalendarSources(),
    calendars: listCalendars(),
  });
}
