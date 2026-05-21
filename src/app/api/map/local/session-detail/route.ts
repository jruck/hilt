import { NextRequest, NextResponse } from "next/server";
import { sessionDetailQuerySchema } from "@/lib/map/local-contracts";
import { isLocalMapEnabled, isMapHistoryPreviewEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh } from "@/lib/map/local-indexer";
import { readLocalSessionDetail } from "@/lib/map/local-session-detail";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalMapEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
    }, { status: 403 });
  }

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
    await ensureMapIndexFresh(15_000);
    const detail = await readLocalSessionDetail(parsed.data.id, parsed.data.limit);
    if (!detail) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    console.error("[map/local/session-detail] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read local session detail" },
      { status: 500 },
    );
  }
}
