import fs from "node:fs";
import path from "node:path";
import { captureFailed } from "./capture-health";
import {
  attentionJudgmentFromFrontmatter,
  connectionSuggestionsFromFrontmatter,
  hasConnectionPass,
} from "./connection-state";
import { readLibraryEvents, type LibraryEvent } from "./events";
import { evaluateArtifact, structuralSubstance } from "./library-eval";
import { listLibraryArtifactDetails } from "./library";
import {
  buildEditorialCandidatePool,
  recommendationCooldownEligible,
  type RecommendationExposure,
} from "./recommendation-editor";
import { readRecommendationBatches } from "./recommendation-store";
import { buildSemanticContext, scoreArtifactSemantic } from "./semantic-relevance";
import { loadScoringConfig } from "./scoring-config-loader";
import type { LibraryScoringConfig } from "./scoring-config";
import type {
  ConnectionSuggestion,
  LibraryArtifactDetail,
  RecommendationBatch,
  RecommendationEpisode,
  RecommendationTrigger,
  RecommendedArtifact,
} from "./types";
import { hashId, walkMarkdown } from "./utils";

export const BAKEOFF_RESULT_VERSION = 1 as const;
export const BAKEOFF_METHOD_IDS = [
  "semantic",
  "explicit",
  "bounded_lexical",
  "explicit_context_hybrid",
] as const;

export type BakeoffMethodId = typeof BAKEOFF_METHOD_IDS[number];
export type BakeoffFidelity = "exact" | "reconstructed";

export interface BakeoffContextSignal {
  id: string;
  kind: "project" | "task" | "area" | "person";
  label: string;
  target: string | null;
  text: string;
  weight: number;
  occurred_at: string;
  fidelity: BakeoffFidelity;
}

export interface BakeoffEvidence extends RecommendationTrigger {
  text: string;
  fidelity: BakeoffFidelity;
}

export interface BakeoffItemScore {
  artifact_id: string;
  title: string;
  path: string;
  lifecycle_status: string;
  method: BakeoffMethodId;
  context_score: number;
  relevance: number;
  worth: number;
  substance: number;
  freshness: number;
  lifecycle: string;
  rank: number;
  matched_terms: string[];
  explanation: string;
  reconstructed: boolean;
}

export interface BakeoffActualPick {
  episode_id: string;
  artifact_id: string;
  title: string | null;
  rank: number;
  why_now: string;
  scores: RecommendationEpisode["scores"];
}

export interface BakeoffEditorPick {
  artifact_id: string;
  title: string;
  reason: string;
  trigger_ids: string[];
  rank: number;
}

export interface BakeoffMethodCheckpoint {
  method: BakeoffMethodId;
  scores: BakeoffItemScore[];
  candidate_ids: string[];
  actual_pick_candidate_count: number;
  to_archive_count: number;
  editor_picks: BakeoffEditorPick[];
  briefing_picks: BakeoffEditorPick[];
  editor_error?: string | null;
}

export interface BakeoffCheckpointResult {
  checkpoint_at: string;
  batch_id: string;
  kind: string;
  historical_pool_size: number;
  artifact_count: number;
  context_signal_count: number;
  exact_evidence_count: number;
  reconstructed_evidence_count: number;
  actual_picks: BakeoffActualPick[];
  methods: Record<BakeoffMethodId, BakeoffMethodCheckpoint>;
  briefing_date: string | null;
}

export interface BakeoffHistoricalOutcome {
  artifact_id: string;
  checkpoint_at: string;
  opened_72h: boolean;
  read_7d: boolean;
  promoted_7d: boolean;
  skipped_7d: boolean;
  feedback_7d: boolean;
}

export interface BakeoffResults {
  version: typeof BAKEOFF_RESULT_VERSION;
  generated_at: string;
  range: { from: string; through: string };
  checkpoints: BakeoffCheckpointResult[];
  outcomes: BakeoffHistoricalOutcome[];
}

export interface BakeoffCheckpointRuntime {
  result: BakeoffCheckpointResult;
  candidates: Record<BakeoffMethodId, RecommendedArtifact[]>;
  evidence: BakeoffEvidence[];
  previousByArtifact: Map<string, RecommendationEpisode>;
  contextText: string;
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

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .map((word) => word.replace(/^-+|-+$/g, ""))
    .filter((word) => word.length >= 3 && !STOPWORDS.has(word));
}

