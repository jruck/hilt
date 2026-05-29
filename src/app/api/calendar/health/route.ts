import { NextResponse } from "next/server";
import { calendarHealth } from "@/lib/calendar/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(calendarHealth());
}
