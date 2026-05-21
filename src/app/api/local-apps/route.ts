import { NextResponse } from "next/server";
import { getLocalAppsResponse } from "@/lib/local-apps/scanner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const snapshot = await getLocalAppsResponse({
      includePeers: url.searchParams.get("scope") !== "local",
    });
    return NextResponse.json(snapshot);
  } catch (error) {
    console.error("[local-apps] Error:", error);
    return NextResponse.json({
      app: "hilt-local-apps",
      enabled: false,
      reason: error instanceof Error ? error.message : "Failed to read local apps",
    }, { status: 500 });
  }
}