function uniqueTokens(text: string): string[] {
  return [...new Set(tokenize(text))];
}

function finiteDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function sanitizeArtifactAsOf(artifact: LibraryArtifactDetail, checkpoint: Date): { artifact: LibraryArtifactDetail; reconstructed: boolean } {
  const raw = { ...artifact.raw_frontmatter };
  const derivedAt = finiteDate(raw.reconnected_at) ?? finiteDate(raw.processed_at) ?? finiteDate(raw.updated_at);
  let reconstructed = false;
  if (derivedAt !== null && derivedAt > checkpoint.getTime()) {
    delete raw.connection_suggestions;
    delete raw.connection_reasoning;
    delete raw.reconnected_at;
    delete raw.attention_judgment;
    delete raw.substance;
    reconstructed = true;
  }
  const updatedAt = finiteDate(artifact.updated_at);
  if (updatedAt !== null && updatedAt > checkpoint.getTime()) reconstructed = true;
  return { artifact: { ...artifact, raw_frontmatter: raw }, reconstructed };
}

function sourceSubstance(artifact: LibraryArtifactDetail): number {
  const fm = artifact.raw_frontmatter;
  const graded = typeof fm.substance === "number" ? fm.substance : null;
  if (graded !== null && graded >= 0 && graded <= 1) return graded;
  const sourceChars = Number(fm.extracted_chars || fm.cached_source_chars || 0) || artifact.content?.length || 0;
  return structuralSubstance({
    format: typeof fm.format === "string" ? fm.format : null,
    sourceChars,
    videoDurationSeconds: typeof fm.video_duration_seconds === "number" ? fm.video_duration_seconds : null,
    findingsCount: (artifact.content?.match(/^\s*(?:[-*]|\d+\.)\s+/gm) || []).length,
  });
}

function artifactReady(artifact: LibraryArtifactDetail): boolean {
  return (!artifact.processing || artifact.processing.state === "ready")
    && artifact.raw_frontmatter.reweave_pending !== true
    && artifact.lifecycle_status !== "expired"
    && artifact.lifecycle_status !== "skipped"
    && artifact.library_mode !== "keep";
}

function signalWeight(kind: BakeoffContextSignal["kind"], config: LibraryScoringConfig): number {
  return config.signal_weights[kind];
}

function cleanFileText(raw: string, max = 1800): string {
  return raw
    .replace(/^---\s*[\s\S]*?\s*---\s*/m, "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function fileSignal(
  vaultPath: string,
  filePath: string,
  kind: BakeoffContextSignal["kind"],
  config: LibraryScoringConfig,
  checkpoint: Date,
): BakeoffContextSignal | null {
  try {
    const stat = fs.statSync(filePath);
    const raw = fs.readFileSync(filePath, "utf-8");
    const text = cleanFileText(raw);
    if (!text) return null;
    const relative = path.relative(vaultPath, filePath).split(path.sep).join("/");
    const firstHeading = raw.match(/^#\s+(.+)$/m)?.[1]?.trim();
    return {
      id: `${kind}:${relative}`,
      kind,
      label: firstHeading || path.basename(filePath, ".md"),
      target: relative.replace(/\/index\.md$/, "").replace(/\.md$/, ""),
      text,
      weight: signalWeight(kind, config),
      occurred_at: stat.mtime.toISOString(),
      fidelity: stat.mtimeMs <= checkpoint.getTime() ? "exact" : "reconstructed",
    };
  } catch {
    return null;
  }
}

function effectiveWeeklyFile(vaultPath: string, checkpoint: Date): string | null {
  const dir = path.join(vaultPath, "lists", "now");
  try {
    const date = checkpoint.toISOString().slice(0, 10);
    const files = fs.readdirSync(dir)
      .filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name) && name.slice(0, 10) <= date)
      .sort();
    return files.length ? path.join(dir, files.at(-1)!) : null;
  } catch {
    return null;
  }
}

