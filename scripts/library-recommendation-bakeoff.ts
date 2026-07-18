#!/usr/bin/env tsx
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import Database from "better-sqlite3";
import { loadEnvConfig } from "@next/env";
import {
  BAKEOFF_METHOD_IDS,
  BAKEOFF_RESULT_VERSION,
  attachBriefingDates,
  buildBakeoffCheckpoint,
  historicalOutcomes,
  loadBakeoffInputs,
  selectCounterfactualBriefing,
  type BakeoffCheckpointResult,
  type BakeoffEditorPick,
  type BakeoffMethodId,
  type BakeoffResults,
} from "../src/lib/library/recommendation-bakeoff";
import { recommendationContextPrompt } from "../src/lib/library/recommendation-context";
import {
  buildRecommendationEditorPrompt,
  validateRecommendationPicksDetailed,
  type RawRecommendationPick,
  type RecommendationEditorRepairContext,
} from "../src/lib/library/recommendation-editor";
import { nearDuplicateRecommendationTitles } from "../src/lib/library/recommendations";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import { loadScoringConfig } from "../src/lib/library/scoring-config-loader";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const argValue = (name: string, fallback: string): string => {
  const index = args.indexOf(name);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const hasArg = (name: string): boolean => args.includes(name);

const vaultPath = path.resolve(argValue("--vault", process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd()));
const dataDir = path.resolve(argValue("--data-dir", process.env.DATA_DIR || path.join(process.cwd(), "data")));
const runId = argValue("--run-id", "2026-07-17-semantic-replacement");
const reportDir = path.resolve(argValue("--report-dir", path.join(dataDir, "library-evaluations", runId)));
const semanticDb = path.resolve(argValue("--semantic-db", path.join(reportDir, "semantic-baseline.sqlite")));
const from = argValue("--from", "2026-07-10T00:00:00.000Z");
const through = argValue("--through", "2026-07-17T23:59:59.999Z");
const editorModel = argValue("--editor-model", "claude-sonnet-4-6");
const editorTimeoutMs = Number(argValue("--editor-timeout-ms", process.env.LIBRARY_EDITOR_TIMEOUT_MS || "600000"));
const editorConcurrency = Number(argValue("--editor-concurrency", process.env.LIBRARY_EDITOR_CONCURRENCY || "4"));
const assessmentPath = args.includes("--assessment") ? path.resolve(argValue("--assessment", "")) : null;
const skipEditor = hasArg("--skip-editor");
const blindReviewPath = args.includes("--blind-review-file") ? path.resolve(argValue("--blind-review-file", "")) : null;
const briefingDates = ["2026-07-11", "2026-07-13", "2026-07-14", "2026-07-15", "2026-07-16", "2026-07-17"];

if (!fs.existsSync(semanticDb)) throw new Error(`Semantic snapshot not found: ${semanticDb}`);
if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(through)) || Date.parse(from) > Date.parse(through)) {
  throw new Error("Invalid bake-off date range");
}
if (!Number.isFinite(editorTimeoutMs) || editorTimeoutMs <= 0) throw new Error("Invalid editor timeout");
if (!Number.isInteger(editorConcurrency) || editorConcurrency < 1 || editorConcurrency > 4) {
  throw new Error("Editor concurrency must be an integer from 1 to 4");
}

process.env.DATA_DIR = dataDir;
process.env.HILT_SEMANTIC_DB_PATH = semanticDb;
process.env.HILT_SEMANTIC_ENABLED = "true";
process.env.SEMANTIC_OFFLINE = "1";
process.env.LIBRARY_CONNECTIONS_MODEL = editorModel;

const originalFetch = globalThis.fetch;
let blockedGoogleRequests = 0;
globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/googleapis\.com|generativelanguage\.google|gemini/i.test(url)) {
    blockedGoogleRequests += 1;
    throw new Error(`Bake-off network tripwire blocked Google/Gemini request: ${url}`);
  }
  return originalFetch(input as RequestInfo | URL, init);
}) as typeof fetch;

