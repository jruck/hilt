import { NextRequest, NextResponse } from "next/server";
import { syncCalendarSources } from "@/lib/calendar/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const body = await safeJson(request);
  const sourceIds = Array.isArray(body?.sourceIds)
    ? body.sourceIds.filter((id): id is string => typeof id === "string" && id.length > 0)
    : undefined;

  const report = await syncCalendarSources({ sourceIds });
  return NextResponse.json(report);
}

async function safeJson(request: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
