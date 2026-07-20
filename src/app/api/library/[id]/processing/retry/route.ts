import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getLibraryArtifact } from "@/lib/library/library";
import { retryLibrarySource } from "@/lib/library/source-recovery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const artifact = getLibraryArtifact(vaultPath, id);
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    const result = retryLibrarySource(vaultPath, artifact);
    if (!result) {
      return NextResponse.json({ error: "Artifact has no retryable source failure" }, { status: 409 });
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[library/processing/retry] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Retry failed" }, { status: 500 });
  }
}