function sha256(filePath: string): string {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const read = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!read) break;
      hash.update(buffer.subarray(0, read));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function git(command: string[]): string {
  try {
    return execFileSync("git", command, { cwd: process.cwd(), encoding: "utf-8", maxBuffer: 10 * 1024 * 1024 }).trim();
  } catch {
    return "unavailable";
  }
}

function parseRawPicks(text: string): RawRecommendationPick[] {
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : text) as { picks?: RawRecommendationPick[] };
  if (!Array.isArray(parsed.picks)) throw new Error("invalid_model_output: picks must be an array");
  return parsed.picks;
}

interface CachedEditorRun {
  version: 1 | 2;
  prompt_hash: string;
  model: string;
  created_at: string;
  prompt?: string;
  attempts?: Array<{
    prompt: string;
    raw: RawRecommendationPick[];
    rejections: Array<{ code: string; message: string }>;
  }>;
  raw: RawRecommendationPick[];
  picks: BakeoffEditorPick[];
  rejections: Array<{ code: string; message: string }>;
  repair_attempted: boolean;
  status?: "success" | "validation_failed";
  error?: string | null;
}

interface EditorOutcome {
  picks: BakeoffEditorPick[];
  error: string | null;
}

interface BlindReviewDay {
  date: string;
  ranking: string[];
  winner: string;
  rationale: string;
  concerns?: string[];
}

interface BlindReviewResult {
  days: BlindReviewDay[];
  overall: { recommendation: string; observations: string[] };
}

interface CachedBlindReview {
  version: 1;
  prompt_hash: string;
  model: string;
  created_at: string;
  prompt: string;
  response_text: string;
  mapping: Record<string, Record<string, BakeoffMethodId>>;
  review: BlindReviewResult;
}

async function callEditor(prompt: string): Promise<RawRecommendationPick[]> {
  const cliArgs = ["-p", prompt, "--output-format", "json", "--model", editorModel];
  const stdout = await runClaude(resolveClaudeBin(), cliArgs, editorTimeoutMs);
  if (detectRateLimitInEnvelope(stdout).limited) throw new Error("rate_limited");
  const envelope = (() => {
    try { return JSON.parse(stdout.trim()) as { is_error?: boolean; api_error_status?: number }; } catch { return null; }
  })();
  if (envelope?.is_error) throw new Error(envelope.api_error_status ? `api_error_${envelope.api_error_status}` : "api_error");
  return parseRawPicks(extractModelText(stdout));
}

