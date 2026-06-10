import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getLibraryArtifact, getLibraryArtifactByPath, getLibraryComments } from "@/lib/library/library";
import { evalAttrsForArtifact } from "@/lib/library/recommendations";
import { appendLibraryEvents } from "@/lib/library/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const artifactPath = request.nextUrl.searchParams.get("path");
    const artifact = artifactPath
      ? getLibraryArtifactByPath(vaultPath, id, artifactPath) || getLibraryArtifact(vaultPath, id)
      : getLibraryArtifact(vaultPath, id);
    if (!artifact) {
      return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    }
    const eval_attrs = evalAttrsForArtifact(vaultPath, artifact) || undefined;
    const comments = getLibraryComments(vaultPath, artifact.id);
    appendLibraryEvents(vaultPath, [{ type: "opened", artifact_id: artifact.id, surface: "detail" }]);
    return NextResponse.json({ ...artifact, eval_attrs, comments });
  } catch (error) {
    console.error("[library] detail failed:", error);
    return NextResponse.json({ error: "Failed to read artifact" }, { status: 500 });
  }
}
