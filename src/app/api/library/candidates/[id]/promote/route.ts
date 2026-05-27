import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listCandidates } from "@/lib/library/candidate-cache";
import { promoteCandidate } from "@/lib/library/promotion";
import type { PromotionReason } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const reason = (body.reason || "manual_save") as PromotionReason;
    const vaultPath = await getVaultPath();
    const candidate = listCandidates(vaultPath).find((item) => item.id === id);
    if (!candidate) {
      return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    }
    const promoted_to = await promoteCandidate(vaultPath, candidate, reason);
    return NextResponse.json({ ok: true, promoted_to });
  } catch (error) {
    console.error("[library/candidates/promote] failed:", error);
    return NextResponse.json({ error: "Failed to promote candidate" }, { status: 500 });
  }
}

