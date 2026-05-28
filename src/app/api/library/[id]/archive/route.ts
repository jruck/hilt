import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { archiveLibraryArtifact } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    return NextResponse.json(archiveLibraryArtifact(vaultPath, id));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to archive artifact";
    const status = message === "Artifact not found" ? 404 : message.includes("Only saved") ? 400 : 500;
    console.error("[library] archive failed:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
