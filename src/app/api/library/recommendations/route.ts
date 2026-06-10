import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getRecommendations } from "@/lib/library/recommendations";
import { appendLibraryEvents } from "@/lib/library/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const rawLimit = Number(request.nextUrl.searchParams.get("limit") || 10);
    const limit = Number.isFinite(rawLimit) ? rawLimit : 10;
    const result = getRecommendations(vaultPath, limit);
    // Impression log: every For You serving, with rank + the serve-time score snapshot (metric 4).
    // no_log=1 keeps machine traffic (the nightly metrics latency probe, agents) out of the
    // engagement record — phantom impressions in an append-only log can never be cleanly excised.
    if (request.nextUrl.searchParams.get("no_log") !== "1") appendLibraryEvents(vaultPath, result.items.map((item, index) => ({
      type: "served" as const,
      artifact_id: item.id,
      surface: "for_you" as const,
      rank: index + 1,
      scores: { worth: item.worth, relevance: item.relevance, substance: item.substance, freshness: item.freshness },
    })));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[library/recommendations] failed:", error);
    return NextResponse.json({ error: "Failed to get recommendations" }, { status: 500 });
  }
}

