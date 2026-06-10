import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listCandidates } from "@/lib/library/candidate-cache";
import { promoteCandidate } from "@/lib/library/promotion";
import { appendLibraryEvents } from "@/lib/library/events";
import type { PromotionReason } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const promotionReasons = new Set<PromotionReason>(["explicit_signal", "manual_save", "auto_threshold", "for_you_selected", "briefing_selected"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = (body.reason || "manual_save") as PromotionReason;
    if (!promotionReasons.has(reason)) {
      return NextResponse.json({ error: "Invalid promotion reason" }, { status: 400 });
    }
    const vaultPath = await getVaultPath();
    const candidate = listCandidates(vaultPath).find((item) => item.id === id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const promoted_to = await promoteCandidate(vaultPath, candidate, reason);
    appendLibraryEvents(vaultPath, [{ type: "promoted", artifact_id: id, meta: { reason } }]);
    return NextResponse.json({ ok: true, promoted_to });
  } catch (error) {
    console.error("[library/candidates/promote] failed:", error);
    return NextResponse.json({ error: "Failed to promote candidate" }, { status: 500 });
  }
}