async function editorPicks(
  runtime: ReturnType<typeof buildBakeoffCheckpoint>,
  method: BakeoffMethodId,
): Promise<EditorOutcome> {
  const config = loadScoringConfig(vaultPath);
  const candidates = runtime.candidates[method];
  if (!candidates.length) return { picks: [], error: null };
  const evidenceText = recommendationContextPrompt(runtime.evidence);
  const buildPrompt = (repair: RecommendationEditorRepairContext | null = null) => buildRecommendationEditorPrompt({
    candidates,
    contextText: runtime.contextText,
    evidenceText,
    maxItems: config.for_you.batch_max,
    previousByArtifact: runtime.previousByArtifact,
    repair,
  });
  const prompt = buildPrompt();
  const promptHash = crypto.createHash("sha256").update(`${editorModel}\n${prompt}`).digest("hex");
  const cachePath = path.join(reportDir, "editor-cache", `${runtime.result.batch_id}-${method}-${promptHash.slice(0, 16)}.json`);
  if (fs.existsSync(cachePath)) {
    const cached = JSON.parse(fs.readFileSync(cachePath, "utf-8")) as CachedEditorRun;
    if ((cached.version === 1 || cached.version === 2) && cached.prompt_hash === promptHash && cached.model === editorModel) {
      return { picks: cached.picks, error: cached.error || null };
    }
  }

  let repairAttempted = false;
  const attempts: NonNullable<CachedEditorRun["attempts"]> = [];
  let raw = await callEditor(prompt);
  let validation = validateRecommendationPicksDetailed({
    raw,
    candidates,
    triggers: runtime.evidence,
    previousByArtifact: runtime.previousByArtifact,
    maxItems: config.for_you.batch_max,
    nearDuplicate: nearDuplicateRecommendationTitles,
  });
  attempts.push({
    prompt,
    raw,
    rejections: validation.rejections.map(({ code, message }) => ({ code, message })),
  });
  if (validation.rejections.length > 0) {
    repairAttempted = true;
    const repairPrompt = buildPrompt({ attempted: raw, rejections: validation.rejections });
    raw = await callEditor(repairPrompt);
    validation = validateRecommendationPicksDetailed({
      raw,
      candidates,
      triggers: runtime.evidence,
      previousByArtifact: runtime.previousByArtifact,
      maxItems: config.for_you.batch_max,
      nearDuplicate: nearDuplicateRecommendationTitles,
    });
    attempts.push({
      prompt: repairPrompt,
      raw,
      rejections: validation.rejections.map(({ code, message }) => ({ code, message })),
    });
  }
  const terminalError = validation.rejections.length > 0
    ? `Editor validation failed for ${runtime.result.batch_id}/${method}: ${validation.rejections.map((item) => item.message).join("; ")}`
    : null;
  const byId = new Map(candidates.map((item) => [item.id, item]));
  const picks = terminalError ? [] : validation.picks.map((pick, index) => ({
    artifact_id: pick.artifact_id,
    title: byId.get(pick.artifact_id)?.title || pick.artifact_id,
    reason: pick.why_now,
    trigger_ids: pick.triggers.map((trigger) => trigger.id),
    rank: index + 1,
  }));
  const cache: CachedEditorRun = {
    version: 2,
    prompt_hash: promptHash,
    model: editorModel,
    created_at: new Date().toISOString(),
    prompt,
    attempts,
    raw,
    picks,
    rejections: validation.rejections.map(({ code, message }) => ({ code, message })),
    repair_attempted: repairAttempted,
    status: terminalError ? "validation_failed" : "success",
    error: terminalError,
  };
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, `${JSON.stringify(cache, null, 2)}\n`, { flag: "wx" });
  return { picks, error: terminalError };
}

async function blindedReview(_results: BakeoffResults): Promise<CachedBlindReview | null> {
  if (!blindReviewPath) return null;
  const review = JSON.parse(fs.readFileSync(blindReviewPath, "utf-8")) as CachedBlindReview;
  if (review.version !== 1 || !review.prompt_hash || !review.model || !review.mapping || !review.review) {
    throw new Error(`Invalid blinded review file: ${blindReviewPath}`);
  }
  return review;
}

