import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getRecommendations } from "@/lib/library/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const limit = Number(request.nextUrl.searchParams.get("limit") || 10);
    return NextResponse.json(getRecommendations(vaultPath, limit));
  } catch (error) {
    console.error("[library/recommendations] failed:", error);
    return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 });
  }
}

