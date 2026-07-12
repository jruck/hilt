import fs from "node:fs";
import path from "node:path";
import {
  type RecommendationBatch,
  type RecommendationBatchKind,
  type RecommendationDismissal,
  type RecommendationEpisode,
  type RecommendationEpisodeScores,
  type RecommendationTrigger,
} from "./types";
import { atomicWriteFile, ensureDir, hashId, isoNow } from "./utils";

interface RecommendationProjection {
  version: 1;
  updated_at: string;
  batch_count: number;
  latest_batch_id: string | null;
  entries: RecommendationEpisode[];
}

interface RecommendationVerdicts {
  version: 1;
  dismissals: Record<string, RecommendationDismissal>;
}

export interface RecommendationRuntimeState {
  version: 1;
  last_success_at: string | null;
  last_batch_id: string | null;
  last_batch_size: number;
  last_run_kind: RecommendationBatchKind | null;
  pending: boolean;
  pending_reasons: string[];
  pending_since: string | null;
  next_retry_at: string | null;
  last_error: string | null;
  automatic_runs_by_day: Record<string, number>;
}

export interface RecommendationPickInput {
  artifact_id: string;
  why_now: string;
  triggers: RecommendationTrigger[];
  scores: RecommendationEpisodeScores;
}

const EMPTY_RUNTIME: RecommendationRuntimeState = {
  version: 1,
  last_success_at: null,
  last_batch_id: null,
  last_batch_size: 0,
  last_run_kind: null,
  pending: false,
  pending_reasons: [],
  pending_since: null,
  next_retry_at: null,
  last_error: null,
  automatic_runs_by_day: {},
};

function dataRoot(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function recommendationRoot(vaultPath: string): string {
  return path.join(dataRoot(), "library-recommendations", hashId(path.resolve(vaultPath), 16));
}

function batchesDir(vaultPath: string): string {
  return path.join(recommendationRoot(vaultPath), "batches");
}

function projectionPath(vaultPath: string): string {
  return path.join(recommendationRoot(vaultPath), "feed.json");
}

function verdictsPath(vaultPath: string): string {
  return path.join(recommendationRoot(vaultPath), "verdicts.json");
}

function runtimePath(vaultPath: string): string {
  return path.join(recommendationRoot(vaultPath), "runtime.json");
}

function safeReadJson<T>(filePath: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return null;
  }
}