export function buildBakeoffContextSignals(
  vaultPath: string,
  checkpoint: Date,
  config: LibraryScoringConfig,
): BakeoffContextSignal[] {
  const signals: BakeoffContextSignal[] = [];
  const weekly = effectiveWeeklyFile(vaultPath, checkpoint);
  if (weekly) {
    const signal = fileSignal(vaultPath, weekly, "task", config, checkpoint);
    if (signal) {
      const unchecked = signal.text.split(/(?=- \[[ x]\])/i).filter((line) => /^- \[ \]/.test(line)).join(" ");
      signals.push({ ...signal, text: unchecked || signal.text });
    }
  }
  for (const [folder, kind, limit] of [
    ["projects", "project", 100],
    ["areas", "area", 60],
    ["people", "person", 100],
  ] as const) {
    const root = path.join(vaultPath, folder);
    let files: string[] = [];
    try {
      files = walkMarkdown(root, { includeHidden: false })
        .filter((filePath) => path.basename(filePath) === "index.md" || path.dirname(filePath) === root)
        .sort()
        .slice(0, limit);
    } catch {
      files = [];
    }
    for (const filePath of files) {
      const signal = fileSignal(vaultPath, filePath, kind, config, checkpoint);
      if (signal) signals.push(signal);
    }
  }
  return signals;
}

interface Bm25Document {
  artifact: LibraryArtifactDetail;
  termFrequency: Map<string, number>;
  length: number;
}

interface LexicalFit {
  score: number;
  raw: number;
  label: string | null;
  matchedTerms: string[];
}

function bm25Documents(artifacts: LibraryArtifactDetail[]): Bm25Document[] {
  return artifacts.map((artifact) => {
    const fields: Array<[string, number]> = [
      [artifact.title || "", 3],
      [[artifact.summary || "", ...artifact.tags, ...artifact.source_tags].join(" "), 2],
      [artifact.content || "", 1],
    ];
    const termFrequency = new Map<string, number>();
    let length = 0;
    for (const [text, weight] of fields) {
      for (const token of tokenize(text)) {
        termFrequency.set(token, (termFrequency.get(token) || 0) + weight);
        length += weight;
      }
    }
    return { artifact, termFrequency, length: Math.max(1, length) };
  });
}

export function scoreBoundedLexical(
  artifacts: LibraryArtifactDetail[],
  signals: BakeoffContextSignal[],
  cap = 0.3,
): Map<string, LexicalFit> {
  const docs = bm25Documents(artifacts);
  const n = Math.max(1, docs.length);
  const avgLength = docs.reduce((sum, doc) => sum + doc.length, 0) / n;
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const term of doc.termFrequency.keys()) documentFrequency.set(term, (documentFrequency.get(term) || 0) + 1);
  }
  const k1 = 1.2;
  const b = 0.75;
  const rawByArtifact = new Map<string, Omit<LexicalFit, "score">>();
  for (const doc of docs) {
    const matches: Array<{ signal: BakeoffContextSignal; score: number; terms: string[] }> = [];
    for (const signal of signals) {
      const terms = uniqueTokens(signal.text).filter((term) => {
        if (!doc.termFrequency.has(term)) return false;
        const df = documentFrequency.get(term) || 0;
        return df <= Math.max(1, Math.floor(n * 0.15));
      });
      const minimum = signal.kind === "task" || signal.kind === "project" ? 2 : 3;
      if (terms.length < minimum) continue;
      let score = 0;
      for (const term of terms) {
        const df = documentFrequency.get(term) || 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        const tf = doc.termFrequency.get(term) || 0;
        const denominator = tf + k1 * (1 - b + b * (doc.length / Math.max(1, avgLength)));
        score += idf * ((tf * (k1 + 1)) / Math.max(1e-9, denominator));
      }
      score *= signal.weight;
      matches.push({ signal, score, terms: terms.slice(0, 10) });
    }
    matches.sort((left, right) => right.score - left.score || left.signal.id.localeCompare(right.signal.id));
    const raw = (matches[0]?.score || 0) + 0.35 * (matches[1]?.score || 0);
    rawByArtifact.set(doc.artifact.id, {
      raw,
      label: matches[0]?.signal.label || null,
      matchedTerms: [...new Set(matches.slice(0, 2).flatMap((match) => match.terms))].slice(0, 10),
    });
  }
  const positives = [...rawByArtifact.values()].map((value) => value.raw).filter((value) => value > 0).sort((a, b) => a - b);
  const p95 = positives.length ? positives[Math.min(positives.length - 1, Math.floor((positives.length - 1) * 0.95))] : 1;
  return new Map([...rawByArtifact].map(([artifactId, value]) => [artifactId, {
    ...value,
    score: Number(Math.min(cap, value.raw > 0 ? (value.raw / Math.max(1e-9, p95)) * cap : 0).toFixed(3)),
  }]));
}

