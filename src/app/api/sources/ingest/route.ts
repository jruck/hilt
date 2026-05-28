import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { runIngestion } from "@/lib/library/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const vaultPath = await getVaultPath();
    const report = await runIngestion(vaultPath, {
      sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : undefined,
      useSummarize: body.useSummarize !== false,
      dryRun: body.dryRun === true,
      ignoreState: body.ignoreState === true || body.dryRun === true,
      useCursor: body.useCursor === true,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : undefined,
    });
    const status = report.blocked.length ? 424 : 200;
    return NextResponse.json(report, { status });
  } catch (error) {
    console.error("[sources/ingest] failed:", error);
    return NextResponse.json({ error: "Failed to run ingestion" }, { status: 500 });
  }
}
