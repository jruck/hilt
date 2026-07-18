import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { buildForYouPool, nearDuplicateRecommendationTitles } from "../src/lib/library/recommendations";
import { buildKbIndex } from "../src/lib/library/kb-index";
import { buildRecommendationContext, recommendationContextPrompt } from "../src/lib/library/recommendation-context";
import {
  latestActiveRecommendationDismissal,
  projectedRecommendationEpisodes,
  readRecommendationRuntime,
  recommendationRoot,
  writeRecommendationBatch,
  writeRecommendationRuntime,
} from "../src/lib/library/recommendation-store";
import {
  buildRecommendationEditorPrompt,
  buildEditorialCandidatePool,
  recommendationCooldownEligible,
  validateRecommendationPicksDetailed,
  validateRecommendationPicksWithRepair,
  type RawRecommendationPick,
  type RecommendationExposure,
  type RecommendationPickRejection,
  type RecommendationEditorRepairContext,
} from "../src/lib/library/recommendation-editor";
import { listLibraryArtifactDetails } from "../src/lib/library/library";
import { readLibraryEvents, appendLibraryEvents } from "../src/lib/library/events";
import { detectRateLimitInEnvelope, extractModelText, resolveClaudeBin, runClaude } from "../src/lib/library/connections";
import type { RecommendationBatchKind, RecommendationEpisode, RecommendedArtifact } from "../src/lib/library/types";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const argValue = (name: string): string | null => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] || null : null; };
const vaultPath = argValue("--vault") || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const rawKind = argValue("--kind") || "morning";
const kind: RecommendationBatchKind = rawKind === "refresh" || rawKind === "fixture" ? rawKind : "morning";
const timeoutMs = Number(process.env.LIBRARY_EDITOR_TIMEOUT_MS || 600_000);
const fixturePath = argValue("--fixture") || process.env.LIBRARY_RECOMMENDATION_FIXTURE || null;
const now = process.env.LIBRARY_RECOMMENDATION_NOW ? new Date(process.env.LIBRARY_RECOMMENDATION_NOW) : new Date();
if (!Number.isFinite(timeoutMs) || Number.isNaN(now.getTime())) { console.error("Invalid recommendation runtime configuration."); process.exit(64); }

function latestExposureByArtifact(): Map<string, RecommendationExposure> {
  const map = new Map<string, RecommendationExposure>();
  for (const event of readLibraryEvents(vaultPath)) {
    if (event.type !== "served" && event.type !== "read") continue;
    const previous = map.get(event.artifact_id);
    if (!previous || previous.at < event.at || (previous.at === event.at && event.type === "read")) {
      map.set(event.artifact_id, { at: event.at, type: event.type });
    }
  }
  return map;
}

function eligiblePool(
  pool: RecommendedArtifact[],
  previousByArtifact: Map<string, RecommendationEpisode>,
  config: ReturnType<typeof buildForYouPool>["config"]["for_you"],
): RecommendedArtifact[] {
  const exposures = latestExposureByArtifact();
  return pool.filter((item) => recommendationCooldownEligible({
    previous: previousByArtifact.get(item.id) || null,
    dismissal: latestActiveRecommendationDismissal(vaultPath, item.id),
    exposure: exposures.get(item.id) || null,
    now,
    config,
  }));
}

function parseRawPicks(text: string): RawRecommendationPick[] {
  const match = text.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(match ? match[0] : text) as { picks?: RawRecommendationPick[] };
  if (!Array.isArray(parsed.picks)) throw new Error("invalid_model_output: picks must be an array");
  return parsed.picks;
}

function readFixture(): RawRecommendationPick[] | null {
  if (!fixturePath) return null;
  const raw = fs.readFileSync(path.resolve(fixturePath), "utf-8");
  return parseRawPicks(raw);
}