function targetIsActive(connection: ConnectionSuggestion, activeTargets: Set<string>): boolean {
  const target = String(connection.target || "").replace(/^\.\//, "").replace(/\/index\.md$/, "").replace(/\.md$/, "");
  if (!target) return false;
  return activeTargets.has(target) || [...activeTargets].some((active) => active.endsWith(`/${target}`) || target.endsWith(`/${active}`));
}

export function explicitContextHybridScore(
  lexicalScore: number,
  activeConnection: boolean,
  attentionTier: "high" | "medium" | "low" | null,
  cap = 0.3,
): number {
  const attentionAdjustment = attentionTier === "high" ? 0.05 : attentionTier === "medium" ? 0.02 : attentionTier === "low" ? -0.05 : 0;
  return Number(Math.max(0, Math.min(cap, lexicalScore + (activeConnection ? 0.1 : 0) + attentionAdjustment)).toFixed(3));
}

function scoreOne(
  vaultPath: string,
  artifact: LibraryArtifactDetail,
  method: BakeoffMethodId,
  contextFit: number,
  contextLabel: string | null,
  matchedTerms: string[],
  reconstructed: boolean,
  config: LibraryScoringConfig,
  checkpoint: Date,
): RecommendedArtifact & { bakeoff_context_score: number; bakeoff_method: BakeoffMethodId; bakeoff_reconstructed: boolean } {
  const connections = connectionSuggestionsFromFrontmatter(artifact.raw_frontmatter);
  const evaluation = evaluateArtifact({
    connections,
    contextFit,
    contextLabel,
    createdAt: artifact.created_at,
    substance: sourceSubstance(artifact),
    extraction_ok: !captureFailed({ body: artifact.content, frontmatter: artifact.raw_frontmatter }),
    analyzed: hasConnectionPass(artifact.raw_frontmatter),
  }, config, checkpoint);
  return {
    ...artifact,
    eval_attrs: evaluation,
    relevance_score: evaluation.worth,
    why: evaluation.why,
    worth: evaluation.worth,
    relevance: evaluation.relevance,
    substance: evaluation.substance,
    freshness: evaluation.freshness,
    lifecycle: evaluation.lifecycle,
    matched_terms: matchedTerms,
    bakeoff_context_score: contextFit,
    bakeoff_method: method,
    bakeoff_reconstructed: reconstructed,
  };
}

function serializeScores(
  method: BakeoffMethodId,
  items: Array<RecommendedArtifact & { bakeoff_context_score: number; bakeoff_reconstructed: boolean }>,
): BakeoffItemScore[] {
  return items.map((item, index) => ({
    artifact_id: item.id,
    title: item.title,
    path: item.path,
    lifecycle_status: item.lifecycle_status,
    method,
    context_score: item.bakeoff_context_score,
    relevance: item.relevance,
    worth: item.worth,
    substance: item.substance,
    freshness: item.freshness,
    lifecycle: item.lifecycle,
    rank: index + 1,
    matched_terms: item.matched_terms,
    explanation: item.why,
    reconstructed: item.bakeoff_reconstructed,
  }));
}

function latestEpisodesBefore(batches: RecommendationBatch[], checkpoint: Date): Map<string, RecommendationEpisode> {
  const latest = new Map<string, RecommendationEpisode>();
  for (const batch of batches.filter((entry) => Date.parse(entry.generated_at) < checkpoint.getTime()).sort((a, b) => a.generated_at.localeCompare(b.generated_at))) {
    for (const episode of batch.episodes) latest.set(episode.artifact_id, episode);
  }
  return latest;
}

function latestExposureBefore(events: LibraryEvent[], checkpoint: Date): Map<string, RecommendationExposure> {
  const latest = new Map<string, RecommendationExposure>();
  for (const event of events) {
    if ((event.type !== "served" && event.type !== "read") || Date.parse(event.at) >= checkpoint.getTime()) continue;
    const previous = latest.get(event.artifact_id);
    if (!previous || previous.at < event.at || (previous.at === event.at && event.type === "read")) {
      latest.set(event.artifact_id, { at: event.at, type: event.type });
    }
  }
  return latest;
}

function evidenceForCheckpoint(
  batch: RecommendationBatch,
  artifacts: LibraryArtifactDetail[],
  checkpoint: Date,
  config: LibraryScoringConfig,
): BakeoffEvidence[] {
  const evidence = new Map<string, BakeoffEvidence>();
  for (const episode of batch.episodes) {
    for (const trigger of episode.triggers) {
      const text = "text" in trigger && typeof trigger.text === "string" ? trigger.text : trigger.label;
      evidence.set(trigger.id, { ...trigger, text, fidelity: "exact" });
    }
  }
  const cutoff = checkpoint.getTime() - config.for_you.new_window_days * 86_400_000;
  for (const artifact of artifacts) {
    const created = Date.parse(artifact.created_at);
    if (!Number.isFinite(created) || created < cutoff || created > checkpoint.getTime()) continue;
    const text = [artifact.title, artifact.summary, artifact.content].filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 650);
    const id = `artifact:${artifact.id}`;
    if (!evidence.has(id)) evidence.set(id, {
      id,
      kind: "artifact",
      label: artifact.title,
      occurred_at: artifact.created_at,
      fingerprint: hashId(`${id}:${text}`, 20),
      text,
      fidelity: "reconstructed",
    });
  }
  return [...evidence.values()].sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
}

