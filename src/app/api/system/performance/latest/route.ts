import { NextResponse } from "next/server";
import { isMetricsCollectorEnabled } from "@/lib/system/telemetry/config";
import { buildLatestResponse, fetchAggregatorJson } from "@/lib/system/telemetry/serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const data = isMetricsCollectorEnabled()
      ? await buildLatestResponse()
      : await fetchAggregatorJson("/api/system/performance/latest");
    return NextResponse.json(data);
  } catch (error) {
    console.error("[performance] latest failed", error);
    return NextResponse.json({ error: "Performance telemetry source unreachable" }, { status: 502 });
  }
}
