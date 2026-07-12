import fs from "fs";
import path from "path";
import type {
  ConnectionSuggestion,
  LibraryArtifact,
  LibraryArtifactDetail,
  LibraryEvalAttrs,
  RecommendationBatchKind,
  RecommendationEpisode,
  RecommendationEpisodeScores,
  RecommendationPresentation,
  RecommendedArtifact,
} from "./types";
import { listLibraryArtifactDetails } from "./library";
import { markdownToPlain } from "./markdown";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import { buildSemanticContext, scoreArtifactSemantic, type SemanticContext } from "./semantic-relevance";
import { loadScoringConfig } from "./scoring-config-loader";
import type { LibraryScoringConfig } from "./scoring-config";
import { readLibraryEvents } from "./events";
import { captureFailed } from "./capture-health";
import { connectionSuggestionsFromFrontmatter, hasConnectionPass } from "./connection-state";
import { contentTypeForArtifact } from "./content-type";
import {
  bootstrapLegacyRecommendationCache,
  projectedRecommendationEpisodes,
  readRecommendationRuntime,
  recommendationEpisodesById,
} from "./recommendation-store";

interface ContextSignal {
  kind: "project" | "task" | "area" | "person" | "recent_save";
  label: string;
  text: string;
  weight: number;
  /** Precomputed once per signal set — tokenizing every signal for every scored artifact was O(signals × artifacts). */
  tokens?: string[];
}

const STOPWORDS = new Set([
  "about", "active", "after", "again", "also", "and", "because", "been", "before", "being", "between", "could", "from",
  "have", "into", "just", "like", "more", "most", "only", "over", "should", "some", "that", "their", "them",
  "there", "these", "this", "through", "with", "would", "your", "reference", "library", "candidate", "saved",
  "article", "author", "bookmark", "bookmarks", "cached", "captured", "channel", "connections", "content", "created",
  "description", "false", "format", "frontmatter", "https", "http", "media", "null", "points", "published", "raindrop",
  "raw", "source", "source-id", "source-name", "status", "summary", "tags", "title", "true", "type", "updated", "url",
  "meeting", "meetings", "next", "notes", "team", "work",
]);

// For You sizing now lives in the versioned scoring config (meta/library-scoring.json).

function readTextIfExists(filePath: string): string {
  try {
    return fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8").replace(/^---\s*[\s\S]*?\s*---\s*/m, "")
      : "";
  } catch {
    return "";
  }
}

function readFolderIndexSignals(vaultPath: string, folder: string, kind: ContextSignal["kind"], weight: number, limit: number): ContextSignal[] {
  const dir = path.join(vaultPath, folder);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((entry) => !entry.name.startsWith("."))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((entry) => {
      const text = entry.isDirectory()
        ? readTextIfExists(path.join(dir, entry.name, "index.md"))
        : entry.isFile() && entry.name.endsWith(".md")
          ? readTextIfExists(path.join(dir, entry.name))
          : "";
      return text ? { kind, label: entry.name.replace(/\.md$/, ""), text, weight } : null;
    })
    .filter((signal): signal is ContextSignal => Boolean(signal));
}

function currentTaskSignals(vaultPath: string, taskWeight: number): ContextSignal[] {
  const listsDir = path.join(vaultPath, "lists", "now");
  const latest = fs.existsSync(listsDir)
    ? fs.readdirSync(listsDir).filter((name) => name.endsWith(".md")).sort().pop()
    : null;
  const weekly = latest ? readTextIfExists(path.join(listsDir, latest)) : "";
  if (!weekly) return [];
  const uncheckedTasks = weekly
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\[\s*]\s+/.test(line))
    .join("\n");
  return [{ kind: "task", label: latest || "current week", text: uncheckedTasks || weekly, weight: taskWeight }];
}

