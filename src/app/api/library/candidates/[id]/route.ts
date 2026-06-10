import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { findCandidateById, updateCandidate } from "@/lib/library/candidate-cache";
import { appendLibraryEvents } from "@/lib/library/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const vaultPath = await getVaultPath();
    const candidate = findCandidateById(vaultPath, id);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    const status = body.status === "skipped" ? "skipped" : body.status === "candidate" ? "candidate" : null;
    if (!status) return NextResponse.json({ error: "Unsupported candidate status" }, { status: 400 });
    const updated = updateCandidate(vaultPath, candidate, { status });
    // Log AFTER the write succeeds, and only for REAL transitions — a no-op PATCH (double-click) must
    // not inflate the negative-signal/rescue record. A skip is the strongest cheap negative signal;
    // restoring a previously-skipped candidate is a rescue.
    if (candidate.status !== status) {
      appendLibraryEvents(vaultPath, [{ type: status === "skipped" ? "skipped" : "rescued", artifact_id: id, meta: { from: candidate.status } }]);
    }
    return NextResponse.json({ candidate: updated });
  } catch (error) {
    console.error("[library/candidates] update failed:", error);
    return NextResponse.json({ error: "Failed to update candidate" }, { status: 500 });
  }
}
