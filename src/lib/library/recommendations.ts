import fs from "fs";
import path from "path";
import type { ConnectionSuggestion, LibraryArtifactDetail, LibraryEvalAttrs, RecommendedArtifact } from "./types";
import { listLibraryArtifactDetails } from "./library";
import { markdownToPlain } from "./markdown";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import { buildSemanticContext, scoreArtifactSemantic, type SemanticContext } from "./semantic-relevance";

interface ContextSignal {
  kind: "project" | "task" | "area" | "person" | "recent_save";
  label: string;
  text: string;
  weight: number;
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

const FOR_YOU_MAX_ITEMS = 8;

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

function currentTaskSignals(vaultPath: string): ContextSignal[] {
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
  return [{ kind: "task", label: latest || "current week", text: uncheckedTasks || weekly, weight: 1.35 }];
}

function recentSaveSignals(artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  return artifacts
    .filter((artifact) => artifact.lifecycle_status === "saved")
    .slice(0, 20)
    .map((artifact) => ({
      kind: "recent_save" as const,
      label: artifact.title,
      text: [artifact.title, artifact.summary, artifact.tags.join(" "), artifact.source_tags.join(" "), artifact.source_collection, artifact.source_folder].filter(Boolean).join("\n"),
      weight: artifact.source_id === "manual" ? 0.65 : 0.45,
    }));
}

function activeContextSignals(vaultPath: string, artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  const areaText = readTextIfExists(path.join(vaultPath, "areas", "index.md"));
  return [
    ...readFolderIndexSignals(vaultPath, "projects", "project", 1.25, 80),
    ...currentTaskSignals(vaultPath),
    ...(areaText ? [{ kind: "area" as const, label: "North Stars", text: areaText, weight: 1.0 }] : []),
    ...readFolderIndexSignals(vaultPath, "people", "person", 0.35, 80),
    ...recentSaveSignals(artifacts),
  ];
}

function tokenize(text: string): string[] {
  return Array.from(new Set((text.toLowerCase().match(/[a-z0-9][a-z0-9-]{3,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 4 && !STOPWORDS.has(word))));
}

/** @internal Exposed for the calibration/diagnostic scripts (token contextFit head-to-head). */
export function __debugActiveContextSignals(vaultPath: string, artifacts: LibraryArtifactDetail[]): ContextSignal[] {
  return activeContextSignals(vaultPath, artifacts);
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
    const signalTokens = tokenize(signal.text);
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
  return Array.isArray(artifact.raw_frontmatter.connection_suggestions)
    ? artifact.raw_frontmatter.connection_suggestions.filter((item): item is ConnectionSuggestion => Boolean(item && typeof item === "object" && typeof (item as ConnectionSuggestion).label === "string"))
    : [];
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
function scoreArtifact(vaultPath: string, artifact: LibraryArtifactDetail, signals: ContextSignal[], semanticCtx: SemanticContext): RecommendedArtifact {
  const contextScore = scoreAgainstSignals(artifact, signals);
  const topContext = contextScore.matches.find((match) => match.kind !== "recent_save");
  // Topical fit: PREFER embedding cosine, fall back to token-overlap. Measured on the real
  // vault (scripts/library-semantic-headtohead.ts): the token-overlap fit sums across ~80
  // active-context signals UNCAPPED (mean ~1.37, 97% ≥0.45), so it saturates the eval's 0.3
  // relevance cap for ~everyone — it differentiates nothing. The embedding cosine fit (mean
  // ~0.20, a real 0→0.45 gradient) is the signal that actually separates on-topic from not.
  // So for embedded items (saved refs) we REPLACE token with semantic; candidates aren't
  // embedded (semantic === null) and keep the token fallback — the best available there.
  const semantic = scoreArtifactSemantic(vaultPath, artifact, semanticCtx);
  let contextFit = contextScore.score;
  let contextLabel = topContext?.label ?? null;
  if (semantic) {
    contextFit = semantic.score;
    contextLabel = semantic.label ?? contextLabel;
  }
  const evaluation = evaluateArtifact({
    connections: connectionSuggestionsForArtifact(artifact),
    contextFit,
    contextLabel,
    createdAt: artifact.created_at,
    substance: substanceFor(artifact),
    // `reconnected_at` is stamped whenever the connection judge runs (success OR abstain) — positive
    // evidence we looked, the precondition for ever flagging a zero-tie item to_archive.
    analyzed: typeof artifact.raw_frontmatter.reconnected_at === "string" && artifact.raw_frontmatter.reconnected_at.length > 0,
  });
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
export function evaluateLibrary(vaultPath: string, opts: { limit?: number } = {}): RecommendedArtifact[] {
  const artifacts = listLibraryArtifactDetails(vaultPath, { limit: opts.limit ?? 3000, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, artifacts);
  const semanticCtx = buildSemanticContext(vaultPath, artifacts);
  return artifacts
    .filter((artifact) => artifact.lifecycle_status !== "expired" && artifact.lifecycle_status !== "skipped")
    // keep is a stash, out of the worth-ranked feed; worth scoring applies only to study items.
    .filter((artifact) => artifact.library_mode !== "keep")
    .map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx));
}

/** Score a given list of artifacts against the active context — signals built once. Used by the feed's
 *  eval-filter path (worth slider, lifecycle) so it filters the already-source/pipeline-filtered set. */
export function scoreArtifacts(vaultPath: string, artifacts: LibraryArtifactDetail[]): RecommendedArtifact[] {
  const all = listLibraryArtifactDetails(vaultPath, { limit: 3000, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, all);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  return artifacts.map((artifact) => scoreArtifact(vaultPath, artifact, signals, semanticCtx));
}

/** Eval attributes for a single study item (for the detail metadata panel). null for keep items. */
export function evalAttrsForArtifact(vaultPath: string, artifact: LibraryArtifactDetail): LibraryEvalAttrs | null {
  if (artifact.library_mode === "keep") return null;
  const all = listLibraryArtifactDetails(vaultPath, { limit: 3000, includeCandidates: true }).artifacts;
  const signals = activeContextSignals(vaultPath, all);
  const semanticCtx = buildSemanticContext(vaultPath, all);
  const scored = scoreArtifact(vaultPath, artifact, signals, semanticCtx);
  return { worth: scored.worth, relevance: scored.relevance, substance: scored.substance, freshness: scored.freshness, lifecycle: scored.lifecycle, why: scored.why };
}

export function getRecommendations(vaultPath: string, limit = 10): { items: RecommendedArtifact[]; generated_at: string; context_summary: string } {
  const effectiveLimit = Math.max(1, Math.min(limit, FOR_YOU_MAX_ITEMS));
  const items = evaluateLibrary(vaultPath, { limit: 200 })
    .sort((a, b) => (b.worth || 0) - (a.worth || 0))
    .slice(0, effectiveLimit);
  return {
    items,
    generated_at: new Date().toISOString(),
    context_summary: "Ranked by worth (relevance × substance × freshness) against active projects, weekly tasks, North Stars, people notes, and recent saves.",
  };
}
