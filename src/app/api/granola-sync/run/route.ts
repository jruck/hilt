import { NextRequest, NextResponse } from "next/server";
import { runGranolaSync } from "@/lib/granola/sync";
import type { GranolaSyncMode } from "@/lib/granola/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MODES = new Set<GranolaSyncMode>(["incremental", "backfill", "compare", "augment-existing"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const mode = typeof body.mode === "string" && MODES.has(body.mode) ? body.mode as GranolaSyncMode : "incremental";
    const report = await runGranolaSync({
      mode,
      dryRun: body.dryRun !== undefined ? Boolean(body.dryRun) : mode === "compare",
      daysBack: finiteNumber(body.daysBack),
      limit: finiteNumber(body.limit),
      includeTranscripts: body.includeTranscripts !== false,
      outputDir: typeof body.outputDir === "string" ? body.outputDir : undefined,
    });
    return NextResponse.json(report, { status: report.errors.length && !report.blocked ? 500 : 200 });
  } catch (error) {
    console.error("[granola-sync/run] Error:", error);
    return NextResponse.json({ error: "Granola sync failed" }, { status: 500 });
  }
}

function finiteNumber(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : undefined;
}
