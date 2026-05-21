import { NextResponse } from "next/server";
import { refreshLocalApps } from "@/lib/local-apps/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const url = new URL(request.url);
    const refreshPreviews = url.searchParams.get("previews") !== "false";
    const snapshot = await refreshLocalApps({
      includePeers: url.searchParams.get("scope") !== "local",
      forcePreviews: refreshPreviews,
      waitForPreviews: refreshPreviews,
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("[local-apps/refresh] Error:", error);
    return NextResponse.json({
      app: "hilt-local-apps",
      enabled: false,
      reason: error instanceof Error ? error.message : "Failed to refresh local apps",
    }, { status: 500 });
  }
}
