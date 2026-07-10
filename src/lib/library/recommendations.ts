import fs from "fs";
import path from "path";
import type { ConnectionSuggestion, LibraryArtifactDetail, LibraryEvalAttrs, RecommendedArtifact } from "./types";
import { listLibraryArtifactDetails } from "./library";
import { markdownToPlain } from "./markdown";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import { buildSemanticContext, scoreArtifactSemantic, type SemanticContext } from "./semantic-relevance";
import { loadScoringConfig } from "./scoring-config-loader";
import type { LibraryScoringConfig } from "./scoring-config";
import { readLibraryEvents } from "./events";
import { hashId } from "./utils";
import { captureFailed } from "./capture-health";
import { connectionSuggestionsFromFrontmatter, hasConnectionPass } from "./connection-state";

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
    .filter((artifact) => !artifact.processing || artifact.processing.state === "ready")
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
    .filter((artifact) => !artifact.processing || artifact.processing.state === "ready")
    .map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx, config));
}

/** Eval attributes for a single study item (for the detail metadata panel). null for keep items. */
export function evalAttrsForArtifact(vaultPath: string, artifact: LibraryArtifactDetail): LibraryEvalAttrs | null {
  if (artifact.library_mode === "keep" || (artifact.processing && artifact.processing.state !== "ready")) return null;
  const { artifacts: all, signals, config } = sharedScoringInputs(vaultPath);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  const scored = scoreArtifact(vaultPath, artifact, signals, semanticCtx, config);
  return { worth: scored.worth, relevance: scored.relevance, substance: scored.substance, freshness: scored.freshness, lifecycle: scored.lifecycle, why: scored.why };
}

// ---------------------------------------------------------------------------
// For You v2 — the staged funnel (Library v2, Workstream 4):
//   stage 1 (cheap, here): worth-ranked pool minus recent negative signals;
//   stage 2 (LLM): the daily editor pass (scripts/library-editor-pass.ts) picks with stated reasons,
//     cached in DATA_DIR and consumed below — the formula proposes, the editor disposes;
//   stage 3 (deterministic, here): source-diversity cap, near-duplicate dedup, exploration slot.
// ---------------------------------------------------------------------------

export interface EditorPick { id: string; reason: string }
export interface EditorPicksCache { generated_at: string; picks: EditorPick[] }

export function editorPicksPath(vaultPath: string): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-for-you", `${hashId(path.resolve(vaultPath), 16)}.json`);
}

/** The cached editor picks, or null when absent/stale (>30h — one missed daily run is tolerated). */
export function readEditorPicks(vaultPath: string, maxAgeHours = 30): EditorPicksCache | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(editorPicksPath(vaultPath), "utf-8")) as EditorPicksCache;
    if (!parsed || !Array.isArray(parsed.picks)) return null;
    const age = Date.now() - Date.parse(parsed.generated_at);
    return Number.isFinite(age) && age <= maxAgeHours * 3_600_000 ? parsed : null;
  } catch {
    return null;
  }
}

/** Stage 1: the worth-ranked candidate pool minus recently negatively-signaled items (skip /
 *  archive-confirm within the suppression window — the heaviest-weighted signals we have). */
export function buildForYouPool(vaultPath: string): { pool: RecommendedArtifact[]; config: LibraryScoringConfig } {
  const config = loadScoringConfig(vaultPath);
  const since = new Date(Date.now() - config.for_you.negative_suppress_days * 86_400_000).toISOString();
  const negative = new Set(
    readLibraryEvents(vaultPath, { since })
      .filter((event) => event.type === "skipped" || event.type === "archived_confirmed")
      .map((event) => event.artifact_id),
  );
  // Full study corpus (not a recency window): the exploration slot exists to resurface items the
  // ranking under-values, which a newest-200 pre-cut would silently defeat.
  const pool = evaluateLibrary(vaultPath, { limit: 3000 })
    .sort((a, b) => (b.worth || 0) - (a.worth || 0))
    .filter((item) => !negative.has(item.id))
    // A stub-graded item must never be recommended — its digest may describe a cover blurb.
    .filter((item) => item.lifecycle !== "needs_refetch")
    .slice(0, config.for_you.pool);
  return { pool, config };
}

function titleTokenSet(title: string): Set<string> {
  return new Set(tokenize(title));
}

/** Near-duplicate titles (the same story from two sources) — Jaccard over title tokens. */
function nearDuplicate(a: string, b: string): boolean {
  const ta = titleTokenSet(a);
  const tb = titleTokenSet(b);
  if (!ta.size || !tb.size) return false;
  const overlap = [...ta].filter((token) => tb.has(token)).length;
  return overlap / (ta.size + tb.size - overlap) > 0.6;
}

export function getRecommendations(vaultPath: string, limit = 10): { items: RecommendedArtifact[]; generated_at: string; context_summary: string } {
  const { pool, config } = buildForYouPool(vaultPath);
  const maxItems = Math.max(1, Math.min(limit, config.for_you.max_items));
  const explorationSlots = Math.min(config.for_you.exploration_slots, Math.max(0, maxItems - 1));
  const headSlots = maxItems - explorationSlots;
  const editor = readEditorPicks(vaultPath);
  const byId = new Map(pool.map((item) => [item.id, item]));

  const final: RecommendedArtifact[] = [];
  const used = new Set<string>();
  const sourceCounts = new Map<string, number>();
  const tryAdd = (item: RecommendedArtifact, reason?: string): boolean => {
    if (used.has(item.id)) return false;
    const source = item.source_id || "unknown";
    if ((sourceCounts.get(source) || 0) >= config.for_you.source_cap) return false;
    if (final.some((picked) => nearDuplicate(picked.title, item.title))) return false;
    used.add(item.id);
    sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1);
    // The stated reason is the user-facing "why" (zero "why am I seeing this" — spec success gate).
    final.push(reason ? { ...item, why: reason } : item);
    return true;
  };

  // Stage 2 picks lead; stage 1 order fills the remaining head slots when the editor is absent/stale.
  if (editor) {
    for (const pick of editor.picks) {
      if (final.length >= headSlots) break;
      const item = byId.get(pick.id);
      if (item) tryAdd(item, pick.reason);
    }
  }
  for (const item of pool) {
    if (final.length >= headSlots) break;
    tryAdd(item);
  }

  // Stage 3 exploration: rotate daily through the tail beyond the head ranks — how miscalibration
  // gets discovered (an item the formula under-ranks gets a periodic shot at the user's attention).
  const tail = pool.slice(headSlots);
  if (tail.length && explorationSlots > 0) {
    const dayIndex = Math.floor(Date.now() / 86_400_000);
    for (let slot = 0; slot < explorationSlots && final.length < maxItems; slot += 1) {
      for (let probe = 0; probe < tail.length; probe += 1) {
        const item = tail[(dayIndex + slot + probe) % tail.length];
        if (tryAdd(item, "Exploration pick — ranked outside the top; flag it if the library misjudged it")) break;
      }
    }
  }
  // Backfill if exploration couldn't place (deduped/capped out).
  for (const item of pool) {
    if (final.length >= maxItems) break;
    tryAdd(item);
  }

  return {
    items: final,
    generated_at: new Date().toISOString(),
    context_summary: editor
      ? "Editor's picks (daily LLM pass over the worth-ranked pool) with stated reasons, plus diversity rules and an exploration slot."
      : "Worth-ranked (relevance × substance × freshness) with diversity rules and an exploration slot — no fresh editor pass.",
  };
}
