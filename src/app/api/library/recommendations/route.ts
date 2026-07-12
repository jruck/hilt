import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getRecommendationFeed } from "@/lib/library/recommendations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const params = request.nextUrl.searchParams;
    const rawLimit = Number(params.get("limit") || 40);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 40;
    const status = params.get("status");
    const mode = params.get("mode");
    const result = getRecommendationFeed(vaultPath, {
      limit,
      cursor: params.get("cursor"),
      source: params.get("source"),
      channel: params.get("channel"),
      status: status === "saved" || status === "candidate" ? status : null,
      mode: mode === "study" || mode === "keep" ? mode : null,
      tag: params.get("tag"),
      q: params.get("q"),
      content_type: params.get("content_type") || params.get("type"),
    });
    return NextResponse.json(result);
  } catch (error) {
    console.error("[library/recommendations] failed:", error);
    return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 });
  }
}
