import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { appendLibraryEvents } from "@/lib/library/events";
import { recommendationEpisodeById } from "@/lib/library/recommendation-store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const rawIds = Array.isArray(body.episode_ids)
      ? body.episode_ids.filter((id: unknown): id is string => typeof id === "string")
      : [];
    const ids = [...new Set<string>(rawIds)].slice(0, 40);
    const surface = body.surface === "briefing" ? "briefing" : "for_you";
    const vaultPath = await getVaultPath();
    const episodes = ids
      .map((id) => recommendationEpisodeById(vaultPath, id))
      .filter((episode): episode is NonNullable<typeof episode> => Boolean(episode));
    appendLibraryEvents(vaultPath, episodes.map((episode) => ({
      type: "served" as const,
      artifact_id: episode.artifact_id,
      surface,
      rank: episode.rank,
      scores: episode.scores,
      meta: { episode_id: episode.id, batch_id: episode.batch_id },
    })));
    return NextResponse.json({ recorded: episodes.length });
  } catch (error) {
    console.error("[library/recommendations/impressions] failed:", error);
    return NextResponse.json({ error: "Failed to record impressions" }, { status: 500 });
  }
}
