import { NextResponse } from "next/server";
import { refreshSystemSessions } from "@/lib/system/map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST() {
  try {
    return NextResponse.json(await refreshSystemSessions());
  } catch (error) {
    console.error("[system/sessions/refresh] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh system sessions" },
      { status: 500 },
    );
  }
}
