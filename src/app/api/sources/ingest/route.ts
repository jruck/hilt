import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { runIngestion } from "@/lib/library/runner";
import { loadSources } from "@/lib/library/source-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const cadences = new Set(["manual", "hourly", "daily", "weekly"]);

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const vaultPath = await getVaultPath();
    const cadence = typeof body.cadence === "string" && cadences.has(body.cadence) ? body.cadence : null;
    const sourceIds = Array.isArray(body.sourceIds)
      ? body.sourceIds.map(String)
      : cadence
        ? loadSources(vaultPath)
            .filter((source) => source.enabled && source.cadence === cadence)
            .map((source) => source.id)
        : undefined;
    const report = await runIngestion(vaultPath, {
      sourceIds,
      useSummarize: body.useSummarize !== false,
      dryRun: body.dryRun === true,
      ignoreState: body.ignoreState === true || body.dryRun === true,
      useCursor: body.useCursor === true,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : undefined,
      reweaveTimeoutMs: Number.isFinite(Number(body.reweaveTimeoutMs)) ? Number(body.reweaveTimeoutMs) : undefined,
    });
    const status = report.blocked.length ? 424 : 200;
    return NextResponse.json(report, { status });
  } catch (error) {
    console.error("[sources/ingest] failed:", error);
    return NextResponse.json({ error: "Failed to run ingestion" }, { status: 500 });
  }
}
