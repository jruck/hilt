import { NextRequest, NextResponse } from "next/server";
import { setCalendarSelected } from "@/lib/calendar/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null) as { selected?: unknown } | null;
  if (typeof body?.selected !== "boolean") {
    return NextResponse.json({ error: "selected must be a boolean" }, { status: 400 });
  }

  const calendar = setCalendarSelected(decodeURIComponent(id), body.selected);
  if (!calendar) {
    return NextResponse.json({ error: "Calendar not found" }, { status: 404 });
  }

  return NextResponse.json({ calendar });
}
