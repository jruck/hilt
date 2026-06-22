import { NextRequest, NextResponse } from "next/server";
import { isMetricsCollectorEnabled } from "@/lib/system/telemetry/config";
import { buildSeriesResponse, fetchAggregatorJson, isTelemetryRange } from "@/lib/system/telemetry/serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// On the collector (Mercury) read the local store; on a viewer proxy to the
// aggregator. The Performance chart consumes this.
export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  if (!isTelemetryRange(range)) {
    return NextResponse.json({ error: "Invalid range (use 6h|24h|7d|all)" }, { status: 400 });
  }
  try {
    const data = isMetricsCollectorEnabled()
      ? await buildSeriesResponse(range)
      : await fetchAggregatorJson(`/api/system/performance/series?range=${encodeURIComponent(range)}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[performance] series failed", error);
    return NextResponse.json({ error: "Performance telemetry source unreachable" }, { status: 502 });
  }
}
