import { NextResponse } from "next/server";
import { getCalendarEvent } from "@/lib/calendar/db";
import { attachPeopleNoteTargetsToCalendarEvents } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";
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

  const withGranolaNotes = attachGranolaMeetingNotes([event]);
  try {
    return NextResponse.json({ event: attachPeopleNoteTargetsToCalendarEvents(withGranolaNotes, await getVaultPath())[0] });
  } catch (error) {
    console.warn("[calendar/events/id] Failed to attach People note targets", error);
    return NextResponse.json({ event: withGranolaNotes[0] });
  }
}
