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

export type RecommendationPickRejectionCode =
  | "batch_limit"
  | "invalid_shape"
  | "duplicate_artifact"
  | "unknown_artifact"
  | "empty_reason"
  | "missing_valid_trigger"
  | "source_paraphrase"
  | "missing_context_delta"
  | "repeated_context"
  | "unchanged_pitch"
  | "missing_new_item_trigger"
  | "near_duplicate";

export interface RecommendationPickRejection {
  index: number;
  artifact_id: string | null;
  code: RecommendationPickRejectionCode;
  message: string;
}

export interface RecommendationPickValidation {
  picks: RecommendationPickInput[];
  rejections: RecommendationPickRejection[];
}

export interface RecommendationPickValidationRun extends RecommendationPickValidation {
  raw: RawRecommendationPick[];
  repair_attempted: boolean;
}

export interface RecommendationEditorRepairContext {
  attempted: RawRecommendationPick[];
  rejections: RecommendationPickRejection[];
}

export interface RecommendationEditorPromptInput {
  candidates: RecommendedArtifact[];
  contextText: string;
  evidenceText: string;
  maxItems: number;
  previousByArtifact: Map<string, RecommendationEpisode>;
  repair?: RecommendationEditorRepairContext | null;
}

/** Shared production/replay prompt builder. Keeping the prose in one place makes an offline
 * counterfactual editor pass comparable to the live pass without giving the replay write access. */
