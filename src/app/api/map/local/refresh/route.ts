import { NextResponse } from "next/server";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import { refreshMapIndex } from "@/lib/map/local-indexer";

export const dynamic = "force-dynamic";

export async function POST() {
  if (!isLocalMapEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
    }, { status: 403 });
  }

  try {
    const diagnostics = await refreshMapIndex();
    return NextResponse.json({ diagnostics });
  } catch (error) {
    console.error("[map/local/refresh] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to refresh local map index" },
      { status: 500 },
    );
  }
}