function recentSaveSignals(artifacts: LibraryArtifactDetail[], weights: LibraryScoringConfig["signal_weights"]): ContextSignal[] {
  return artifacts
    .filter((artifact) => artifact.lifecycle_status === "saved" && (!artifact.processing || artifact.processing.state === "ready"))
    .slice(0, 20)
    .map((artifact) => ({
      kind: "recent_save" as const,
      label: artifact.title,
      text: [artifact.title, artifact.summary, artifact.tags.join(" "), artifact.source_tags.join(" "), artifact.source_collection, artifact.source_folder].filter(Boolean).join("\n"),
      weight: artifact.source_id === "manual" ? weights.recent_save_manual : weights.recent_save,
    }));
}

function activeContextSignals(vaultPath: string, artifacts: LibraryArtifactDetail[], config: LibraryScoringConfig): ContextSignal[] {
  const weights = config.signal_weights;
  const areaText = readTextIfExists(path.join(vaultPath, "areas", "index.md"));
  const signals = [
    ...readFolderIndexSignals(vaultPath, "projects", "project", weights.project, 80),
    ...currentTaskSignals(vaultPath, weights.task),
    ...(areaText ? [{ kind: "area" as const, label: "North Stars", text: areaText, weight: weights.area }] : []),
    ...readFolderIndexSignals(vaultPath, "people", "person", weights.person, 80),
    ...recentSaveSignals(artifacts, weights),
  ];
  for (const signal of signals) signal.tokens = tokenize(signal.text);
  return signals;
}

function tokenize(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))));
}

/** @internal Exposed for the calibration/diagnostic scripts (token contextFit head-to-head). */
export function __debugActiveContextSignals(vaultPath: string, artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  return activeContextSignals(vaultPath, artifacts, loadScoringConfig(vaultPath));
}
/** @internal Exposed for diagnostics — the token-overlap contextFit for one artifact. */
export function __debugTokenContextFit(artifact: LibraryArtifactDetail, signals: ContextSignal[]): number {
  return scoreAgainstSignals(artifact, signals).score;
}

function scoreAgainstSignals(artifact: LibraryArtifactDetail, signals: ContextSignal[]): { score: number; matches: Array<{ label: string; kind: ContextSignal["kind"]; terms: string[]; score: number }> } {
  const artifactText = markdownToPlain([
    artifact.title,
    artifact.summary,
    artifact.tags.join(" "),
    artifact.source_tags.join(" "),
    artifact.source_collection,
    artifact.source_folder,
    artifact.content,
  ].join("\n"));
  const artifactTokens = new Set(tokenize(artifactText));
  if (!artifactTokens.size) return { score: 0, matches: [] };

  const matches = signals.map((signal) => {
    const signalTokens = signal.tokens ?? tokenize(signal.text);
    const terms = signalTokens.filter((token) => artifactTokens.has(token)).slice(0, 6);
    const minimumTerms = signal.kind === "project" || signal.kind === "task" ? 2 : 3;
    const score = terms.length >= minimumTerms
      ? Math.min(0.45, terms.length / Math.max(14, Math.min(signalTokens.length, 120))) * signal.weight
      : 0;
    return { label: signal.label, kind: signal.kind, terms, score };
  }).filter((match) => match.score > 0)
    .sort((a, b) => b.score - a.score);

  return {
    score: Number(matches.reduce((sum, match) => sum + match.score, 0).toFixed(3)),
    matches,
  };
}

function connectionSuggestionsForArtifact(artifact: LibraryArtifactDetail): ConnectionSuggestion[] {
  return connectionSuggestionsFromFrontmatter(artifact.raw_frontmatter);
}