export function buildRecommendationEditorPrompt({
  candidates,
  contextText,
  evidenceText,
  maxItems,
  previousByArtifact,
  repair = null,
}: RecommendationEditorPromptInput): string {
  const itemBlocks = candidates.map((item) => {
    const previous = previousByArtifact.get(item.id) || null;
    return [
      `ID: ${item.id}`,
      `Title: ${item.title}`,
      `State: ${item.lifecycle_status}`,
      `Created: ${item.created_at}`,
      `Worth: ${item.worth} (${item.why})`,
      `Source: ${item.source_name || item.source_id}`,
      item.summary ? `Summary: ${item.summary.slice(0, 450)}` : "",
      previous ? `Last recommended: ${previous.recommended_at}` : "Never recommended",
      previous ? `Previous pitch: ${previous.why_now}` : "",
      previous ? `Previous triggers: ${previous.triggers.map((trigger) => trigger.id).join(", ")}` : "",
    ].filter(Boolean).join("\n");
  }).join("\n\n");
  const repairSummary = repair?.rejections.slice(0, 6).map((rejection) => rejection.message).join("; ") || "";
  return [
    "You are the editor of Justin's personal Library attention feed. Select every item he should",
    "put his eyes on now, not a fixed quota. Usually select 3-7; return zero on a thin run and never",
    `more than ${maxItems}. New explicit saves may qualify on intrinsic value. Candidates need a higher bar.`,
    "An older item may be resurfaced ONLY when a supplied non-artifact trigger represents a materially",
    "new decision, task, project movement, or conversation. Repeated topic mentions are not enough.",
    "The worth score is advisory. Prefer specific utility and timing. Avoid duplicate takes. When",
    "quality is close, prefer a useful mix of sources and content types, but never select a weaker",
    "item merely to fill a diversity slot.",
    "For each pick, write a concise executive-assistant-style reason to Justin and cite one or more",
    "TRIGGER ids exactly as supplied. The reason is a recommendation pitch, not a source summary:",
    "name what changed, what current decision or work it informs, or why the timing matters. Do not",
    "paraphrase the title or Summary. When citing a meeting/task/project/area/briefing trigger, the",
    "reason must name a concrete detail from that evidence that is not already in the source Summary.",
    "Never invent a trigger.",
    "The batch is atomic: if even one pick violates these rules, none of the picks will be saved.",
    'Return ONLY JSON: {"picks":[{"id":"...","reason":"...","trigger_ids":["..."]}]}',
    ...(repair ? [
      "",
      "=== REPAIR REQUIRED ===",
      "The previous complete response failed deterministic validation. Return a complete replacement picks array,",
      "not only the rejected entries. You may drop a weak pick or choose a different eligible candidate.",
      `Previous response: ${JSON.stringify({ picks: repair.attempted })}`,
      `Validation failures: ${repairSummary}`,
      "Re-check every replacement pick for exact supplied IDs, exact supplied trigger IDs, a non-summary",
      "why-now reason, concrete changed-context language, and duplicate topics before returning JSON.",
    ] : []),
    "",
    "=== ACTIVE WORK ===",
    contextText,
    "",
    "=== RECENT EVIDENCE ===",
    evidenceText,
    "",
    "=== CANDIDATES ===",
    itemBlocks,
  ].join("\n");
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

export function validateRecommendationPicksDetailed({
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
}): RecommendationPickValidation {
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const triggerById = new Map(triggers.map((trigger) => [trigger.id, trigger]));
  const selected: Array<{ item: RecommendedArtifact; pick: RecommendationPickInput }> = [];
  const rejections: RecommendationPickRejection[] = [];
  const seen = new Set<string>();

  const reject = (
    index: number,
    entry: RawRecommendationPick | null,
    code: RecommendationPickRejectionCode,
    message: string,
  ): void => {
    rejections.push({
      index,
      artifact_id: entry && typeof entry === "object" && typeof entry.id === "string" ? entry.id : null,
      code,
      message,
    });
  };

  for (const [index, entry] of raw.entries()) {
    if (index >= maxItems) {
      reject(index, entry, "batch_limit", `pick ${index + 1} exceeds the ${maxItems}-item batch limit`);
      continue;
    }
    if (!entry || typeof entry !== "object" || typeof entry.id !== "string" || typeof entry.reason !== "string") {
      reject(index, entry, "invalid_shape", `pick ${index + 1} must include string id and reason fields`);
      continue;
    }
    if (seen.has(entry.id)) {
      reject(index, entry, "duplicate_artifact", `pick ${index + 1} repeats artifact ${entry.id}`);
      continue;
    }
    const item = byId.get(entry.id);
    const reason = entry.reason.trim();
    if (!item) {
      reject(index, entry, "unknown_artifact", `pick ${index + 1} references an artifact outside the candidate pool`);
      continue;
    }
    if (!reason) {
      reject(index, entry, "empty_reason", `pick ${index + 1} has an empty recommendation reason`);
      continue;
    }
    const triggerIds = Array.isArray(entry.trigger_ids)
      ? entry.trigger_ids.filter((id): id is string => typeof id === "string")
      : [];
    const pickedTriggers = triggerIds
      .map((id) => triggerById.get(id))
      .filter((trigger): trigger is RecommendationTrigger => Boolean(trigger));
    if (pickedTriggers.length === 0) {
      reject(index, entry, "missing_valid_trigger", `pick ${index + 1} cites no valid supplied trigger id`);
      continue;
    }
    const previous = previousByArtifact.get(item.id) || null;
    if (recommendationTextSimilarity(`${item.title} ${item.summary || ""}`, reason) >= RECOMMENDATION_SOURCE_SIMILARITY_LIMIT) {
      reject(index, entry, "source_paraphrase", `pick ${index + 1} paraphrases the source instead of explaining why it matters now`);
      continue;
    }
    if (!recommendationPitchHasContextDelta(reason, item, pickedTriggers)) {
      reject(index, entry, "missing_context_delta", `pick ${index + 1} does not name a concrete detail from its context trigger`);
      continue;
    }
    if (previous) {
      const oldFingerprints = new Set(previous.triggers.map((trigger) => trigger.fingerprint));
      const hasNewEvidence = pickedTriggers.some((trigger) => (
        trigger.kind !== "artifact" && !oldFingerprints.has(trigger.fingerprint)
      ));
      if (!hasNewEvidence) {
        reject(index, entry, "repeated_context", `pick ${index + 1} does not cite materially new evidence for this resurface`);
        continue;
      }
      if (recommendationTextSimilarity(previous.why_now, reason) >= 0.8) {
        reject(index, entry, "unchanged_pitch", `pick ${index + 1} repeats the previous recommendation pitch`);
        continue;
      }
    } else if (!pickedTriggers.some((trigger) => trigger.id === `artifact:${item.id}` || trigger.kind !== "artifact")) {
      reject(index, entry, "missing_new_item_trigger", `pick ${index + 1} does not cite its own artifact or a non-artifact context trigger`);
      continue;
    }
    if (selected.some(({ item: prior }) => nearDuplicate(prior.title, item.title))) {
      reject(index, entry, "near_duplicate", `pick ${index + 1} duplicates the topic of an earlier pick`);
      continue;
    }
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
  return { picks: selected.map((entry) => entry.pick), rejections };
}

export function validateRecommendationPicks(
  input: Parameters<typeof validateRecommendationPicksDetailed>[0],
): RecommendationPickInput[] {
  return validateRecommendationPicksDetailed(input).picks;
}

export async function validateRecommendationPicksWithRepair(
  input: Parameters<typeof validateRecommendationPicksDetailed>[0],
  repair: (failed: { raw: RawRecommendationPick[]; rejections: RecommendationPickRejection[] }) => Promise<RawRecommendationPick[]>,
): Promise<RecommendationPickValidationRun> {
  const first = validateRecommendationPicksDetailed(input);
  if (first.rejections.length === 0) {
    return { ...first, raw: input.raw, repair_attempted: false };
  }
  const raw = await repair({ raw: input.raw, rejections: first.rejections });
  const repaired = validateRecommendationPicksDetailed({ ...input, raw });
  return { ...repaired, raw, repair_attempted: true };
}