function average(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function overlap(left: string[], right: string[]): number {
  const other = new Set(right);
  return left.filter((id) => other.has(id)).length;
}

function scoreFor(checkpoint: BakeoffCheckpointResult, method: BakeoffMethodId, artifactId: string) {
  return checkpoint.methods[method].scores.find((score) => score.artifact_id === artifactId) || null;
}

function methodSummary(checkpoints: BakeoffCheckpointResult[], method: BakeoffMethodId) {
  const actualCount = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.actual_picks.length, 0);
  const candidateHits = checkpoints.reduce((sum, checkpoint) => sum + checkpoint.methods[method].actual_pick_candidate_count, 0);
  const archives = checkpoints.map((checkpoint) => checkpoint.methods[method].to_archive_count);
  const worth = checkpoints.flatMap((checkpoint) => checkpoint.methods[method].scores.map((score) => score.worth));
  const sampled = checkpoints.filter((checkpoint) => checkpoint.briefing_date);
  const editorOverlap = sampled.map((checkpoint) => overlap(
    checkpoint.methods[method].editor_picks.map((pick) => pick.artifact_id),
    checkpoint.actual_picks.map((pick) => pick.artifact_id),
  ));
  const editorCount = sampled.map((checkpoint) => checkpoint.methods[method].editor_picks.length);
  const top80Overlap = checkpoints.map((checkpoint) => {
    const semanticIds = checkpoint.methods.semantic.candidate_ids;
    const methodIds = checkpoint.methods[method].candidate_ids;
    return semanticIds.length ? overlap(methodIds, semanticIds) / semanticIds.length : 1;
  });
  const rankMovement = checkpoints.flatMap((checkpoint) => {
    const semanticRanks = new Map(checkpoint.methods.semantic.scores.map((score) => [score.artifact_id, score.rank]));
    return checkpoint.methods[method].candidate_ids.flatMap((artifactId) => {
      const semanticRank = semanticRanks.get(artifactId);
      const methodRank = checkpoint.methods[method].scores.find((score) => score.artifact_id === artifactId)?.rank;
      return semanticRank && methodRank ? [Math.abs(methodRank - semanticRank)] : [];
    });
  });
  const archiveFlips = checkpoints.map((checkpoint) => {
    const semanticArchive = new Map(checkpoint.methods.semantic.scores.map((score) => [score.artifact_id, score.lifecycle === "to_archive"]));
    return checkpoint.methods[method].scores.filter((score) => semanticArchive.get(score.artifact_id) !== (score.lifecycle === "to_archive")).length;
  });
  return {
    candidateRetention: actualCount ? candidateHits / actualCount : 0,
    meanArchives: average(archives),
    meanWorth: average(worth),
    editorOverlap: editorCount.reduce((sum, value) => sum + value, 0)
      ? editorOverlap.reduce((sum, value) => sum + value, 0) / editorCount.reduce((sum, value) => sum + value, 0)
      : 0,
    top80Overlap: average(top80Overlap),
    meanRankMovement: average(rankMovement),
    meanArchiveFlips: average(archiveFlips),
  };
}

function provisionalWinner(checkpoints: BakeoffCheckpointResult[]): BakeoffMethodId {
  const alternatives = BAKEOFF_METHOD_IDS.filter((method) => method !== "semantic");
  return alternatives.map((method) => ({ method, summary: methodSummary(checkpoints, method) }))
    .sort((left, right) => (
      right.summary.candidateRetention - left.summary.candidateRetention
      || right.summary.editorOverlap - left.summary.editorOverlap
      || left.summary.meanArchives - right.summary.meanArchives
    ))[0].method;
}

