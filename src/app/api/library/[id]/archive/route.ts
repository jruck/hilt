import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { archiveLibraryArtifact, getLibraryArtifact } from "@/lib/library/library";
import { evalAttrsForArtifact } from "@/lib/library/recommendations";
import { appendLibraryEvents } from "@/lib/library/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    // Capture the eval verdict BEFORE the move: metric 3 (rescue rate / archive trust) only counts
    // archives that confirm a to_archive flag — a plain manual archive is a different signal.
    const artifact = getLibraryArtifact(vaultPath, id);
    const lifecycle = artifact ? evalAttrsForArtifact(vaultPath, artifact)?.lifecycle : undefined;
    const result = archiveLibraryArtifact(vaultPath, id);
    appendLibraryEvents(vaultPath, [{ type: "archived_confirmed", artifact_id: id, meta: { to_archive_flagged: lifecycle === "to_archive" } }]);
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive artifact";
    const status = message === "Artifact not found" ? 404 : message.includes("Only saved") ? 400 : 500;
    console.error("[library] archive failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
