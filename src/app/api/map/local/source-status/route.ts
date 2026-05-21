import { NextResponse } from "next/server";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh, readMapScanDiagnostics } from "@/lib/map/local-indexer";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isLocalMapEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
    }, { status: 403 });
  }

  try {
    await ensureMapIndexFresh(15_000);
    const diagnostics = readMapScanDiagnostics();
    return NextResponse.json({ diagnostics, sourceStatuses: diagnostics.sourceStatuses });
  } catch (error) {
    console.error("[map/local/source-status] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read local source status" },
      { status: 500 },
    );
  }
}