function batchFiles(vaultPath: string): string[] {
  const dir = batchesDir(vaultPath);
  try {
    return fs.readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

export function readRecommendationBatches(vaultPath: string): RecommendationBatch[] {
  return batchFiles(vaultPath)
    .map((filePath) => safeReadJson<RecommendationBatch>(filePath))
    .filter((batch): batch is RecommendationBatch => Boolean(batch?.id && Array.isArray(batch.episodes)))
    .sort((a, b) => a.generated_at.localeCompare(b.generated_at));
}

function buildProjection(vaultPath: string): RecommendationProjection {
  const batches = readRecommendationBatches(vaultPath);
  const latest = new Map<string, RecommendationEpisode>();
  for (const batch of batches) {
    for (const episode of batch.episodes) {
      const previous = latest.get(episode.artifact_id);
      if (!previous || previous.recommended_at < episode.recommended_at
        || (previous.recommended_at === episode.recommended_at && previous.rank > episode.rank)) {
        latest.set(episode.artifact_id, episode);
      }
    }
  }
  return {
    version: 1,
    updated_at: isoNow(),
    batch_count: batches.length,
    latest_batch_id: batches.at(-1)?.id || null,
    entries: [...latest.values()].sort(compareEpisodes),
  };
}

function compareEpisodes(a: RecommendationEpisode, b: RecommendationEpisode): number {
  const byTime = b.recommended_at.localeCompare(a.recommended_at);
  if (byTime) return byTime;
  const byRank = a.rank - b.rank;
  return byRank || a.id.localeCompare(b.id);
}

function writeProjection(vaultPath: string): RecommendationProjection {
  const projection = buildProjection(vaultPath);
  ensureDir(path.dirname(projectionPath(vaultPath)));
  atomicWriteFile(projectionPath(vaultPath), `${JSON.stringify(projection, null, 2)}\n`);
  return projection;
}

function readProjection(vaultPath: string): RecommendationProjection {
  const cached = safeReadJson<RecommendationProjection>(projectionPath(vaultPath));
  const batches = readRecommendationBatches(vaultPath);
  if (
    cached?.version === 1
    && Array.isArray(cached.entries)
    && cached.batch_count === batches.length
    && cached.latest_batch_id === (batches.at(-1)?.id || null)
  ) return cached;
  return writeProjection(vaultPath);
}

export function readRecommendationVerdicts(vaultPath: string): RecommendationVerdicts {
  const parsed = safeReadJson<RecommendationVerdicts>(verdictsPath(vaultPath));
  if (parsed?.version === 1 && parsed.dismissals && typeof parsed.dismissals === "object") {
    const dismissals: Record<string, RecommendationDismissal> = {};
    // Early rollout builds keyed this map by artifact. Normalize by episode on read so existing
    // verdicts migrate without a separate rewrite and frozen briefing episodes remain independent.
    for (const dismissal of Object.values(parsed.dismissals)) {
      if (dismissal?.episode_id) dismissals[dismissal.episode_id] = dismissal;
    }
    return { version: 1, dismissals };
  }
  return { version: 1, dismissals: {} };
}

function writeRecommendationVerdicts(vaultPath: string, verdicts: RecommendationVerdicts): void {
  ensureDir(path.dirname(verdictsPath(vaultPath)));
  atomicWriteFile(verdictsPath(vaultPath), `${JSON.stringify(verdicts, null, 2)}\n`);
}

export function readRecommendationRuntime(vaultPath: string): RecommendationRuntimeState {
  const parsed = safeReadJson<RecommendationRuntimeState>(runtimePath(vaultPath));
  return parsed?.version === 1 ? { ...EMPTY_RUNTIME, ...parsed } : { ...EMPTY_RUNTIME };
}

export function writeRecommendationRuntime(vaultPath: string, update: Partial<RecommendationRuntimeState>): RecommendationRuntimeState {
  const next = { ...readRecommendationRuntime(vaultPath), ...update, version: 1 as const };
  ensureDir(path.dirname(runtimePath(vaultPath)));
  atomicWriteFile(runtimePath(vaultPath), `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

export function markRecommendationRefreshPending(vaultPath: string, reason: string, now = isoNow()): RecommendationRuntimeState {
  const state = readRecommendationRuntime(vaultPath);
  return writeRecommendationRuntime(vaultPath, {
    pending: true,
    pending_since: state.pending_since || now,
    pending_reasons: [...new Set([...state.pending_reasons, reason])].slice(-20),
  });
}

export function latestRecommendationEpisode(vaultPath: string, artifactId: string): RecommendationEpisode | null {
  return readProjection(vaultPath).entries.find((entry) => entry.artifact_id === artifactId) || null;
}

export function projectedRecommendationEpisodes(vaultPath: string, options: { includeDismissed?: boolean } = {}): RecommendationEpisode[] {
  const entries = readProjection(vaultPath).entries;
  if (options.includeDismissed) return [...entries];
  const dismissals = readRecommendationVerdicts(vaultPath).dismissals;
  return entries.filter((entry) => {
    const dismissal = dismissals[entry.id];
    return !dismissal || Boolean(dismissal.restored_at);
  });
}

export function latestActiveRecommendationDismissal(vaultPath: string, artifactId: string): RecommendationDismissal | null {
  return Object.values(readRecommendationVerdicts(vaultPath).dismissals)
    .filter((dismissal) => dismissal.artifact_id === artifactId && !dismissal.restored_at)
    .sort((a, b) => b.dismissed_at.localeCompare(a.dismissed_at))[0] || null;
}

export function recommendationEpisodeById(vaultPath: string, episodeId: string): RecommendationEpisode | null {
  for (const batch of readRecommendationBatches(vaultPath).reverse()) {
    const episode = batch.episodes.find((entry) => entry.id === episodeId);
    if (episode) return episode;
  }
  return null;
}

export function recommendationEpisodesById(vaultPath: string, ids: string[]): RecommendationEpisode[] {
  const wanted = new Set(ids);
  if (!wanted.size) return [];
  const found = new Map<string, RecommendationEpisode>();
  for (const batch of readRecommendationBatches(vaultPath).reverse()) {
    for (const episode of batch.episodes) {
      if (wanted.has(episode.id) && !found.has(episode.id)) found.set(episode.id, episode);
    }
    if (found.size === wanted.size) break;
  }
  return ids.map((id) => found.get(id)).filter((entry): entry is RecommendationEpisode => Boolean(entry));
}

function idTimestamp(iso: string): string {
  return iso.replace(/[-:.TZ]/g, "").slice(0, 14);
}

export function writeRecommendationBatch(
  vaultPath: string,
  input: {
    kind: RecommendationBatchKind;
    generated_at?: string;
    context_window: { start: string; end: string };
    pool_size: number;
    picks: RecommendationPickInput[];
  },
): RecommendationBatch {
  const generatedAt = input.generated_at || isoNow();
  const previousByArtifact = new Map(readProjection(vaultPath).entries.map((entry) => [entry.artifact_id, entry]));
  const seen = new Set<string>();
  for (const pick of input.picks) {
    if (!pick.artifact_id || !pick.why_now.trim()) throw new Error("Invalid recommendation pick");
    if (seen.has(pick.artifact_id)) throw new Error(`Duplicate recommendation artifact: ${pick.artifact_id}`);
    if (!pick.triggers.length) throw new Error(`Recommendation pick has no trigger: ${pick.artifact_id}`);
    seen.add(pick.artifact_id);
  }
  const validPicks = input.picks;
  const batchIdentity = validPicks.map((pick) => ({
    artifact_id: pick.artifact_id,
    why_now: pick.why_now.trim(),
    trigger_fingerprints: pick.triggers.map((trigger) => trigger.fingerprint),
  }));
  const batchId = `batch-${idTimestamp(generatedAt)}-${hashId(`${generatedAt}:${input.kind}:${JSON.stringify(batchIdentity)}`, 8)}`;
  const episodes: RecommendationEpisode[] = validPicks.map((pick, index) => {
    const previous = previousByArtifact.get(pick.artifact_id) || null;
    return {
      id: `rec-${idTimestamp(generatedAt)}-${String(index + 1).padStart(2, "0")}-${hashId(`${batchId}:${pick.artifact_id}`, 8)}`,
      batch_id: batchId,
      artifact_id: pick.artifact_id,
      recommended_at: generatedAt,
      rank: index + 1,
      why_now: pick.why_now.trim(),
      triggers: pick.triggers,
      scores: pick.scores,
      is_resurface: Boolean(previous),
      previous_episode_id: previous?.id || null,
      previous_recommended_at: previous?.recommended_at || null,
    };
  });
  const batch: RecommendationBatch = {
    version: 1,
    id: batchId,
    kind: input.kind,
    generated_at: generatedAt,
    context_window: input.context_window,
    pool_size: input.pool_size,
    episodes,
  };
  const target = path.join(batchesDir(vaultPath), `${batch.id}.json`);
  ensureDir(path.dirname(target));
  if (!fs.existsSync(target)) atomicWriteFile(target, `${JSON.stringify(batch, null, 2)}\n`);
  writeProjection(vaultPath);
  const today = generatedAt.slice(0, 10);
  const runtime = readRecommendationRuntime(vaultPath);
  writeRecommendationRuntime(vaultPath, {
    last_success_at: generatedAt,
    last_batch_id: batch.id,
    last_batch_size: episodes.length,
    last_run_kind: input.kind,
    pending: false,
    pending_reasons: [],
    pending_since: null,
    next_retry_at: null,
    last_error: null,
    automatic_runs_by_day: input.kind === "refresh"
      ? { ...runtime.automatic_runs_by_day, [today]: (runtime.automatic_runs_by_day[today] || 0) + 1 }
      : runtime.automatic_runs_by_day,
  });
  return batch;
}

export function dismissRecommendation(
  vaultPath: string,
  episodeId: string,
  note: string | null = null,
  dismissedAt = isoNow(),
): RecommendationDismissal {
  const episode = recommendationEpisodeById(vaultPath, episodeId);
  if (!episode) throw new Error("Recommendation episode not found");
  const verdicts = readRecommendationVerdicts(vaultPath);
  const dismissal: RecommendationDismissal = {
    artifact_id: episode.artifact_id,
    episode_id: episode.id,
    dismissed_at: dismissedAt,
    restored_at: null,
    note: note?.trim() || null,
  };
  verdicts.dismissals[episode.id] = dismissal;
  writeRecommendationVerdicts(vaultPath, verdicts);
  return dismissal;
}

export function restoreRecommendation(vaultPath: string, episodeId: string, restoredAt = isoNow()): RecommendationDismissal {
  const episode = recommendationEpisodeById(vaultPath, episodeId);
  if (!episode) throw new Error("Recommendation episode not found");
  const verdicts = readRecommendationVerdicts(vaultPath);
  const dismissal = verdicts.dismissals[episode.id];
  if (!dismissal) throw new Error("Recommendation is not dismissed");
  const restored = { ...dismissal, restored_at: restoredAt };
  verdicts.dismissals[episode.id] = restored;
  writeRecommendationVerdicts(vaultPath, verdicts);
  return restored;
}

interface LegacyEditorCache {
  generated_at?: string;
  picks?: Array<{ id?: string; reason?: string }>;
}

export function bootstrapLegacyRecommendationCache(
  vaultPath: string,
  scoresByArtifact: Map<string, RecommendationEpisodeScores>,
): RecommendationBatch | null {
  if (batchFiles(vaultPath).length > 0) return null;
  const legacyPath = path.join(dataRoot(), "library-for-you", `${hashId(path.resolve(vaultPath), 16)}.json`);
  const legacy = safeReadJson<LegacyEditorCache>(legacyPath);
  if (!legacy?.generated_at || !Array.isArray(legacy.picks) || legacy.picks.length === 0) return null;
  const trigger: RecommendationTrigger = {
    id: `legacy:${legacy.generated_at}`,
    kind: "legacy",
    label: "Previous For You editor pass",
    occurred_at: legacy.generated_at,
    fingerprint: hashId(`legacy:${legacy.generated_at}`, 16),
  };
  const seen = new Set<string>();
  const legacyPicks = legacy.picks
    .filter((pick): pick is { id: string; reason: string } => Boolean(pick.id && pick.reason && scoresByArtifact.has(pick.id)))
    .filter((pick) => {
      if (seen.has(pick.id)) return false;
      seen.add(pick.id);
      return true;
    });
  return writeRecommendationBatch(vaultPath, {
    kind: "legacy",
    generated_at: legacy.generated_at,
    context_window: { start: legacy.generated_at, end: legacy.generated_at },
    pool_size: legacy.picks.length,
    picks: legacyPicks
      .map((pick) => ({ artifact_id: pick.id, why_now: pick.reason, triggers: [trigger], scores: scoresByArtifact.get(pick.id)! })),
  });
}