function acquireLock(): number | null {
  const lock = path.join(recommendationRoot(vaultPath), "editor.lock");
  fs.mkdirSync(path.dirname(lock), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const fd = fs.openSync(lock, "wx");
      fs.writeFileSync(fd, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`);
      return fd;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner: { pid?: number; started_at?: string } | null = null;
      let ageMs = Number.POSITIVE_INFINITY;
      try { ageMs = Date.now() - fs.statSync(lock).mtimeMs; } catch { /* missing lock retries below */ }
      try { owner = JSON.parse(fs.readFileSync(lock, "utf-8")) as { pid?: number; started_at?: string }; } catch { /* legacy/corrupt lock */ }
      let ownerAlive = false;
      if (Number.isInteger(owner?.pid) && (owner?.pid || 0) > 0) {
        try { process.kill(owner!.pid!, 0); ownerAlive = true; } catch { /* stale owner */ }
      }
      if (ownerAlive || ageMs < Math.max(timeoutMs * 2, 10 * 60_000)) return null;
      try { fs.unlinkSync(lock); } catch { return null; }
    }
  }
  return null;
}

function releaseLock(fd: number): void {
  const lock = path.join(recommendationRoot(vaultPath), "editor.lock");
  try { fs.closeSync(fd); } catch { /* ignore */ }
  try { fs.unlinkSync(lock); } catch { /* ignore */ }
}

function rejectionSummary(rejections: RecommendationPickRejection[]): string {
  return rejections
    .slice(0, 6)
    .map((rejection) => rejection.message)
    .join("; ");
}

async function modelPicks(
  candidates: RecommendedArtifact[],
  contextText: string,
  evidenceText: string,
  maxItems: number,
  previousByArtifact: Map<string, RecommendationEpisode>,
  repair: RecommendationEditorRepairContext | null = null,
): Promise<RawRecommendationPick[]> {
  const task = buildRecommendationEditorPrompt({
    candidates,
    contextText,
    evidenceText,
    maxItems,
    previousByArtifact,
    repair,
  });
  const cliArgs = ["-p", task, "--output-format", "json"];
  const model = process.env.LIBRARY_CONNECTIONS_MODEL;
  if (model) cliArgs.push("--model", model);
  const stdout = await runClaude(resolveClaudeBin(), cliArgs, timeoutMs);
  if (detectRateLimitInEnvelope(stdout).limited) throw new Error("rate_limited");
  try {
    const envelope = JSON.parse(stdout.trim()) as { is_error?: boolean; api_error_status?: number };
    if (envelope?.is_error) throw new Error(envelope.api_error_status ? `api_error_${envelope.api_error_status}` : "api_error");
  } catch (error) {
    if (error instanceof Error && /^(api_error|rate_limited)/.test(error.message)) throw error;
  }
  return parseRawPicks(extractModelText(stdout));
}

async function main(): Promise<void> {
  const lock = acquireLock();
  if (lock === null) { console.log(JSON.stringify({ skipped: "already_running" })); return; }
  try {
    const { pool, config } = buildForYouPool(vaultPath);
    const details = listLibraryArtifactDetails(vaultPath, { includeCandidates: true, limit: 100_000 }).artifacts;
    const evidence = buildRecommendationContext(vaultPath, details, {
      now,
      contextHours: config.for_you.context_window_hours,
      newDays: config.for_you.new_window_days,
    });
    const previousByArtifact = new Map(
      projectedRecommendationEpisodes(vaultPath, { includeDismissed: true }).map((episode) => [episode.artifact_id, episode]),
    );
    const cooledPool = eligiblePool(pool, previousByArtifact, config.for_you);
    const candidates = buildEditorialCandidatePool({
      pool: cooledPool,
      triggers: evidence,
      previousByArtifact,
      now,
      config: config.for_you,
    });
    const fixture = readFixture();
    const contextText = candidates.length > 0 ? buildKbIndex(vaultPath, { noWrite: true }) : "";
    const evidenceText = candidates.length > 0 ? recommendationContextPrompt(evidence) : "";
    const raw = fixture || (candidates.length > 0 ? await modelPicks(
      candidates,
      contextText,
      evidenceText,
      config.for_you.batch_max,
      previousByArtifact,
    ) : []);
    const validationInput = {
      candidates,
      triggers: evidence,
      previousByArtifact,
      maxItems: config.for_you.batch_max,
      nearDuplicate: nearDuplicateRecommendationTitles,
    };
    const validation = fixture
      ? { ...validateRecommendationPicksDetailed({ ...validationInput, raw }), raw, repair_attempted: false }
      : await validateRecommendationPicksWithRepair({ ...validationInput, raw }, async (failed) => {
        console.warn(JSON.stringify({
          event: "recommendation_output_repair",
          rejected: failed.rejections.map(({ index, artifact_id, code }) => ({ index, artifact_id, code })),
        }));
        return modelPicks(
          candidates,
          contextText,
          evidenceText,
          config.for_you.batch_max,
          previousByArtifact,
          { attempted: failed.raw, rejections: failed.rejections },
        );
      });
    if (validation.rejections.length > 0) {
      throw new Error(`invalid_model_output: ${rejectionSummary(validation.rejections)}`);
    }
    const picks = validation.picks;
    const generatedAt = now.toISOString();
    const batch = writeRecommendationBatch(vaultPath, {
      kind,
      generated_at: generatedAt,
      context_window: {
        start: new Date(now.getTime() - config.for_you.context_window_hours * 3_600_000).toISOString(),
        end: generatedAt,
      },
      pool_size: candidates.length,
      picks,
    });
    appendLibraryEvents(vaultPath, batch.episodes.map((episode) => ({
      type: "recommended" as const,
      artifact_id: episode.artifact_id,
      surface: "api" as const,
      rank: episode.rank,
      scores: episode.scores,
      meta: { episode_id: episode.id, batch_id: batch.id, kind: batch.kind, trigger_ids: episode.triggers.map((trigger) => trigger.id) },
    })));
    console.log(JSON.stringify({ batch: batch.id, kind: batch.kind, picks: batch.episodes.length, pool: candidates.length }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const limited = /rate.?limit|usage limit|api_error_429/i.test(message)
      || detectRateLimitInEnvelope((error as { stdout?: string })?.stdout || "").limited;
    const retryAt = new Date(now.getTime() + 60 * 60_000).toISOString();
    const runtime = readRecommendationRuntime(vaultPath);
    writeRecommendationRuntime(vaultPath, {
      pending: true,
      pending_since: runtime.pending_since || now.toISOString(),
      pending_reasons: [...new Set([...runtime.pending_reasons, `editor-retry:${kind}`])],
      next_retry_at: retryAt,
      last_error: limited ? "rate_limited" : message.slice(0, 500),
    });
    if (limited || /api_error_\d+/.test(message)) {
      console.log(JSON.stringify({ skipped: limited ? "rate_limited" : "api_error", next_retry_at: retryAt }));
      return;
    }
    throw error;
  } finally {
    releaseLock(lock);
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
