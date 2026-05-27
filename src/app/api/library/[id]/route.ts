import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getLibraryArtifact } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const artifact = getLibraryArtifact(vaultPath, id);
    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    return NextResponse.json(artifact);
  } catch (error) {
    console.error("[library] detail failed:", error);
    return NextResponse.json({ error: "Failed to read artifact" }, { status: 500 });
  }
}

