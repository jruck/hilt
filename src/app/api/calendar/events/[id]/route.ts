import { NextResponse } from "next/server";
import { getCalendarEvent } from "@/lib/calendar/db";
import { attachGranolaMeetingNotes } from "@/lib/granola/calendar-links";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const event = getCalendarEvent(decodeURIComponent(id));
  if (!event) {
    return NextResponse.json({ error: "Event not found" }, { status: 404 });
  }

  return NextResponse.json({ event: attachGranolaMeetingNotes([event])[0] });
}