/** Substance for an item: a model-judged grade if present, else the structural proxy from the source. */
function substanceFor(artifact: LibraryArtifactDetail): number {
  const fm = artifact.raw_frontmatter;
  const graded = typeof fm.substance === "number" ? fm.substance : null;
  if (graded !== null && graded >= 0 && graded <= 1) return graded;
  const sourceChars = Number(fm.extracted_chars || fm.cached_source_chars || 0) || (artifact.content?.length || 0);
  const findingsCount = (artifact.content?.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length;
  return structuralSubstance({
    format: typeof fm.format === "string" ? fm.format : null,
    sourceChars,
    videoDurationSeconds: typeof fm.video_duration_seconds === "number" ? fm.video_duration_seconds : null,
    findingsCount,
  });
}

function artifactReadyForEvaluation(artifact: LibraryArtifactDetail): boolean {
  return (!artifact.processing || artifact.processing.state === "ready")
    && artifact.raw_frontmatter.reweave_pending !== true;
}

/**
 * "For You" = the L3 eval applied across the library. Relevance and tier come from the structural eval
 * (woven connections + active-context fit); we surface the legible `why` and drop `archive`-tier items.
 * The eval is dynamic — recomputed each call against the current active context, never stamped.
 */
function scoreArtifact(vaultPath: string, artifact: LibraryArtifactDetail, signals: ContextSignal[], semanticCtx: SemanticContext, config: LibraryScoringConfig): RecommendedArtifact {
  const contextScore = scoreAgainstSignals(artifact, signals);
  const topContext = contextScore.matches.find((match) => match.kind !== "recent_save");
  // Topical fit: PREFER embedding cosine, fall back to token-overlap. Measured on the real
  // vault (scripts/library-semantic-headtohead.ts): the token-overlap fit sums across ~80
  // active-context signals UNCAPPED (mean ~1.37, 97% ≥0.45), so it saturates the eval's 0.3
  // relevance cap for ~everyone — it differentiates nothing. The embedding cosine fit (mean
  // ~0.20, a real 0→0.45 gradient) is the signal that actually separates on-topic from not.
  // So for embedded items (saved refs AND candidates — both scope='library') we REPLACE
  // token with semantic; anything not yet embedded (a candidate ingested since the runner's
  // last reconcile) returns null and keeps the token fallback — the best available there.
  const semantic = scoreArtifactSemantic(vaultPath, artifact, semanticCtx);
  let contextFit = contextScore.score;
  let contextLabel = topContext?.label ?? null;
  if (semantic) {
    contextFit = semantic.score;
    contextLabel = semantic.label ?? contextLabel;
  }
  const fm = artifact.raw_frontmatter;
  // Capture health (shared predicate, capture-health.ts): failed captures route to needs_refetch
  // instead of ever being graded/archive-flagged (user ruling, steering round 1). A warm digestion
  // alone does NOT trigger — warm items often carry real partial content and stay gradable.
  const extractionOk = !captureFailed({ body: artifact.content, frontmatter: fm });
  const evaluation = evaluateArtifact({
    connections: connectionSuggestionsForArtifact(artifact),
    contextFit,
    contextLabel,
    createdAt: artifact.created_at,
    substance: substanceFor(artifact),
    extraction_ok: extractionOk,
    // Positive evidence we looked, including older v2.2 abstentions whose only marker is the
    // attention_judgment stamped by the reweave pass.
    analyzed: hasConnectionPass(artifact.raw_frontmatter),
  }, config);
  const matchedTerms = Array.from(new Set(contextScore.matches.flatMap((match) => match.terms))).slice(0, 8);
  const evalAttrs: LibraryEvalAttrs = {
    worth: evaluation.worth,
    relevance: evaluation.relevance,
    substance: evaluation.substance,
    freshness: evaluation.freshness,
    lifecycle: evaluation.lifecycle,
    why: evaluation.why,
  };
  return {
    ...artifact,
    eval_attrs: evalAttrs,
    relevance_score: evaluation.worth,
    why: evaluation.why,
    worth: evaluation.worth,
    relevance: evaluation.relevance,
    substance: evaluation.substance,
    freshness: evaluation.freshness,
    lifecycle: evaluation.lifecycle,
    matched_terms: matchedTerms,
  };
}

/**
 * Score every study item against the current active context — worth = relevance × substance × freshness.
 * Cheap/structural (no model calls). Powers For You, the inspection report, and the workbench list API.
 */
// --- Shared-input cache (Plan 004) -----------------------------------------
// The full artifact load + derived context signals are the dominant per-call
// cost shared by the scoring entry points below — evalAttrsForArtifact in
// particular loaded all ~3000 artifacts just to score one detail-pane item.
// Cache the (artifacts, signals, config) bundle briefly so an interaction
// burst (a feed render + a detail-pane open + worth-slider drags) reloads once.
// Invalidation: keyed on vaultPath + the references/candidates directory
// mtimes (an add, remove, or atomic temp+rename write bumps the dir mtime),
// with a short TTL ceiling as a backstop. Scores are unchanged — only how the
// shared inputs are obtained changes.
type SharedScoringInputs = {
  artifacts: LibraryArtifactDetail[];
  signals: ContextSignal[];
  config: LibraryScoringConfig;
};

const SHARED_INPUTS_TTL_MS = 2000;
let sharedInputsCache: { key: string; at: number; value: SharedScoringInputs } | null = null;

function libraryDirFingerprint(vaultPath: string): string {
  const dirs = [
    path.join(vaultPath, "references"),
    path.join(vaultPath, "references", ".cache", "library-candidates"),
  ];
  return dirs
    .map((dir) => {
      try {
        return String(fs.statSync(dir).mtimeMs);
      } catch {
        return "0";
      }
    })
    .join(":");
}

function loadSharedScoringInputs(vaultPath: string, limit: number): SharedScoringInputs {
  const config = loadScoringConfig(vaultPath);
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, artifacts, config);
  return { artifacts, signals, config };
}

