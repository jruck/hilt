import { NextResponse } from "next/server";
import { calendarSetupStatus } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(calendarSetupStatus());
}