function contextPrompt(signals: BakeoffContextSignal[]): string {
  const groups = new Map<BakeoffContextSignal["kind"], BakeoffContextSignal[]>();
  for (const signal of signals) groups.set(signal.kind, [...(groups.get(signal.kind) || []), signal]);
  const labels: Record<BakeoffContextSignal["kind"], string> = { task: "TASKS", project: "PROJECTS", area: "AREAS", person: "PEOPLE" };
  return (["task", "project", "area", "person"] as const).map((kind) => {
    const rows = (groups.get(kind) || []).slice(0, kind === "task" ? 4 : 80)
      .map((signal) => `- ${signal.label}${signal.target ? ` (${signal.target})` : ""} — ${signal.text.slice(0, 180)}`);
    return rows.length ? `## ${labels[kind]}\n${rows.join("\n")}` : "";
  }).filter(Boolean).join("\n\n");
}

function actualPickCandidateCount(actualIds: Set<string>, candidates: RecommendedArtifact[]): number {
  const candidateIds = new Set(candidates.map((item) => item.id));
  return [...actualIds].filter((id) => candidateIds.has(id)).length;
}

export function buildBakeoffCheckpoint(
  vaultPath: string,
  batch: RecommendationBatch,
  allArtifacts: LibraryArtifactDetail[],
  allBatches: RecommendationBatch[],
  events: LibraryEvent[],
): BakeoffCheckpointRuntime {
  const checkpoint = new Date(batch.generated_at);
  const config = loadScoringConfig(vaultPath);
  const sanitized = allArtifacts
    .filter((artifact) => Date.parse(artifact.created_at) <= checkpoint.getTime())
    .map((artifact) => sanitizeArtifactAsOf(artifact, checkpoint))
    .filter((entry) => artifactReady(entry.artifact));
  const artifacts = sanitized.map((entry) => entry.artifact);
  const reconstructedById = new Map(sanitized.map((entry) => [entry.artifact.id, entry.reconstructed]));
  const signals = buildBakeoffContextSignals(vaultPath, checkpoint, config);
  const lexical = scoreBoundedLexical(artifacts, signals, config.relevance.context_fit_cap);
  const activeTargets = new Set(signals.map((signal) => signal.target).filter((target): target is string => Boolean(target)));
  const semanticContext = buildSemanticContext(vaultPath, artifacts);
  const scored = Object.fromEntries(BAKEOFF_METHOD_IDS.map((method) => [method, []])) as unknown as Record<BakeoffMethodId, Array<RecommendedArtifact & { bakeoff_context_score: number; bakeoff_method: BakeoffMethodId; bakeoff_reconstructed: boolean }>>;
  for (const artifact of artifacts) {
    const fit = lexical.get(artifact.id) || { score: 0, raw: 0, label: null, matchedTerms: [] };
    const semantic = scoreArtifactSemantic(vaultPath, artifact, semanticContext);
    const attention = attentionJudgmentFromFrontmatter(artifact.raw_frontmatter);
    const activeConnection = connectionSuggestionsFromFrontmatter(artifact.raw_frontmatter).some((connection) => targetIsActive(connection, activeTargets));
    const hybrid = explicitContextHybridScore(fit.score, activeConnection, attention?.tier || null, config.relevance.context_fit_cap);
    const reconstructed = reconstructedById.get(artifact.id) || signals.some((signal) => signal.fidelity === "reconstructed");
    scored.semantic.push(scoreOne(vaultPath, artifact, "semantic", semantic?.score || 0, semantic?.label || null, [], reconstructed, config, checkpoint));
    scored.explicit.push(scoreOne(vaultPath, artifact, "explicit", 0, null, [], reconstructed, config, checkpoint));
    scored.bounded_lexical.push(scoreOne(vaultPath, artifact, "bounded_lexical", fit.score, fit.label, fit.matchedTerms, reconstructed, config, checkpoint));
    scored.explicit_context_hybrid.push(scoreOne(vaultPath, artifact, "explicit_context_hybrid", hybrid, fit.label, fit.matchedTerms, reconstructed, config, checkpoint));
  }
  for (const method of BAKEOFF_METHOD_IDS) scored[method].sort((a, b) => b.worth - a.worth || b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id));

  const previousByArtifact = latestEpisodesBefore(allBatches, checkpoint);
  const exposures = latestExposureBefore(events, checkpoint);
  const negativeSince = checkpoint.getTime() - config.for_you.negative_suppress_days * 86_400_000;
  const negative = new Set(events.filter((event) => {
    const at = Date.parse(event.at);
    return at >= negativeSince && at < checkpoint.getTime() && (event.type === "skipped" || event.type === "archived_confirmed");
  }).map((event) => event.artifact_id));
  const evidence = evidenceForCheckpoint(batch, artifacts, checkpoint, config);
  const actualIds = new Set(batch.episodes.map((episode) => episode.artifact_id));
  const candidates = Object.fromEntries(BAKEOFF_METHOD_IDS.map((method) => {
    const eligible = scored[method]
      .filter((item) => !negative.has(item.id) && item.lifecycle !== "needs_refetch")
      .filter((item) => recommendationCooldownEligible({
        previous: previousByArtifact.get(item.id) || null,
        exposure: exposures.get(item.id) || null,
        now: checkpoint,
        config: config.for_you,
      }));
    return [method, buildEditorialCandidatePool({ pool: eligible, triggers: evidence, previousByArtifact, now: checkpoint, config: config.for_you })];
  })) as Record<BakeoffMethodId, RecommendedArtifact[]>;

  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const methods = Object.fromEntries(BAKEOFF_METHOD_IDS.map((method) => [method, {
    method,
    scores: serializeScores(method, scored[method]),
    candidate_ids: candidates[method].map((item) => item.id),
    actual_pick_candidate_count: actualPickCandidateCount(actualIds, candidates[method]),
    to_archive_count: scored[method].filter((item) => item.lifecycle === "to_archive").length,
    editor_picks: [],
    briefing_picks: [],
  }])) as unknown as Record<BakeoffMethodId, BakeoffMethodCheckpoint>;

  return {
    result: {
      checkpoint_at: batch.generated_at,
      batch_id: batch.id,
      kind: batch.kind,
      historical_pool_size: batch.pool_size,
      artifact_count: artifacts.length,
      context_signal_count: signals.length,
      exact_evidence_count: evidence.filter((item) => item.fidelity === "exact").length,
      reconstructed_evidence_count: evidence.filter((item) => item.fidelity === "reconstructed").length + signals.filter((item) => item.fidelity === "reconstructed").length,
      actual_picks: batch.episodes.map((episode) => ({
        episode_id: episode.id,
        artifact_id: episode.artifact_id,
        title: byId.get(episode.artifact_id)?.title || null,
        rank: episode.rank,
        why_now: episode.why_now,
        scores: episode.scores,
      })),
      methods,
      briefing_date: null,
    },
    candidates,
    evidence,
    previousByArtifact,
    contextText: contextPrompt(signals),
  };
}

