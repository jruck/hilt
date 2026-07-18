import { attentionJudgmentFromFrontmatter, connectionSuggestionsFromFrontmatter } from "./connection-state";
import { connectionContribution } from "./library-eval";
import { DEFAULT_SCORING_CONFIG, type LibraryScoringConfig } from "./scoring-config";
import type {
  LibraryArtifactDetail,
  LibraryContextEvidence,
  LibraryScoringMethod,
} from "./types";

export const LIBRARY_SCORING_METHOD: LibraryScoringMethod = "explicit_context_hybrid";

export type HybridContextSignalKind = "task" | "project" | "area" | "person";

export interface HybridContextSignal {
  id: string;
  kind: HybridContextSignalKind;
  label: string;
  target: string | null;
  text: string;
  weight: number;
}

export interface BoundedLexicalMatch {
  signal: HybridContextSignal;
  score: number;
  terms: string[];
}

export interface BoundedLexicalFit {
  score: number;
  raw: number;
  label: string | null;
  matchedTerms: string[];
  matches: BoundedLexicalMatch[];
}

const STOPWORDS = new Set([
  "about", "active", "after", "again", "also", "and", "any", "are", "because", "been", "before", "being",
  "between", "both", "build", "built", "can", "check", "code", "context", "could", "does", "doing", "each",
  "everything", "first", "for", "from", "gives", "have", "how", "index", "into", "just", "like", "longer",
  "more", "most", "new", "only", "operating", "other", "over", "personal", "projects", "related", "should",
  "some", "state", "system", "that", "the", "their", "them", "there", "these", "they", "this", "through",
  "today", "type", "using", "very", "want", "what", "when", "where", "which", "while", "with", "would", "your",
  "reference", "library", "libraries", "candidate", "saved", "article", "content", "created", "description", "format",
  "source", "summary", "title", "meeting", "meetings", "notes", "team", "work", "model", "models", "meta",
]);

export function tokenizeHybridText(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function uniqueTokens(text: string): string[] {
  return [...new Set(tokenizeHybridText(text))];
}

interface Bm25Document {
  artifact: LibraryArtifactDetail;
  termFrequency: Map<string, number>;
  length: number;
}

function bm25Documents(
  artifacts: LibraryArtifactDetail[],
  config: LibraryScoringConfig,
): Bm25Document[] {
  const weights = config.hybrid;
  return artifacts.map((artifact) => {
    const fields: Array<[string, number]> = [
      [artifact.title || "", weights.title_weight],
      [[artifact.summary || "", ...artifact.tags, ...artifact.source_tags].join(" "), weights.summary_tags_weight],
      [artifact.content || "", weights.body_weight],
    ];
    const termFrequency = new Map<string, number>();
    let length = 0;
    for (const [text, weight] of fields) {
      for (const token of tokenizeHybridText(text)) {
        termFrequency.set(token, (termFrequency.get(token) || 0) + weight);
        length += weight;
      }
    }
    return { artifact, termFrequency, length: Math.max(1, length) };
  });
}

/**
 * Pure BM25F scorer evaluated over the complete eligible Library corpus. Its output is meaningful
 * only as one shared map: the corpus-wide document frequencies and p95 denominator must not be
 * recomputed for a filtered list or detail view.
 */
export function scoreBoundedLexical(
  artifacts: LibraryArtifactDetail[],
  signals: HybridContextSignal[],
  config: LibraryScoringConfig = DEFAULT_SCORING_CONFIG,
): Map<string, BoundedLexicalFit> {
  const docs = bm25Documents(artifacts, config);
  const n = Math.max(1, docs.length);
  const averageLength = docs.reduce((sum, doc) => sum + doc.length, 0) / n;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.termFrequency.keys()) {
      documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
    }
  }

  const h = config.hybrid;
  const preparedSignals = signals.map((signal) => ({ signal, terms: uniqueTokens(signal.text) }));
  const rawByArtifact = new Map<string, Omit<BoundedLexicalFit, "score">>();
  const maximumDocumentCount = Math.max(1, Math.floor(n * h.max_document_frequency));
  for (const doc of docs) {
    const matches: BoundedLexicalMatch[] = [];
    for (const prepared of preparedSignals) {
      const { signal } = prepared;
      const terms = prepared.terms.filter((term) => (
        doc.termFrequency.has(term)
        && (documentFrequency.get(term) || 0) <= maximumDocumentCount
      ));
      const minimum = signal.kind === "task" || signal.kind === "project"
        ? h.task_project_min_terms
        : h.other_min_terms;
      if (terms.length < minimum) continue;

      let score = 0;
      for (const term of terms) {
        const df = documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const tf = doc.termFrequency.get(term) || 0;
        const denominator = tf + h.k1 * (1 - h.b + h.b * (doc.length / Math.max(1, averageLength)));
        score += idf * ((tf * (h.k1 + 1)) / Math.max(1e-9, denominator));
      }
      matches.push({ signal, score: score * signal.weight, terms: terms.slice(0, 10) });
    }

    matches.sort((left, right) => right.score - left.score || left.signal.id.localeCompare(right.signal.id));
    const raw = (matches[0]?.score || 0) + h.second_match_weight * (matches[1]?.score || 0);
    rawByArtifact.set(doc.artifact.id, {
      raw,
      label: matches[0]?.signal.label || null,
      matchedTerms: [...new Set(matches.slice(0, 2).flatMap((match) => match.terms))].slice(0, 10),
      matches,
    });
  }

  const positives = [...rawByArtifact.values()]
    .map((value) => value.raw)
    .filter((value) => value > 0)
    .sort((left, right) => left - right);
  const percentileIndex = positives.length
    ? Math.min(positives.length - 1, Math.floor((positives.length - 1) * h.normalization_percentile))
    : 0;
  const normalizationValue = positives.length ? positives[percentileIndex] : 1;
  const cap = config.relevance.context_fit_cap;
  return new Map([...rawByArtifact].map(([artifactId, value]) => [artifactId, {
    ...value,
    score: Number(Math.min(cap, value.raw > 0 ? (value.raw / Math.max(1e-9, normalizationValue)) * cap : 0).toFixed(3)),
  }]));
}

