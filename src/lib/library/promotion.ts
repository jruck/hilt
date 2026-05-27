import path from "path";
import type { PromotionReason, ReferenceCandidate } from "./types";
import { updateCandidate } from "./candidate-cache";
import { writeDurableReference } from "./references";
import { isoNow } from "./utils";
import { digestArtifact } from "./digestion";
import type { LibrarySourceConfig, RawArtifact } from "./types";

function sourceFromCandidate(candidate: ReferenceCandidate): LibrarySourceConfig {
  return {
    id: candidate.source_id,
    name: candidate.source_name,
    channel: candidate.channel,
    url: candidate.url,
    enabled: true,
    cadence: "manual",
    intent: "explicit_save",
    signal: "manual_save",
    retention: { mode: "durable", ttl_days: 30, candidate_ttl_days: 30, auto_promote_threshold: 0.85 },
    backfill: { enabled: false, mode: "none" },
    tags: [],
    filters: { include_topics: [], exclude_topics: [] },
    metadata: {},
    path: "",
  };
}

export async function promoteCandidate(vaultPath: string, candidate: ReferenceCandidate, reason: PromotionReason): Promise<string> {
  const raw: RawArtifact = {
    url: candidate.url,
    title: candidate.title,
    author: candidate.author || undefined,
    date: candidate.published || candidate.digested,
    content: candidate.content,
    metadata: {
      format: candidate.format,
      proposed_destination: candidate.proposed_destination || "references",
    },
  };
  const processed = await digestArtifact(raw, sourceFromCandidate(candidate), { useSummarize: false });
  processed.summary = candidate.summary || processed.summary;
  processed.key_points = candidate.key_points.length ? candidate.key_points : processed.key_points;
  processed.score = candidate.score;
  processed.proposed_destination = candidate.proposed_destination || "references";
  processed.connected_projects = candidate.connected_projects;
  const durablePath = writeDurableReference(vaultPath, processed, reason);
  updateCandidate(vaultPath, candidate, {
    status: "promoted",
    promotion: {
      promoted_to: path.relative(vaultPath, durablePath).split(path.sep).join("/"),
      promoted_at: isoNow(),
      promoted_reason: reason,
    },
  });
  return durablePath;
}
