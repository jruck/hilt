import type { LibraryScoringConfig } from "./scoring-config";
import type {
  RecommendationDismissal,
  RecommendationEpisode,
  RecommendationTrigger,
  RecommendedArtifact,
} from "./types";
import type { RecommendationPickInput } from "./recommendation-store";

export interface RecommendationExposure {
  at: string;
  type: "served" | "read";
}

export interface RawRecommendationPick {
  id?: unknown;
  reason?: unknown;
  trigger_ids?: unknown;
}

const CONTEXT_STOPWORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between", "could", "from",
  "have", "into", "just", "more", "most", "need", "only", "other", "should", "some", "than",
  "that", "their", "there", "these", "they", "this", "through", "today", "using", "very", "want",
  "what", "when", "where", "which", "while", "with", "would", "your",
]);

function wordSet(input: string): Set<string> {
  return new Set((input.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .filter((word) => word.length > 2 && !CONTEXT_STOPWORDS.has(word)));
}

export function recommendationTextSimilarity(a: string, b: string): number {
  const left = wordSet(a);
  const right = wordSet(b);
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const token of left) if (right.has(token)) overlap += 1;
  return overlap / (left.size + right.size - overlap);
}

export const RECOMMENDATION_SOURCE_SIMILARITY_LIMIT = 0.65;

function triggerText(trigger: RecommendationTrigger): string {
  return `${trigger.label} ${"text" in trigger ? String(trigger.text || "") : ""}`;
}

/** A contextual pitch must name something supplied by the changed context, not only paraphrase the source. */
export function recommendationPitchHasContextDelta(
  reason: string,
  item: Pick<RecommendedArtifact, "title" | "summary">,
  triggers: RecommendationTrigger[],
): boolean {
  const contextual = triggers.filter((trigger) => trigger.kind !== "artifact" && trigger.kind !== "legacy");
  if (!contextual.length) return true;
  const sourceTokens = wordSet(`${item.title} ${item.summary || ""}`);
  const reasonTokens = wordSet(reason);
  return contextual.some((trigger) => (
    [...wordSet(triggerText(trigger))].some((token) => !sourceTokens.has(token) && reasonTokens.has(token))
  ));
}

function ageDays(iso: string | null | undefined, now: Date): number {
  const timestamp = Date.parse(iso || "");
  return Number.isFinite(timestamp) ? (now.getTime() - timestamp) / 86_400_000 : Number.POSITIVE_INFINITY;
}

export function recommendationCooldownEligible({
  previous,
  dismissal,
  exposure,
  now,
  config,
}: {
  previous: RecommendationEpisode | null;
  dismissal?: RecommendationDismissal | null;
  exposure?: RecommendationExposure | null;
  now: Date;
  config: LibraryScoringConfig["for_you"];
}): boolean {
  if (!previous) return true;
  if (dismissal && !dismissal.restored_at && ageDays(dismissal.dismissed_at, now) < config.dismissal_cooldown_days) return false;
  if (!exposure) return ageDays(previous.recommended_at, now) >= config.exposure_cooldown_days;
  return ageDays(exposure.at, now) >= (
    exposure.type === "read" ? config.read_cooldown_days : config.exposure_cooldown_days
  );
}

function artifactContextText(item: RecommendedArtifact): string {
  return [item.title, item.summary, item.author, ...item.tags, ...item.source_tags]
    .filter(Boolean)
    .join(" ");
}

export function contextTextHasStrongLibraryMatch(
  contextText: string,
  artifacts: Array<Pick<RecommendedArtifact, "title" | "summary" | "author" | "tags" | "source_tags">>,
): boolean {
  const contextTokens = wordSet(contextText);
  if (contextTokens.size < 3) return false;
  return artifacts.some((artifact) => {
    const artifactTokens = wordSet([
      artifact.title,
      artifact.summary,
      artifact.author,
      ...artifact.tags,
      ...artifact.source_tags,
    ].filter(Boolean).join(" "));
    let overlap = 0;
    for (const token of contextTokens) {
      if (artifactTokens.has(token)) overlap += 1;
      if (overlap >= 3) return true;
    }
    return false;
  });
}

export interface RecommendationContextMatch {
  trigger: RecommendationTrigger;
  terms: string[];
  score: number;
}