export function loadBakeoffInputs(vaultPath: string, from: string, through: string): {
  artifacts: LibraryArtifactDetail[];
  batches: RecommendationBatch[];
  events: LibraryEvent[];
} {
  const fromMs = Date.parse(from);
  const throughMs = Date.parse(through);
  const batches = readRecommendationBatches(vaultPath)
    .filter((batch) => {
      const at = Date.parse(batch.generated_at);
      return at >= fromMs && at <= throughMs;
    })
    .sort((a, b) => a.generated_at.localeCompare(b.generated_at));
  const artifacts = listLibraryArtifactDetails(vaultPath, { includeCandidates: true, limit: 100_000 }).artifacts;
  const events = readLibraryEvents(vaultPath);
  return { artifacts, batches, events };
}

export function historicalOutcomes(
  checkpoints: BakeoffCheckpointResult[],
  events: LibraryEvent[],
): BakeoffHistoricalOutcome[] {
  const outcomes: BakeoffHistoricalOutcome[] = [];
  for (const checkpoint of checkpoints) {
    const start = Date.parse(checkpoint.checkpoint_at);
    for (const pick of checkpoint.actual_picks) {
      const relevant = events.filter((event) => event.artifact_id === pick.artifact_id && Date.parse(event.at) > start && Date.parse(event.at) <= start + 7 * 86_400_000);
      outcomes.push({
        artifact_id: pick.artifact_id,
        checkpoint_at: checkpoint.checkpoint_at,
        opened_72h: relevant.some((event) => event.type === "opened" && Date.parse(event.at) <= start + 72 * 3_600_000),
        read_7d: relevant.some((event) => event.type === "read"),
        promoted_7d: relevant.some((event) => event.type === "promoted"),
        skipped_7d: relevant.some((event) => event.type === "skipped"),
        feedback_7d: relevant.some((event) => event.type === "feedback_left"),
      });
    }
  }
  return outcomes;
}

