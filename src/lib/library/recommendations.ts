import fs from "fs";
import path from "path";
import type {
  ConnectionSuggestion,
  LibraryArtifact,
  LibraryArtifactDetail,
  LibraryContextEvidence,
  LibraryEvalAttrs,
  RecommendationBatchKind,
  RecommendationEpisode,
  RecommendationEpisodeScores,
  RecommendationPresentation,
  RecommendedArtifact,
} from "./types";
import { listLibraryArtifactDetails } from "./library";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import {
  LIBRARY_SCORING_METHOD,
  scoreExplicitContextHybrid,
  tokenizeHybridText,
  type HybridContextSignal,
} from "./hybrid-relevance";
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
import { walkMarkdown } from "./utils";

// For You sizing now lives in the versioned scoring config (meta/library-scoring.json).

function readTextIfExists(filePath: string, max = 1800): string {
  try {
    return fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8")
        .replace(/^---\s*[\s\S]*?\s*---\s*/m, "")
        .replace(/```[\s\S]*?```/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
      : "";
  } catch {
    return "";
  }
}

function signalFromFile(
  vaultPath: string,
  filePath: string,
  kind: HybridContextSignal["kind"],
  weight: number,
  textOverride?: string,
): HybridContextSignal | null {
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    const text = textOverride || readTextIfExists(filePath);
    if (!text) return null;
    const relative = path.relative(vaultPath, filePath).split(path.sep).join("/");
    return {
      id: `${kind}:${relative}`,
      kind,
      label: raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || path.basename(filePath, ".md"),
      target: relative.replace(/\/index\.md$/, "").replace(/\.md$/, ""),
      text,
      weight,
    };
  } catch {
    return null;
  }
}

function folderSignals(
  vaultPath: string,
  folder: string,
  kind: HybridContextSignal["kind"],
  weight: number,
  limit: number,
): HybridContextSignal[] {
  const root = path.join(vaultPath, folder);
  return walkMarkdown(root, { includeHidden: false })
    .filter((filePath) => path.basename(filePath) === "index.md" || path.dirname(filePath) === root)
    .sort()
    .slice(0, limit)
    .map((filePath) => signalFromFile(vaultPath, filePath, kind, weight))
    .filter((signal): signal is HybridContextSignal => Boolean(signal));
}

function currentTaskSignals(vaultPath: string, taskWeight: number): HybridContextSignal[] {
  const listsDir = path.join(vaultPath, "lists", "now");
  const latest = fs.existsSync(listsDir)
    ? fs.readdirSync(listsDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort().pop()
    : null;
  if (!latest) return [];
  const filePath = path.join(listsDir, latest);
  let raw = "";
  try { raw = fs.readFileSync(filePath, "utf-8"); } catch { return []; }
  const unchecked = raw
    .split(/\r?\n/)
    .filter((line) => /^\s*[-*]\s+\[\s*]\s+/.test(line))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1800);
  const signal = signalFromFile(vaultPath, filePath, "task", taskWeight, unchecked || undefined);
  return signal ? [{ ...signal, target: null }] : [];
}