function sharedScoringInputs(vaultPath: string): SharedScoringInputs {
  const key = `${vaultPath}::${libraryDirFingerprint(vaultPath)}`;
  const now = Date.now();
  if (sharedInputsCache && sharedInputsCache.key === key && now - sharedInputsCache.at < SHARED_INPUTS_TTL_MS) {
    return sharedInputsCache.value;
  }
  const value = loadSharedScoringInputs(vaultPath, 3000);
  sharedInputsCache = { key, at: now, value };
  return value;
}

export function evaluateLibrary(vaultPath: string, opts: { limit?: number } = {}): RecommendedArtifact[] {
  // The default 3000-load is shared with the other scoring entry points, so it
  // uses the cache; a caller-supplied non-default limit loads directly to
  // preserve the exact artifact set.
  const { artifacts, signals, config } =
    opts.limit === undefined || opts.limit === 3000
      ? sharedScoringInputs(vaultPath)
      : loadSharedScoringInputs(vaultPath, opts.limit);
  const semanticCtx = buildSemanticContext(vaultPath, artifacts);
  return artifacts
    .filter((artifact) => artifact.lifecycle_status !== "expired" && artifact.lifecycle_status !== "skipped")
    .filter(artifactReadyForEvaluation)
    // keep is a stash, out of the worth-ranked feed; worth scoring applies only to study items.
    .filter((artifact) => artifact.library_mode !== "keep")
    .map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx, config));
}

/** Score a given list of artifacts against the active context — signals built once. Used by the feed's
 *  eval-filter path (worth slider, lifecycle) so it filters the already-source/pipeline-filtered set. */
export function scoreArtifacts(vaultPath: string, artifacts: LibraryArtifactDetail[]): RecommendedArtifact[] {
  const { artifacts: all, signals, config } = sharedScoringInputs(vaultPath);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  return artifacts
    .filter(artifactReadyForEvaluation)
    .map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx, config));
}

/** Eval attributes for a single study item (for the detail metadata panel). null for keep items. */
export function evalAttrsForArtifact(vaultPath: string, artifact: LibraryArtifactDetail): LibraryEvalAttrs | null {
  if (artifact.library_mode === "keep" || !artifactReadyForEvaluation(artifact)) return null;
  const { artifacts: all, signals, config } = sharedScoringInputs(vaultPath);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  const scored = scoreArtifact(vaultPath, artifact, signals, semanticCtx, config);
  return { worth: scored.worth, relevance: scored.relevance, substance: scored.substance, freshness: scored.freshness, lifecycle: scored.lifecycle, why: scored.why };
}

// ---------------------------------------------------------------------------
// For You v3: scoring proposes candidates; immutable recommendation episodes decide feed position.
// Ordinary score changes never reorder the feed. Only a new editorial episode can move an artifact.
// ---------------------------------------------------------------------------