export function briefingEpisodeIds(vaultPath: string, date: string): string[] {
  const roots = [path.join(vaultPath, "briefings"), path.join(vaultPath, "briefings", "weekend")];
  const files = roots.flatMap((root) => {
    try { return walkMarkdown(root, { includeHidden: false }); } catch { return []; }
  }).filter((filePath) => path.basename(filePath).startsWith(date));
  const ids: string[] = [];
  for (const filePath of files) {
    try {
      for (const match of fs.readFileSync(filePath, "utf-8").matchAll(/\brec:([a-zA-Z0-9_-]+)/g)) ids.push(match[1]);
    } catch { /* missing briefing */ }
  }
  return [...new Set(ids)];
}

export function attachBriefingDates(
  runtimes: BakeoffCheckpointRuntime[],
  vaultPath: string,
  dates: string[],
): Map<string, string> {
  const byEpisode = new Map<string, BakeoffCheckpointRuntime>();
  for (const runtime of runtimes) for (const pick of runtime.result.actual_picks) byEpisode.set(pick.episode_id, runtime);
  const checkpointToDate = new Map<string, string>();
  for (const date of dates) {
    const ids = briefingEpisodeIds(vaultPath, date);
    const counts = new Map<BakeoffCheckpointRuntime, number>();
    for (const id of ids) {
      const runtime = byEpisode.get(id);
      if (runtime) counts.set(runtime, (counts.get(runtime) || 0) + 1);
    }
    const selected = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    if (selected) {
      selected.result.briefing_date = date;
      checkpointToDate.set(selected.result.batch_id, date);
    }
  }
  return checkpointToDate;
}

export function selectCounterfactualBriefing(
  picks: BakeoffEditorPick[],
  checkpointAt: string,
  events: LibraryEvent[],
  limit = 3,
): BakeoffEditorPick[] {
  const checkpoint = Date.parse(checkpointAt);
  return picks.filter((pick) => !events.some((event) => (
    event.artifact_id === pick.artifact_id && event.type === "read" && Date.parse(event.at) <= checkpoint
  ))).slice(0, limit);
}
