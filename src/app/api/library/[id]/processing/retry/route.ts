import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { retryProcessingArtifact } from "@/lib/library/processing";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const record = retryProcessingArtifact(vaultPath, id);
    if (!record) return NextResponse.json({ error: "Processing record not found" }, { status: 404 });
    return NextResponse.json({ ok: true, artifact_uid: record.artifact_uid, status: record.status });
  } catch (error) {
    console.error("[library/processing/retry] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed" }, { status: 500 });
  }
}
