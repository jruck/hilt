import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { appendLibraryEvents } from "@/lib/library/events";
import { dismissRecommendation, recommendationEpisodeById } from "@/lib/library/recommendation-store";
import { appendToThread, createThread, openThreadForTarget } from "@/lib/threads/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ episodeId: string }> }) {
  try {
    const { episodeId } = await params;
    const body = await request.json().catch(() => ({}));
    const note = typeof body.note === "string" ? body.note.trim().slice(0, 10_000) : "";
    const vaultPath = await getVaultPath();
    const episode = recommendationEpisodeById(vaultPath, episodeId);
    if (!episode) return NextResponse.json({ error: "Recommendation not found" }, { status: 404 });
    const dismissal = dismissRecommendation(vaultPath, episodeId, note || null);
    if (note) {
      const target = { kind: "library" as const, id: episode.artifact_id };
      const open = openThreadForTarget(target);
      if (open) appendToThread(open.id, { author: "justin", text: note });
      else createThread(target, { author: "justin", text: note });
    }
    appendLibraryEvents(vaultPath, [{
      type: "recommendation_dismissed",
      artifact_id: episode.artifact_id,
      surface: body.surface === "briefing" ? "briefing" : "for_you",
      meta: { episode_id: episode.id, batch_id: episode.batch_id, feedback_left: Boolean(note) },
    }]);
    if (note) appendLibraryEvents(vaultPath, [{
      type: "feedback_left",
      artifact_id: episode.artifact_id,
      meta: { episode_id: episode.id, batch_id: episode.batch_id, source: "recommendation_dismissal" },
    }]);
    return NextResponse.json({ dismissal });
  } catch (error) {
    console.error("[library/recommendations/dismiss] failed:", error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Failed to dismiss recommendation" }, { status: 500 });
  }
}
