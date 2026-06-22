import { NextResponse } from "next/server";
import { readLocalMetrics } from "@/lib/system/telemetry/local";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Full-Hilt self-report: this machine's own telemetry, identical shape to the
// System Agent's /api/system/metrics (same readLocalMetrics fn) so the collector
// can poll every machine uniformly.
export async function GET() {
  return NextResponse.json(await readLocalMetrics());
}
