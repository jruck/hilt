import { NextRequest, NextResponse } from "next/server";
import { discoverSystemMachines } from "@/lib/system/peers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const includePeers = request.nextUrl.searchParams.get("scope") !== "local";
    return NextResponse.json({
      app: "hilt-system",
      enabled: true,
      machines: await discoverSystemMachines({ includePeers }),
    });
  } catch (error) {
    return NextResponse.json(
      { app: "hilt-system", enabled: false, reason: error instanceof Error ? error.message : "Failed to read system machines" },
      { status: 500 },
    );
  }
}