function activeContextSignals(vaultPath: string, config: LibraryScoringConfig): HybridContextSignal[] {
  const weights = config.signal_weights;
  return [
    ...folderSignals(vaultPath, "projects", "project", weights.project, 100),
    ...currentTaskSignals(vaultPath, weights.task),
    ...folderSignals(vaultPath, "areas", "area", weights.area, 60),
    ...folderSignals(vaultPath, "people", "person", weights.person, 100),
  ];
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
 * "For You" = the L3 eval applied across the library. Current fit comes from readable Connections
 * plus deterministic active-context evidence; we surface the legible `why` and drop archive-tier items.
 * The eval is dynamic — recomputed each call against the current active context, never stamped.
 */
function scoreArtifact(
  artifact: LibraryArtifactDetail,
  contextEvidence: LibraryContextEvidence,
  config: LibraryScoringConfig,
  now: Date,
): RecommendedArtifact {
  const fm = artifact.raw_frontmatter;
  // Capture health (shared predicate, capture-health.ts): failed captures route to needs_refetch
  // instead of ever being graded/archive-flagged (user ruling, steering round 1). A warm digestion
  // alone does NOT trigger — warm items often carry real partial content and stay gradable.
  const extractionOk = !captureFailed({ body: artifact.content, frontmatter: fm });
  const evaluation = evaluateArtifact({
    connections: connectionSuggestionsForArtifact(artifact),
    contextFit: contextEvidence.context_score,
    contextLabel: contextEvidence.matched_signals[0]?.label || contextEvidence.active_connection_targets[0]?.label || null,
    createdAt: artifact.created_at,
    substance: substanceFor(artifact),
    extraction_ok: extractionOk,
    // Positive evidence we looked, including older v2.2 abstentions whose only marker is the
    // attention_judgment stamped by the reweave pass.
    analyzed: hasConnectionPass(artifact.raw_frontmatter),
  }, config, now);
  const evalAttrs: LibraryEvalAttrs = {
    worth: evaluation.worth,
    relevance: evaluation.relevance,
    substance: evaluation.substance,
    freshness: evaluation.freshness,
    lifecycle: evaluation.lifecycle,
    why: evaluation.why,
    scoring_method: LIBRARY_SCORING_METHOD,
    scoring_config_version: config.version,
    context_evidence: contextEvidence,
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
    matched_terms: contextEvidence.matched_terms,
  };
}

/**
 * Score every study item against the current active context — worth = relevance × substance × freshness.
 * Cheap/structural (no model calls). Powers For You, the inspection report, and the workbench list API.
 */
// --- Shared-input cache (Plan 004) -----------------------------------------
// The full artifact load + hybrid score map are the dominant per-call
// cost shared by the scoring entry points below — evalAttrsForArtifact in
// particular loaded all ~3000 artifacts just to score one detail-pane item.
// Cache the (artifacts, scores, config) bundle briefly so an interaction
// burst (a feed render + a detail-pane open + worth-slider drags) reloads once.
// Invalidation: keyed on vaultPath + the references/candidates directory
// mtimes (an add, remove, or atomic temp+rename write bumps the dir mtime),
// with a short TTL ceiling as a backstop. Scores are unchanged — only how the
// shared inputs are obtained changes.
type SharedScoringInputs = {
  artifacts: LibraryArtifactDetail[];
  scoresById: Map<string, RecommendedArtifact>;
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

const FULL_LIBRARY_CORPUS_LIMIT = 100_000;

function eligibleForScoring(artifact: LibraryArtifactDetail): boolean {
  return artifact.lifecycle_status !== "expired"
    && artifact.lifecycle_status !== "skipped"
    && artifactReadyForEvaluation(artifact)
    && artifact.library_mode !== "keep";
}

function loadSharedScoringInputs(vaultPath: string): SharedScoringInputs {
  const config = loadScoringConfig(vaultPath);
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: FULL_LIBRARY_CORPUS_LIMIT, includeCandidates: true }).artifacts;
  const eligible = artifacts.filter(eligibleForScoring);
  const signals = activeContextSignals(vaultPath, config);
  const evidenceById = scoreExplicitContextHybrid(eligible, signals, config);
  const now = new Date();
  const scoresById = new Map(eligible.map((artifact) => {
    const evidence = evidenceById.get(artifact.id);
    if (!evidence) throw new Error(`Missing hybrid evidence for ${artifact.id}`);
    return [artifact.id, scoreArtifact(artifact, evidence, config, now)];
  }));
  return { artifacts, scoresById, config };
}

function sharedScoringInputs(vaultPath: string): SharedScoringInputs {
  const key = `${vaultPath}::${libraryDirFingerprint(vaultPath)}`;
  const now = Date.now();
  if (sharedInputsCache && sharedInputsCache.key === key && now - sharedInputsCache.at < SHARED_INPUTS_TTL_MS) {
    return sharedInputsCache.value;
  }
  const value = loadSharedScoringInputs(vaultPath);
  sharedInputsCache = { key, at: now, value };
  return value;
}

export function evaluateLibrary(vaultPath: string, opts: { limit?: number } = {}): RecommendedArtifact[] {
  const { artifacts, scoresById } = sharedScoringInputs(vaultPath);
  const scored = artifacts
    .map((artifact) => scoresById.get(artifact.id))
    .filter((artifact): artifact is RecommendedArtifact => Boolean(artifact));
  return opts.limit === undefined ? scored : scored.slice(0, Math.max(0, opts.limit));
}

/** Score a given list of artifacts against the active context — signals built once. Used by the feed's
 *  eval-filter path (worth slider, lifecycle) so it filters the already-source/pipeline-filtered set. */
export function scoreArtifacts(vaultPath: string, artifacts: LibraryArtifactDetail[]): RecommendedArtifact[] {
  const { scoresById } = sharedScoringInputs(vaultPath);
  return artifacts
    .map((artifact) => scoresById.get(artifact.id))
    .filter((artifact): artifact is RecommendedArtifact => Boolean(artifact));
}

/** Eval attributes for a single study item (for the detail metadata panel). null for keep items. */
export function evalAttrsForArtifact(vaultPath: string, artifact: LibraryArtifactDetail): LibraryEvalAttrs | null {
  if (artifact.library_mode === "keep" || !artifactReadyForEvaluation(artifact)) return null;
  const scored = sharedScoringInputs(vaultPath).scoresById.get(artifact.id);
  return scored?.eval_attrs ? { ...scored.eval_attrs } : null;
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
  const pool = evaluateLibrary(vaultPath)
    .sort((a, b) => (b.worth || 0) - (a.worth || 0))
    .filter((item) => !negative.has(item.id))
    // A stub-graded item must never be recommended — its digest may describe a cover blurb.
    .filter((item) => item.lifecycle !== "needs_refetch");
  return { pool, config };
}

function titleTokenSet(title: string): Set<string> {
  return new Set(tokenizeHybridText(title));
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
    selection_scores: { ...episode.scores },
    scoring_method: episode.scoring_method,
    scoring_config_version: episode.scoring_config_version,
    editor_model: episode.editor_model,
    editor_prompt_version: episode.editor_prompt_version,
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
    if (q && ![item.title, item.summary, item.why, item.recommendation?.why_now, item.source_name, item.author, ...item.tags]
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
  const scored = evaluateLibrary(vaultPath)
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
  const scored = evaluateLibrary(vaultPath);
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