function reportMarkdown(results: BakeoffResults, assessment: string | null, blindReview: CachedBlindReview | null): string {
  const summaries = Object.fromEntries(BAKEOFF_METHOD_IDS.map((method) => [method, methodSummary(results.checkpoints, method)])) as Record<BakeoffMethodId, ReturnType<typeof methodSummary>>;
  const winner = provisionalWinner(results.checkpoints);
  const methodLabels: Record<BakeoffMethodId, string> = {
    semantic: "Semantic baseline",
    explicit: "Explicit-only",
    bounded_lexical: "Bounded lexical",
    explicit_context_hybrid: "Explicit-context hybrid",
  };
  const lines = [
    "# Library recommendation bake-off",
    "",
    `Generated ${results.generated_at}. One-time offline comparison over ${results.checkpoints.length} immutable recommendation checkpoints.`,
    "",
    "## Executive assessment",
    "",
    assessment?.trim() || `The mechanical first-pass winner is **${methodLabels[winner]}** because it retained the strongest combination of historical candidate eligibility and editorial overlap. This recommendation should be read together with the representative substitutions below; semantic output is a baseline, not ground truth.`,
    "",
    "No Gemini calls were made. The semantic method read the frozen SQLite snapshot; every alternative is deterministic and semantic-free. No production recommendation batches, events, or read state were written.",
    "",
    "## Methods",
    "",
    "- **Semantic baseline** — the existing frozen embedding-cosine fit, plus exact saved historical episodes.",
    "- **Explicit-only** — connection suggestions, substance, and freshness; topical fit is zero.",
    "- **Bounded lexical** — BM25F over active work, normalized to a non-saturating 0–0.3 context contribution.",
    "- **Explicit-context hybrid** — bounded lexical plus active explicit-target and stored attention-judgment adjustments.",
    "",
    "## Aggregate comparison",
    "",
    "| Method | Actual picks eligible | Top-80 overlap vs semantic | Mean rank movement | Archive flips/checkpoint | Mean worth | Editorial overlap with actual |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...BAKEOFF_METHOD_IDS.map((method) => `| ${methodLabels[method]} | ${percent(summaries[method].candidateRetention)} | ${percent(summaries[method].top80Overlap)} | ${summaries[method].meanRankMovement.toFixed(1)} | ${summaries[method].meanArchiveFlips.toFixed(1)} | ${summaries[method].meanWorth.toFixed(3)} | ${percent(summaries[method].editorOverlap)} |`),
    "",
    "Candidate retention measures whether an item Hilt actually recommended remained available to the editor. Editorial overlap is intentionally separated from rank changes because the Claude editor is nondeterministic.",
    "",
    "## Published Briefing-day comparisons",
  ];
  for (const checkpoint of results.checkpoints.filter((entry) => entry.briefing_date)) {
    lines.push("", `### ${checkpoint.briefing_date}`, "", `Checkpoint: ${checkpoint.checkpoint_at} · ${checkpoint.artifact_count} eligible items · evidence ${checkpoint.exact_evidence_count} exact / ${checkpoint.reconstructed_evidence_count} reconstructed.`, "");
    lines.push("**Actual Hilt recommendations**", "");
    for (const pick of checkpoint.actual_picks) lines.push(`- ${pick.title || pick.artifact_id} — worth ${pick.scores.worth.toFixed(3)} · ${pick.why_now}`);
    for (const method of BAKEOFF_METHOD_IDS) {
      lines.push("", `**${methodLabels[method]} editor replay**`, "");
      const semanticArchives = checkpoint.methods.semantic.to_archive_count;
      const archiveDelta = checkpoint.methods[method].to_archive_count - semanticArchives;
      lines.push(`Candidate pool ${checkpoint.methods[method].candidate_ids.length}; actual picks retained ${checkpoint.methods[method].actual_pick_candidate_count}/${checkpoint.actual_picks.length}; archive flags ${checkpoint.methods[method].to_archive_count}${method === "semantic" ? "" : ` (${archiveDelta >= 0 ? "+" : ""}${archiveDelta} vs semantic)`}; Briefing selections ${checkpoint.methods[method].briefing_picks.length}.`, "");
      const picks = checkpoint.methods[method].editor_picks;
      if (!picks.length) {
        const error = checkpoint.methods[method].editor_error;
        lines.push(error
          ? `- No validated picks — atomic editor validation rejected this replay: ${error.replace(/^Editor validation failed for [^:]+:\s*/, "")}`
          : "- No validated picks.");
      }
      for (const pick of picks) {
        const score = scoreFor(checkpoint, method, pick.artifact_id);
        lines.push(`- ${pick.title} — worth ${score?.worth.toFixed(3) ?? "n/a"}, relevance ${score?.relevance.toFixed(3) ?? "n/a"}${checkpoint.methods[method].briefing_picks.some((item) => item.artifact_id === pick.artifact_id) ? " · **Briefing**" : ""}  \n  ${pick.reason}`);
      }
    }
  }
  lines.push("", "## Blinded agent review", "");
  if (!blindReview) {
    lines.push("- Blinded review was skipped for this run.");
  } else {
    lines.push("The reviewer saw anonymous groups whose method identities were remapped independently on each date. The rankings below were unblinded only after the review was cached.", "");
    for (const day of blindReview.review.days) {
      const unblinded = day.ranking.map((label) => methodLabels[blindReview.mapping[day.date]?.[label]] || label);
      lines.push(`- **${day.date}** — anonymous ${day.ranking.join(" > ")}; unblinded ${unblinded.join(" > ")}. ${day.rationale}`);
    }
    lines.push("", `Overall blinded-review note: ${blindReview.review.overall.recommendation}`);
    for (const observation of blindReview.review.overall.observations || []) lines.push(`- ${observation}`);
  }
  lines.push("", "## Representative disagreements", "");
  let disagreements = 0;
  for (const checkpoint of results.checkpoints.filter((entry) => entry.briefing_date)) {
    const actual = new Set(checkpoint.actual_picks.map((pick) => pick.artifact_id));
    const alternative = checkpoint.methods[winner];
    const introduced = alternative.editor_picks
      .filter((pick) => !actual.has(pick.artifact_id))
      .sort((left, right) => Number(alternative.briefing_picks.some((pick) => pick.artifact_id === right.artifact_id)) - Number(alternative.briefing_picks.some((pick) => pick.artifact_id === left.artifact_id)))[0];
    if (introduced) {
      const semanticScore = scoreFor(checkpoint, "semantic", introduced.artifact_id);
      const alternativeScore = scoreFor(checkpoint, winner, introduced.artifact_id);
      lines.push(`- **${checkpoint.briefing_date} · ${methodLabels[winner]} introduced ${introduced.title}** — semantic worth ${semanticScore?.worth.toFixed(3) ?? "n/a"}; alternative worth ${alternativeScore?.worth.toFixed(3) ?? "n/a"}; matched ${alternativeScore?.matched_terms.join(", ") || "explicit evidence"}.`);
      disagreements += 1;
    }
    const alternativeIds = new Set(alternative.editor_picks.map((pick) => pick.artifact_id));
    const omitted = checkpoint.actual_picks.find((pick) => !alternativeIds.has(pick.artifact_id));
    if (omitted) {
      const alternativeScore = scoreFor(checkpoint, winner, omitted.artifact_id);
      lines.push(`- **${checkpoint.briefing_date} · ${methodLabels[winner]} omitted historical pick ${omitted.title || omitted.artifact_id}** — actual worth ${omitted.scores.worth.toFixed(3)}; alternative worth ${alternativeScore?.worth.toFixed(3) ?? "n/a"}; ${alternative.candidate_ids.includes(omitted.artifact_id) ? "it reached the editor pool but was not selected" : "it did not reach the reconstructed editor pool"}.`);
      disagreements += 1;
    }
  }
  if (!disagreements) lines.push("- The validated editor selections did not introduce an alternative-only item on the sampled dates.");
  lines.push("", "## Historical outcome evidence", "");
  const uniqueOutcomes = results.outcomes;
  lines.push(`- Actual recommendation episodes evaluated: ${uniqueOutcomes.length}`);
  lines.push(`- Opened within 72 hours: ${uniqueOutcomes.filter((outcome) => outcome.opened_72h).length}`);
  lines.push(`- Read within 7 days: ${uniqueOutcomes.filter((outcome) => outcome.read_7d).length}`);
  lines.push(`- Promoted within 7 days: ${uniqueOutcomes.filter((outcome) => outcome.promoted_7d).length}`);
  lines.push(`- Skipped within 7 days: ${uniqueOutcomes.filter((outcome) => outcome.skipped_7d).length}`);
  lines.push("", "Alternative-only items were never actually shown, so they have no behavioral outcome and are not counted as failures.");
  lines.push("", "## Fidelity and interpretation", "");
  lines.push("- Exact: immutable batches, actual score snapshots, selected episode order, stored trigger text, and timestamped event history.");
  lines.push("- Reconstructed: the full historical 80-item pool was not persisted; artifact bodies and active-work files may include later edits. Future artifacts and future timestamped judgments were excluded.");
  lines.push("- Every method received the same reconstructed corpus and checkpoint state. Actual semantic episodes remain the authoritative record of what Hilt truly showed.");
  lines.push("- Counterfactual checkpoints do not feed hypothetical reactions into later days; each is anchored to actual prior history.");
  return `${lines.join("\n")}\n`;
}

