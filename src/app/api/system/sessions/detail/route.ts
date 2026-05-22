import { NextRequest, NextResponse } from "next/server";
import { sessionDetailQuerySchema } from "@/lib/map/local-contracts";
import { isMapHistoryPreviewEnabled } from "@/lib/map/local-config";
import { readSystemSessionDetail } from "@/lib/system/map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isMapHistoryPreviewEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map history preview is disabled. Set HILT_MAP_HISTORY_PREVIEW=true to enable it.",
    }, { status: 403 });
  }

  const parsed = sessionDetailQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    const detail = await readSystemSessionDetail(parsed.data.id, parsed.data.limit);
    if (!detail) return NextResponse.json({ error: "Session not found" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[system/sessions/detail] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system session detail" },
      { status: 500 },
    );
  }
}
