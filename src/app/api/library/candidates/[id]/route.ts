import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listCandidates, updateCandidate } from "@/lib/library/candidate-cache";

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
    const candidate = listCandidates(vaultPath).find((item) => item.id === id);
    if (!candidate) return NextResponse.json({ error: "Candidate not found" }, { status: 404 });
    const status = body.status === "skipped" ? "skipped" : body.status === "candidate" ? "candidate" : null;
    if (!status) return NextResponse.json({ error: "Unsupported candidate status" }, { status: 400 });
    return NextResponse.json({ candidate: updateCandidate(vaultPath, candidate, { status }) });
  } catch (error) {
    console.error("[library/candidates] update failed:", error);
    return NextResponse.json({ error: "Failed to update candidate" }, { status: 500 });
  }
}