async function main(): Promise<void> {
  fs.mkdirSync(path.join(reportDir, "editor-cache"), { recursive: true });
  const semanticStatBefore = fs.statSync(semanticDb);
  const semanticChecksum = sha256(semanticDb);
  const db = new Database(semanticDb, { readonly: true, fileMustExist: true });
  const quickCheck = String((db.prepare("PRAGMA quick_check").get() as Record<string, unknown> | undefined)?.quick_check || "unknown");
  const meta = Object.fromEntries((db.prepare("SELECT key, value FROM semantic_meta WHERE key IN ('active_version','active_embedding','active_extraction','active_taxonomy','blessed_at')").all() as Array<{ key: string; value: string }>).map((entry) => [entry.key, entry.value]));
  const semanticCounts = {
    semantic_items: Number((db.prepare("SELECT COUNT(*) AS count FROM semantic_items").get() as { count: number }).count),
    chunks: Number((db.prepare("SELECT COUNT(*) AS count FROM chunks").get() as { count: number }).count),
    entities: Number((db.prepare("SELECT COUNT(*) AS count FROM entities").get() as { count: number }).count),
    topics: Number((db.prepare("SELECT COUNT(*) AS count FROM topics").get() as { count: number }).count),
  };
  db.close();
  if (quickCheck !== "ok") throw new Error(`Semantic snapshot failed quick_check: ${quickCheck}`);

  const inputs = loadBakeoffInputs(vaultPath, from, through);
  if (inputs.batches.length !== 26) throw new Error(`Expected 26 historical batches, found ${inputs.batches.length}`);
  const episodeCount = inputs.batches.reduce((sum, batch) => sum + batch.episodes.length, 0);
  if (episodeCount !== 137) throw new Error(`Expected 137 historical episodes, found ${episodeCount}`);
  const runtimes = inputs.batches.map((batch) => buildBakeoffCheckpoint(vaultPath, batch, inputs.artifacts, inputs.batches, inputs.events));
  attachBriefingDates(runtimes, vaultPath, briefingDates);
  const sampled = runtimes.filter((runtime) => runtime.result.briefing_date);
  if (sampled.length !== briefingDates.length) {
    throw new Error(`Expected ${briefingDates.length} complete Briefing checkpoints, found ${sampled.length}`);
  }

  if (!skipEditor) {
    const work = sampled.flatMap((runtime) => BAKEOFF_METHOD_IDS.map((method) => ({ runtime, method })));
    let cursor = 0;
    const failures: Error[] = [];
    const worker = async () => {
      while (cursor < work.length) {
        const task = work[cursor++];
        process.stderr.write(`editor start ${task.runtime.result.briefing_date} ${task.method}\n`);
        try {
          const outcome = await editorPicks(task.runtime, task.method);
          task.runtime.result.methods[task.method].editor_picks = outcome.picks;
          task.runtime.result.methods[task.method].editor_error = outcome.error;
          task.runtime.result.methods[task.method].briefing_picks = selectCounterfactualBriefing(
            outcome.picks,
            task.runtime.result.checkpoint_at,
            inputs.events,
            3,
          );
          process.stderr.write(`editor done ${task.runtime.result.briefing_date} ${task.method}${outcome.error ? " (validation rejected)" : ""}\n`);
        } catch (error) {
          const failure = error instanceof Error ? error : new Error(String(error));
          failures.push(new Error(`${task.runtime.result.briefing_date}/${task.method}: ${failure.message}`));
          process.stderr.write(`editor failed ${task.runtime.result.briefing_date} ${task.method}: ${failure.message}\n`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(editorConcurrency, work.length) }, () => worker()));
    if (failures.length) throw new AggregateError(failures, `${failures.length} editor replay(s) failed`);
  }

  if (blockedGoogleRequests > 0) throw new Error(`Google/Gemini tripwire fired ${blockedGoogleRequests} time(s)`);
  const semanticStatAfter = fs.statSync(semanticDb);
  const semanticChecksumAfter = sha256(semanticDb);
  if (semanticChecksumAfter !== semanticChecksum || semanticStatAfter.size !== semanticStatBefore.size) {
    throw new Error("Frozen semantic snapshot changed during the bake-off");
  }

  const results: BakeoffResults = {
    version: BAKEOFF_RESULT_VERSION,
    generated_at: new Date().toISOString(),
    range: { from, through },
    checkpoints: runtimes.map((runtime) => runtime.result),
    outcomes: historicalOutcomes(runtimes.map((runtime) => runtime.result), inputs.events),
  };
  const blindReview = await blindedReview(results);
  const eventsPath = path.join(dataDir, "library-events", `${crypto.createHash("sha256").update(path.resolve(vaultPath)).digest("hex").slice(0, 16)}.jsonl`);
  const manifest = {
    version: 1,
    run_id: runId,
    generated_at: results.generated_at,
    vault_path: vaultPath,
    report_dir: reportDir,
    range: results.range,
    methods: BAKEOFF_METHOD_IDS,
    editor: {
      enabled: !skipEditor,
      model: editorModel,
      concurrency: editorConcurrency,
      sampled_briefing_dates: briefingDates,
      blind_review: blindReview ? { model: blindReview.model, prompt_hash: blindReview.prompt_hash, dates: blindReview.review.days.length } : null,
    },
    historical: { batches: inputs.batches.length, episodes: episodeCount, events: inputs.events.length, artifacts_loaded: inputs.artifacts.length },
    semantic_snapshot: {
      path: semanticDb,
      sha256: semanticChecksum,
      bytes: semanticStatBefore.size,
      quick_check: quickCheck,
      meta,
      counts: semanticCounts,
      unchanged_after_run: true,
    },
    inputs: {
      scoring_config: loadScoringConfig(vaultPath),
      event_log_sha256: fs.existsSync(eventsPath) ? sha256(eventsPath) : null,
      repo_head: git(["rev-parse", "HEAD"]),
      repo_dirty_paths: git(["status", "--short"]).split("\n").filter(Boolean),
    },
    safety: {
      semantic_offline: process.env.SEMANTIC_OFFLINE === "1",
      blocked_google_requests: blockedGoogleRequests,
      production_writes: false,
    },
    fidelity: {
      exact: "immutable recommendation batches, episode score snapshots, stored trigger text, and event timestamps",
      reconstructed: "full historical candidate pools and immutable artifact bodies were not retained; later files are filtered by timestamps where possible",
    },
  };
  const assessment = assessmentPath && fs.existsSync(assessmentPath) ? fs.readFileSync(assessmentPath, "utf-8") : null;
  fs.writeFileSync(path.join(reportDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "results.json"), `${JSON.stringify(results, null, 2)}\n`);
  if (blindReview) fs.writeFileSync(path.join(reportDir, "blind-review.json"), `${JSON.stringify(blindReview, null, 2)}\n`);
  fs.writeFileSync(path.join(reportDir, "report.md"), reportMarkdown(results, assessment, blindReview));
  process.stdout.write(`${JSON.stringify({
    report: path.join(reportDir, "report.md"),
    results: path.join(reportDir, "results.json"),
    manifest: path.join(reportDir, "manifest.json"),
    checkpoints: results.checkpoints.length,
    episodes: episodeCount,
    briefing_checkpoints: sampled.length,
    editor_enabled: !skipEditor,
    blind_review: Boolean(blindReview),
    google_requests: blockedGoogleRequests,
  }, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
