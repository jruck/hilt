import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listCandidates } from "@/lib/library/candidate-cache";
import type { CandidateStatus } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const status = request.nextUrl.searchParams.get("status") as CandidateStatus | null;
    const vaultPath = await getVaultPath();
    return NextResponse.json({ candidates: listCandidates(vaultPath, status || undefined) });
  } catch (error) {
    console.error("[library/candidates] list failed:", error);
    return NextResponse.json({ error: "Failed to list candidates" }, { status: 500 });
  }
}