function normalizeTarget(value: string | null | undefined): string {
  return String(value || "")
    .trim()
    .replace(/^\.\//, "")
    .replace(/\/index\.md$/, "")
    .replace(/\.md$/, "")
    .replace(/^\/+|\/+$/g, "");
}

export function targetIsActive(target: string | null | undefined, activeTargets: Set<string>): boolean {
  const normalized = normalizeTarget(target);
  if (!normalized) return false;
  return activeTargets.has(normalized) || [...activeTargets].some((active) => (
    active.endsWith(`/${normalized}`) || normalized.endsWith(`/${active}`)
  ));
}

export function attentionAdjustment(
  tier: "high" | "medium" | "low" | null,
  config: LibraryScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  if (tier === "high") return config.hybrid.attention_high_adjustment;
  if (tier === "medium") return config.hybrid.attention_medium_adjustment;
  if (tier === "low") return config.hybrid.attention_low_adjustment;
  return 0;
}

export function explicitContextHybridScore(
  lexicalScore: number,
  activeConnection: boolean,
  attentionTier: "high" | "medium" | "low" | null,
  config: LibraryScoringConfig = DEFAULT_SCORING_CONFIG,
): number {
  const cap = config.relevance.context_fit_cap;
  const score = lexicalScore
    + (activeConnection ? config.hybrid.active_connection_boost : 0)
    + attentionAdjustment(attentionTier, config);
  return Number(Math.max(0, Math.min(cap, score)).toFixed(3));
}

/** Build one immutable evidence map for all eligible artifacts in a scoring run. */
export function scoreExplicitContextHybrid(
  artifacts: LibraryArtifactDetail[],
  signals: HybridContextSignal[],
  config: LibraryScoringConfig = DEFAULT_SCORING_CONFIG,
): Map<string, LibraryContextEvidence> {
  const lexical = scoreBoundedLexical(artifacts, signals, config);
  const activeTargets = new Set(
    signals
      .filter((signal) => signal.kind !== "task")
      .map((signal) => normalizeTarget(signal.target))
      .filter(Boolean),
  );
  const cap = config.relevance.context_fit_cap;

  return new Map(artifacts.map((artifact) => {
    const fit = lexical.get(artifact.id) || { score: 0, raw: 0, label: null, matchedTerms: [], matches: [] };
    const connections = connectionSuggestionsFromFrontmatter(artifact.raw_frontmatter);
    const activeConnections = connections
      .filter((connection) => targetIsActive(connection.target, activeTargets))
      .map((connection) => ({ target: normalizeTarget(connection.target), label: connection.label }))
      .filter((connection, index, rows) => rows.findIndex((row) => row.target === connection.target) === index);
    const attention = attentionJudgmentFromFrontmatter(artifact.raw_frontmatter);
    const adjustment = attentionAdjustment(attention?.tier || null, config);
    const activeBoost = activeConnections.length ? config.hybrid.active_connection_boost : 0;
    const unclamped = fit.score + activeBoost + adjustment;
    const contextScore = explicitContextHybridScore(fit.score, activeConnections.length > 0, attention?.tier || null, config);
    const evidence: LibraryContextEvidence = {
      method: LIBRARY_SCORING_METHOD,
      scoring_config_version: config.version,
      connection_score: Number(connectionContribution(connections, config).toFixed(3)),
      lexical_score: fit.score,
      matched_signals: fit.matches.slice(0, 2).map((match) => ({
        kind: match.signal.kind,
        label: match.signal.label,
        target: match.signal.target,
        matched_terms: match.terms,
      })),
      matched_terms: fit.matchedTerms,
      active_connection_targets: activeConnections,
      active_connection_boost: activeBoost,
      attention_tier: attention?.tier || null,
      attention_adjustment: adjustment,
      ...(attention?.reason ? { attention_reason: attention.reason } : {}),
      context_score: contextScore,
      context_capped: unclamped > cap,
    };
    return [artifact.id, evidence];
  }));
}
