import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { runLibraryIntake } from "@/lib/library/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const vaultPath = await getVaultPath();
    const report = await runLibraryIntake(vaultPath, {
      sourceIds: Array.isArray(body.sourceIds) ? body.sourceIds.map(String) : undefined,
      force: body.force !== false,
      explicitOnly: body.explicitOnly !== false,
      limit: Number.isFinite(Number(body.limit)) ? Number(body.limit) : undefined,
    });
    return NextResponse.json(report, { status: report.blocked.length || report.errors.length ? 207 : 200 });
  } catch (error) {
    console.error("[sources/intake] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to check sources" }, { status: 500 });
  }
}