export function strongestNovelContextMatch(
  item: RecommendedArtifact,
  triggers: RecommendationTrigger[],
  previous: RecommendationEpisode | null,
): RecommendationContextMatch | null {
  const artifactTokens = wordSet(artifactContextText(item));
  const priorFingerprints = new Set(previous?.triggers.map((trigger) => trigger.fingerprint) || []);
  let best: RecommendationContextMatch | null = null;
  for (const trigger of triggers) {
    if (trigger.kind === "artifact" || trigger.kind === "legacy" || priorFingerprints.has(trigger.fingerprint)) continue;
    const triggerTokens = wordSet(`${trigger.label} ${"text" in trigger ? String(trigger.text || "") : ""}`);
    const terms = [...triggerTokens].filter((token) => artifactTokens.has(token)).slice(0, 10);
    if (terms.length < 3) continue;
    const score = terms.length / Math.max(6, Math.min(24, triggerTokens.size));
    if (!best || score > best.score) best = { trigger, terms, score };
  }
  return best;
}

/** Seven-day ready items are guaranteed consideration; older items need a novel strong match. */
export function buildEditorialCandidatePool({
  pool,
  triggers,
  previousByArtifact,
  now,
  config,
}: {
  pool: RecommendedArtifact[];
  triggers: RecommendationTrigger[];
  previousByArtifact: Map<string, RecommendationEpisode>;
  now: Date;
  config: LibraryScoringConfig["for_you"];
}): RecommendedArtifact[] {
  const cutoff = now.getTime() - config.new_window_days * 86_400_000;
  const fresh = pool
    .filter((item) => Date.parse(item.created_at) >= cutoff)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || (b.worth || 0) - (a.worth || 0));
  const freshIds = new Set(fresh.map((item) => item.id));
  const contextual = pool
    .filter((item) => !freshIds.has(item.id))
    .map((item) => ({ item, match: strongestNovelContextMatch(item, triggers, previousByArtifact.get(item.id) || null) }))
    .filter((entry): entry is { item: RecommendedArtifact; match: RecommendationContextMatch } => Boolean(entry.match))
    .sort((a, b) => b.match.score - a.match.score || (b.item.worth || 0) - (a.item.worth || 0))
    .map((entry) => entry.item);
  return [...fresh, ...contextual].slice(0, config.pool);
}

export function validateRecommendationPicks({
  raw,
  candidates,
  triggers,
  previousByArtifact,
  maxItems,
  nearDuplicate,
}: {
  raw: RawRecommendationPick[];
  candidates: RecommendedArtifact[];
  triggers: RecommendationTrigger[];
  previousByArtifact: Map<string, RecommendationEpisode>;
  maxItems: number;
  nearDuplicate: (a: string, b: string) => boolean;
}): RecommendationPickInput[] {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const triggerById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
  const selected: Array<{ item: RecommendedArtifact; pick: RecommendationPickInput }> = [];
  const seen = new Set<string>();

  for (const entry of raw.slice(0, maxItems)) {
    if (typeof entry.id !== "string" || typeof entry.reason !== "string" || seen.has(entry.id)) continue;
    const item = byId.get(entry.id);
    const reason = entry.reason.trim();
    const triggerIds = Array.isArray(entry.trigger_ids)
      ? entry.trigger_ids.filter((id): id is string => typeof id === "string")
      : [];
    const pickedTriggers = triggerIds
      .map((id) => triggerById.get(id))
      .filter((trigger): trigger is RecommendationTrigger => Boolean(trigger));
    if (!item || !reason || pickedTriggers.length === 0) continue;
    const previous = previousByArtifact.get(item.id) || null;
    if (recommendationTextSimilarity(`${item.title} ${item.summary || ""}`, reason) >= RECOMMENDATION_SOURCE_SIMILARITY_LIMIT) continue;
    if (!recommendationPitchHasContextDelta(reason, item, pickedTriggers)) continue;
    if (previous) {
      const oldFingerprints = new Set(previous.triggers.map((trigger) => trigger.fingerprint));
      const hasNewEvidence = pickedTriggers.some((trigger) => (
        trigger.kind !== "artifact" && !oldFingerprints.has(trigger.fingerprint)
      ));
      if (!hasNewEvidence || recommendationTextSimilarity(previous.why_now, reason) >= 0.8) continue;
    } else if (!pickedTriggers.some((trigger) => trigger.id === `artifact:${item.id}` || trigger.kind !== "artifact")) {
      continue;
    }
    if (selected.some(({ item: prior }) => nearDuplicate(prior.title, item.title))) continue;
    seen.add(item.id);
    selected.push({
      item,
      pick: {
        artifact_id: item.id,
        why_now: reason,
        triggers: pickedTriggers,
        scores: { worth: item.worth, relevance: item.relevance, substance: item.substance, freshness: item.freshness },
      },
    });
  }
  return selected.map((entry) => entry.pick);
}