/** Candidate generation for the editorial pass. The durable feed itself is episode-ordered. */
export function buildForYouPool(vaultPath: string): { pool: RecommendedArtifact[]; config: LibraryScoringConfig } {
  const config = loadScoringConfig(vaultPath);
  const since = new Date(Date.now() - config.for_you.negative_suppress_days * 86_400_000).toISOString();
  const negative = new Set(
    readLibraryEvents(vaultPath, { since })
      .filter((event) => event.type === "skipped" || event.type === "archived_confirmed")
      .map((event) => event.artifact_id),
  );
  // Full corpus stays available for context-triggered resurfacing; the editor receives a bounded
  // candidate set and must cite fresh trigger evidence before an old item can move again.
  const pool = evaluateLibrary(vaultPath, { limit: 3000 })
    .sort((a, b) => (b.worth || 0) - (a.worth || 0))
    .filter((item) => !negative.has(item.id))
    // A stub-graded item must never be recommended — its digest may describe a cover blurb.
    .filter((item) => item.lifecycle !== "needs_refetch");
  return { pool, config };
}

function titleTokenSet(title: string): Set<string> {
  return new Set(tokenize(title));
}

/** Near-duplicate titles (the same story from two sources) — Jaccard over title tokens. */
export function nearDuplicateRecommendationTitles(a: string, b: string): boolean {
  const ta = titleTokenSet(a);
  const tb = titleTokenSet(b);
  if (!ta.size || !tb.size) return false;
  const overlap = [...ta].filter((token) => tb.has(token)).length;
  return overlap / (ta.size + tb.size - overlap) > 0.6;
}

export interface RecommendationFeedOptions {
  limit?: number;
  cursor?: string | null;
  source?: string | null;
  channel?: string | null;
  status?: "saved" | "candidate" | null;
  mode?: "study" | "keep" | null;
  tag?: string | null;
  q?: string | null;
  content_type?: string | null;
}

export interface RecommendationFeedResult {
  items: RecommendedArtifact[];
  total: number;
  cursor: string | null;
  next_cursor: string | null;
  generated_at: string;
  context_summary: string;
  batch: {
    id: string;
    generated_at: string;
    size: number;
    kind: RecommendationBatchKind | null;
  } | null;
}

function scoresOf(item: RecommendedArtifact): RecommendationEpisodeScores {
  return { worth: item.worth, relevance: item.relevance, substance: item.substance, freshness: item.freshness };
}

function ensureRecommendationProjection(vaultPath: string, scored: RecommendedArtifact[]): RecommendationEpisode[] {
  const scores = new Map(scored.map((item) => [item.id, scoresOf(item)]));
  bootstrapLegacyRecommendationCache(vaultPath, scores);
  return projectedRecommendationEpisodes(vaultPath);
}

export function recommendationPresentation(episode: RecommendationEpisode): RecommendationPresentation {
  return {
    episode_id: episode.id,
    batch_id: episode.batch_id,
    recommended_at: episode.recommended_at,
    rank: episode.rank,
    why_now: episode.why_now,
    triggers: episode.triggers,
    is_resurface: episode.is_resurface,
    previous_recommended_at: episode.previous_recommended_at,
  };
}

export function currentRecommendationPresentations(vaultPath: string): Map<string, RecommendationPresentation> {
  return new Map(projectedRecommendationEpisodes(vaultPath).map((episode) => (
    [episode.artifact_id, recommendationPresentation(episode)]
  )));
}

/** Add recommendation context without changing markdown or score/order semantics. */
export function attachCurrentRecommendations<T extends LibraryArtifact>(vaultPath: string, items: T[]): T[] {
  const byArtifact = currentRecommendationPresentations(vaultPath);
  return items.map((item) => {
    const recommendation = byArtifact.get(item.id);
    return recommendation ? { ...item, recommendation } : item;
  });
}

function materializeRecommendation(item: RecommendedArtifact, episode: RecommendationEpisode): RecommendedArtifact {
  return {
    ...item,
    why: episode.why_now,
    worth: episode.scores.worth,
    relevance: episode.scores.relevance,
    substance: episode.scores.substance,
    freshness: episode.scores.freshness,
    recommendation: recommendationPresentation(episode),
  };
}

