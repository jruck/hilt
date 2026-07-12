import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { appendLibraryEvents } from "@/lib/library/events";
import { recommendationEpisodeById, restoreRecommendation } from "@/lib/library/recommendation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    const vaultPath = await getVaultPath();
    const episode = recommendationEpisodeById(vaultPath, episodeId);
    if (!episode) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    const dismissal = restoreRecommendation(vaultPath, episodeId);
    appendLibraryEvents(vaultPath, [{
      type: "recommendation_restored",
      artifact_id: episode.artifact_id,
      surface: "for_you",
      meta: { episode_id: episode.id, batch_id: episode.batch_id },
    }]);
    return NextResponse.json({ dismissal });
  } catch (error) {
    console.error("[library/recommendations/restore] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to restore recommendation" }, { status: 500 });
  }
}
