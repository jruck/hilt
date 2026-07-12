import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getRecommendationEpisodeArtifacts } from "@/lib/library/recommendations";
import { readRecommendationVerdicts, recommendationEpisodesById } from "@/lib/library/recommendation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const ids = (request.nextUrl.searchParams.get("ids") || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean)
      .slice(0, 20);
    const vaultPath = await getVaultPath();
    const episodes = recommendationEpisodesById(vaultPath, ids);
    const known = new Set(episodes.map((episode) => episode.id));
    const items = getRecommendationEpisodeArtifacts(vaultPath, ids);
    const hydrated = new Set(items.map((item) => item.recommendation?.episode_id).filter(Boolean));
    const dismissals = readRecommendationVerdicts(vaultPath).dismissals;
    const dismissedEpisodeIds = episodes
      .filter((episode) => {
        const dismissal = dismissals[episode.id];
        return Boolean(dismissal && !dismissal.restored_at);
      })
      .map((episode) => episode.id);
    return NextResponse.json({
      items,
      dismissed_episode_ids: dismissedEpisodeIds,
      missing_episode_ids: ids.filter((id) => !known.has(id) || !hydrated.has(id)),
    });
  } catch (error) {
    console.error("[library/recommendations/episodes] failed:", error);
    return NextResponse.json({ error: "Failed to read recommendation episodes" }, { status: 500 });
  }
}