function matchesFeedOptions(item: RecommendedArtifact, options: RecommendationFeedOptions): boolean {
  if (options.source && item.source_id !== options.source) return false;
  if (options.channel && item.channel !== options.channel) return false;
  if (options.status && item.lifecycle_status !== options.status) return false;
  if (options.mode && item.library_mode !== options.mode) return false;
  if (options.tag && !item.tags.includes(options.tag) && !item.source_tags.includes(options.tag)) return false;
  if (options.content_type && contentTypeForArtifact(item) !== options.content_type) return false;
  if (options.q) {
    const q = options.q.trim().toLowerCase();
    if (q && ![item.title, item.summary, item.why, item.source_name, item.author, ...item.tags]
      .filter(Boolean).join(" ").toLowerCase().includes(q)) return false;
  }
  return true;
}

function encodeCursor(episode: RecommendationEpisode): string {
  return Buffer.from(JSON.stringify({ at: episode.recommended_at, rank: episode.rank, id: episode.id })).toString("base64url");
}

function cursorIndex(episodes: RecommendationEpisode[], cursor?: string | null): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf-8")) as { id?: string };
    const index = episodes.findIndex((episode) => episode.id === parsed.id);
    return index >= 0 ? index + 1 : 0;
  } catch {
    return 0;
  }
}

export function getRecommendationFeed(vaultPath: string, options: RecommendationFeedOptions = {}): RecommendationFeedResult {
  // Score order is only used for one-time rollout/bootstrap candidate selection. Once episodes
  // exist, their immutable recommendation time/rank is the sole feed ordering authority.
  const scored = evaluateLibrary(vaultPath, { limit: 3000 })
    .sort((a, b) => (b.worth || 0) - (a.worth || 0) || b.created_at.localeCompare(a.created_at));
  const byId = new Map(scored.map((item) => [item.id, item]));
  const projected = ensureRecommendationProjection(vaultPath, scored)
    .filter((episode) => byId.has(episode.artifact_id));
  const materialized = projected
    .map((episode) => materializeRecommendation(byId.get(episode.artifact_id)!, episode))
    .filter((item) => matchesFeedOptions(item, options));
  const episodeByItem = new Map(materialized.map((item) => [item.id, item.recommendation!.episode_id]));
  const filteredEpisodes = projected.filter((episode) => episodeByItem.get(episode.artifact_id) === episode.id);
  const start = cursorIndex(filteredEpisodes, options.cursor);
  const limit = Math.max(1, Math.min(100, options.limit || 40));
  const pageEpisodes = filteredEpisodes.slice(start, start + limit);
  const pageIds = new Set(pageEpisodes.map((episode) => episode.id));
  const items = materialized.filter((item) => pageIds.has(item.recommendation!.episode_id));
  const last = pageEpisodes.at(-1);
  const runtime = readRecommendationRuntime(vaultPath);
  return {
    items,
    total: materialized.length,
    cursor: options.cursor || null,
    next_cursor: start + pageEpisodes.length < filteredEpisodes.length && last ? encodeCursor(last) : null,
    generated_at: runtime.last_success_at || new Date().toISOString(),
    context_summary: "Editorial recommendation episodes ordered by when they were selected; only a new episode can move an item.",
    batch: runtime.last_batch_id && runtime.last_success_at
      ? {
          id: runtime.last_batch_id,
          generated_at: runtime.last_success_at,
          size: runtime.last_batch_size,
          kind: runtime.last_run_kind,
        }
      : null,
  };
}

export function getRecommendationEpisodeArtifacts(vaultPath: string, episodeIds: string[]): RecommendedArtifact[] {
  const episodes = recommendationEpisodesById(vaultPath, episodeIds);
  const scored = evaluateLibrary(vaultPath, { limit: 3000 });
  const byId = new Map(scored.map((item) => [item.id, item]));
  return episodes
    .map((episode) => {
      const item = byId.get(episode.artifact_id);
      return item ? materializeRecommendation(item, episode) : null;
    })
    .filter((item): item is RecommendedArtifact => Boolean(item));
}

/** Compatibility wrapper for scripts and callers that still pass a numeric limit. */
export function getRecommendations(vaultPath: string, limit = 10): RecommendationFeedResult {
  return getRecommendationFeed(vaultPath, { limit });
}
