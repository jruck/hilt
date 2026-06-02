import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getLibraryArtifact, summarizeArtifact } from "@/lib/library/library";
import { getActiveBatchNotes, readReviewQueue, setReviewStatus, type ReviewQueueStatus } from "@/lib/library/review-queue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function isReviewStatus(value: unknown): value is ReviewQueueStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const queue = readReviewQueue(vaultPath);
    const items = [];
    for (const [id, review] of Object.entries(queue.items)) {
      if (review.status !== "pending") continue;
      // Skip entries whose underlying artifact no longer resolves.
      const detail = getLibraryArtifact(vaultPath, id);
      if (!detail) continue;
      items.push({ ...summarizeArtifact(detail), review });
    }
    const notes = getActiveBatchNotes(vaultPath);
    return NextResponse.json({ items, total: items.length, notes });
  } catch (error) {
    console.error("[library/review] read failed:", error);
    return NextResponse.json({ error: "Failed to read library review queue" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { id?: unknown; status?: unknown; note?: unknown };
    const id = typeof body.id === "string" ? body.id.trim() : "";
    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }
    if (!isReviewStatus(body.status)) {
      return NextResponse.json({ error: "status must be one of pending, approved, rejected" }, { status: 400 });
    }
    const note = typeof body.note === "string" ? body.note : undefined;

    const vaultPath = await getVaultPath();
    const updated = setReviewStatus(vaultPath, id, body.status, note);
    if (!updated) {
      return NextResponse.json({ error: "Review entry not found" }, { status: 404 });
    }
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[library/review] set status failed:", error);
    return NextResponse.json({ error: "Failed to update library review status" }, { status: 500 });
  }
}
