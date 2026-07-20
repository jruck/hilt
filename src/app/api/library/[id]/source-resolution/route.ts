import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { captureFailed } from "@/lib/library/capture-health";
import { getLibraryArtifact } from "@/lib/library/library";
import { LibrarySourceResolutionError, resolveLibrarySourceFailure } from "@/lib/library/source-resolution";
import type { LibrarySourceResolutionStatus } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isSourceFailure(artifact: NonNullable<ReturnType<typeof getLibraryArtifact>>): boolean {
  return (artifact.processing?.state === "blocked"
      && (artifact.processing.stage === "capture" || artifact.processing.stage === "transcribe"))
    || captureFailed({ body: artifact.content, frontmatter: artifact.raw_frontmatter });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({})) as { status?: unknown; reason?: unknown };
    const status: LibrarySourceResolutionStatus | null = body.status === "unavailable" || body.status === "accepted_limited"
      ? body.status
      : null;
    if (!status) return NextResponse.json({ error: "Invalid source resolution" }, { status: 400 });
    if (typeof body.reason === "string" && body.reason.trim().length > 500) {
      return NextResponse.json({ error: "Reason must be 500 characters or fewer" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    const artifact = getLibraryArtifact(vaultPath, id);
    if (!artifact) return NextResponse.json({ error: "Artifact not found" }, { status: 404 });
    if (!isSourceFailure(artifact)) {
      return NextResponse.json({ error: "This artifact does not have an unresolved source failure" }, { status: 409 });
    }

    const reason = typeof body.reason === "string" && body.reason.trim()
      ? body.reason.trim()
      : artifact.processing?.last_error?.message || artifact.attention?.detail || undefined;
    const result = resolveLibrarySourceFailure(vaultPath, artifact, {
      status,
      reason,
      evidence: {
        attention_kind: artifact.attention?.kind || null,
        processing_stage: artifact.processing?.stage || null,
        attempt_count: artifact.processing?.attempt ?? artifact.attention?.attempt_count ?? null,
        error_code: artifact.processing?.last_error?.code || null,
        error_message: artifact.processing?.last_error?.message || artifact.attention?.detail || null,
      },
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    if (error instanceof LibrarySourceResolutionError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
    }
    console.error("[library/source-resolution] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Source resolution failed" }, { status: 500 });
  }
}
