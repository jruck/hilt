import path from "path";
import { loadEnvConfig } from "@next/env";
import { fetchArtifactBatchForSource } from "../src/lib/library/adapters";
import { listCandidates } from "../src/lib/library/candidate-cache";
import { getYouTubeVideoId, isYouTubeUrl } from "../src/lib/library/media";
import { refreshGoogleAccessToken } from "../src/lib/library/oauth";
import { loadSources } from "../src/lib/library/source-config";
import type { CandidateStatus, LibrarySourceConfig, RawArtifact, ReferenceCandidate, SourceIntent } from "../src/lib/library/types";
import { atomicWriteFile, isoNow } from "../src/lib/library/utils";
import {
  detectYouTubeContentForm,
  parseYouTubeDurationSeconds,
  type YouTubeClipDetection,
} from "../src/lib/library/youtube-clip-detector";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1] && !args[index + 1].startsWith("--")) {
      values.push(args[index + 1]);
      index += 1;
    }
  }
  return values;
}

function numberArg(name: string, fallback: number): number {
  const value = Number(argValue(name) || fallback);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

const vaultPath = argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || process.cwd();
const limit = numberArg("--limit", 100);
const recentLimit = numberArg("--recent-limit", 10);
const fetchRecent = args.includes("--fetch-recent");
const sourceFilter = new Set(argValues("--source"));
const statusFilter = new Set(argValues("--status") as CandidateStatus[]);
const outputPath = argValue("--out");

interface YouTubeVideoMetadata {
  id: string;
  title: string | null;
  description: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  durationIso: string | null;
  durationSeconds: number | null;
  tags: string[];
  viewCount: number | null;
  privacyStatus: string | null;
}

interface ReportSeed {
  origin: "candidate" | "recent_upload";
  title: string;
  url: string;
  sourceId: string;
  sourceName: string;
  sourceIntent: SourceIntent;
  sourceSignal: string | null;
  sourcePath: string | null;
  candidatePath: string | null;
  candidateStatus: CandidateStatus | null;
  author: string | null;
  published: string | null;
  digested: string | null;
  summary: string | null;
  tags: string[];
  durationSeconds: number | null;
}

interface ReportItem {
  origin: ReportSeed["origin"];
  path: string | null;
  source_id: string;
  source_name: string;
  source_intent: SourceIntent;
  source_signal: string | null;
  status: CandidateStatus | null;
  title: string;
  api_title: string | null;
  url: string;
  video_id: string;
  channel_title: string | null;
  published: string | null;
  digested: string | null;
  duration_seconds: number | null;
  view_count: number | null;
  privacy_status: string | null;
  description_preview: string | null;
  content_form: YouTubeClipDetection["content_form"];
  confidence: number;
  confidence_label: YouTubeClipDetection["confidence_label"];
  policy_action: YouTubeClipDetection["policy_action"];
  clip_score: number;
  episode_score: number;
  signals: string[];
}

function truncate(value: string | null | undefined, max = 320): string | null {
  if (!value) return null;
  const singleLine = value.replace(/\s+/g, " ").trim();
  return singleLine.length > max ? `${singleLine.slice(0, max - 1)}...` : singleLine;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function sourceById(sources: LibrarySourceConfig[]): Map<string, LibrarySourceConfig> {
  return new Map(sources.map((source) => [source.id, source]));
}

function selectedSource(source: LibrarySourceConfig): boolean {
  return source.channel === "youtube"
    && source.enabled
    && (!sourceFilter.size || sourceFilter.has(source.id));
}

function candidateSeed(candidate: ReferenceCandidate, source: LibrarySourceConfig | undefined): ReportSeed | null {
  if (candidate.channel !== "youtube" && !isYouTubeUrl(candidate.url)) return null;
  if (sourceFilter.size && !sourceFilter.has(candidate.source_id)) return null;
  if (statusFilter.size && !statusFilter.has(candidate.status)) return null;
  const fm = candidate.raw_frontmatter;
  return {
    origin: "candidate",
    title: candidate.title,
    url: candidate.url,
    sourceId: candidate.source_id,
    sourceName: source?.name || candidate.source_name,
    sourceIntent: source?.intent || candidate.intent,
    sourceSignal: source?.signal || stringField(fm.signal) || stringField(fm.source_signal),
    sourcePath: source?.path || null,
    candidatePath: candidate.path,
    candidateStatus: candidate.status,
    author: candidate.author,
    published: candidate.published,
    digested: candidate.digested,
    summary: stringField(fm.source_description) || candidate.summary || candidate.cached_source,
    tags: Array.from(new Set([...candidate.tags, ...candidate.source_tags])),
    durationSeconds: numberField(fm.video_duration_seconds) || numberField(fm.duration_seconds),
  };
}

function recentSeed(raw: RawArtifact, source: LibrarySourceConfig): ReportSeed | null {
  if (!isYouTubeUrl(raw.url)) return null;
  return {
    origin: "recent_upload",
    title: raw.title,
    url: raw.url,
    sourceId: source.id,
    sourceName: source.name,
    sourceIntent: source.intent,
    sourceSignal: source.signal || stringField(raw.metadata.signal),
    sourcePath: source.path,
    candidatePath: null,
    candidateStatus: null,
    author: raw.author || null,
    published: raw.date || null,
    digested: null,
    summary: raw.content || null,
    tags: stringArray(raw.metadata.tags),
    durationSeconds: numberField(raw.metadata.video_duration_seconds) || numberField(raw.metadata.duration_seconds),
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

async function youtubeToken(errors: string[]): Promise<string | null> {
  if (process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) return process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  try {
    return await refreshGoogleAccessToken();
  } catch (error) {
    errors.push(`youtube_token_refresh_failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

async function fetchVideoMetadata(videoIds: string[]): Promise<{ videos: Map<string, YouTubeVideoMetadata>; errors: string[] }> {
  const errors: string[] = [];
  const videos = new Map<string, YouTubeVideoMetadata>();
  const ids = Array.from(new Set(videoIds)).filter(Boolean);
  if (!ids.length) return { videos, errors };

  let token = await youtubeToken(errors);
  if (!token) {
    errors.push("youtube_metadata_unavailable: no YouTube OAuth token or refresh credentials");
    return { videos, errors };
  }

  const fetchBatch = async (batch: string[], accessToken: string): Promise<Response> => {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status,statistics");
    url.searchParams.set("id", batch.join(","));
    return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  };

  for (const batch of chunk(ids, 50)) {
    let response = await fetchBatch(batch, token);
    if (!response.ok && process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) {
      const refreshed = await refreshGoogleAccessToken().catch(() => null);
      if (refreshed) {
        token = refreshed;
        response = await fetchBatch(batch, token);
      }
    }
    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      errors.push(`youtube_videos_list_failed: ${response.status} ${truncate(body, 500) || response.statusText}`);
      continue;
    }
    const json = await response.json() as {
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          channelTitle?: string;
          publishedAt?: string;
          tags?: string[];
        };
        contentDetails?: { duration?: string };
        status?: { privacyStatus?: string };
        statistics?: { viewCount?: string };
      }>;
    };
    for (const item of json.items || []) {
      if (!item.id) continue;
      const durationIso = item.contentDetails?.duration || null;
      const viewCount = item.statistics?.viewCount ? Number(item.statistics.viewCount) : null;
      videos.set(item.id, {
        id: item.id,
        title: item.snippet?.title || null,
        description: item.snippet?.description || null,
        channelTitle: item.snippet?.channelTitle || null,
        publishedAt: item.snippet?.publishedAt || null,
        durationIso,
        durationSeconds: parseYouTubeDurationSeconds(durationIso),
        tags: item.snippet?.tags || [],
        viewCount: Number.isFinite(viewCount) ? viewCount : null,
        privacyStatus: item.status?.privacyStatus || null,
      });
    }
  }

  return { videos, errors };
}

async function fetchRecentSeeds(sources: LibrarySourceConfig[], candidateKeys: Set<string>, errors: string[]): Promise<ReportSeed[]> {
  const seeds: ReportSeed[] = [];
  if (!fetchRecent) return seeds;

  for (const source of sources.filter(selectedSource)) {
    try {
      const batch = await fetchArtifactBatchForSource(source, { limit: recentLimit });
      for (const raw of batch.artifacts) {
        const videoId = getYouTubeVideoId(raw.url);
        if (!videoId) continue;
        const key = `${source.id}:${videoId}`;
        if (candidateKeys.has(key)) continue;
        const seed = recentSeed(raw, source);
        if (seed) seeds.push(seed);
      }
    } catch (error) {
      errors.push(`recent_fetch_failed:${source.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return seeds;
}

function classify(seed: ReportSeed, metadata: YouTubeVideoMetadata | undefined): ReportItem | null {
  const videoId = getYouTubeVideoId(seed.url);
  if (!videoId) return null;
  const description = metadata?.description || seed.summary || "";
  const durationSeconds = metadata?.durationSeconds ?? seed.durationSeconds;
  const tags = Array.from(new Set([...(metadata?.tags || []), ...seed.tags]));
  const detection = detectYouTubeContentForm({
    title: metadata?.title || seed.title,
    description,
    channelTitle: metadata?.channelTitle || seed.author,
    sourceId: seed.sourceId,
    sourceName: seed.sourceName,
    sourceIntent: seed.sourceIntent,
    sourceSignal: seed.sourceSignal,
    tags,
    durationSeconds,
  });

  return {
    origin: seed.origin,
    path: seed.candidatePath,
    source_id: seed.sourceId,
    source_name: seed.sourceName,
    source_intent: seed.sourceIntent,
    source_signal: seed.sourceSignal,
    status: seed.candidateStatus,
    title: seed.title,
    api_title: metadata?.title || null,
    url: seed.url,
    video_id: videoId,
    channel_title: metadata?.channelTitle || seed.author,
    published: metadata?.publishedAt || seed.published,
    digested: seed.digested,
    duration_seconds: durationSeconds,
    view_count: metadata?.viewCount ?? null,
    privacy_status: metadata?.privacyStatus || null,
    description_preview: truncate(description),
    content_form: detection.content_form,
    confidence: detection.confidence,
    confidence_label: detection.confidence_label,
    policy_action: detection.policy_action,
    clip_score: detection.clip_score,
    episode_score: detection.episode_score,
    signals: detection.signals,
  };
}

function increment(counts: Record<string, number>, key: string | null | undefined): void {
  const normalized = key || "unknown";
  counts[normalized] = (counts[normalized] || 0) + 1;
}

async function main(): Promise<void> {
  const sources = loadSources(vaultPath);
  const sourcesById = sourceById(sources);
  const candidateSeeds = listCandidates(vaultPath)
    .map((candidate) => candidateSeed(candidate, sourcesById.get(candidate.source_id)))
    .filter((seed): seed is ReportSeed => Boolean(seed))
    .slice(0, limit);

  const candidateKeys = new Set(candidateSeeds
    .map((seed) => {
      const videoId = getYouTubeVideoId(seed.url);
      return videoId ? `${seed.sourceId}:${videoId}` : null;
    })
    .filter((key): key is string => Boolean(key)));
  const errors: string[] = [];
  const recentSeeds = await fetchRecentSeeds(sources, candidateKeys, errors);
  const seeds = [...candidateSeeds, ...recentSeeds];
  const videoIds = seeds.map((seed) => getYouTubeVideoId(seed.url)).filter((id): id is string => Boolean(id));
  const metadata = await fetchVideoMetadata(videoIds);
  errors.push(...metadata.errors);

  const items = seeds
    .map((seed) => classify(seed, metadata.videos.get(getYouTubeVideoId(seed.url) || "")))
    .filter((item): item is ReportItem => Boolean(item));

  const byContentForm: Record<string, number> = {};
  const byPolicyAction: Record<string, number> = {};
  const bySource: Record<string, number> = {};
  const byOrigin: Record<string, number> = {};
  for (const item of items) {
    increment(byContentForm, item.content_form);
    increment(byPolicyAction, item.policy_action);
    increment(bySource, item.source_id);
    increment(byOrigin, item.origin);
  }

  const report = {
    generated_at: isoNow(),
    vault_path: vaultPath,
    options: {
      limit,
      fetch_recent: fetchRecent,
      recent_limit: recentLimit,
      sources: Array.from(sourceFilter),
      statuses: Array.from(statusFilter),
    },
    counts: {
      total: items.length,
      enriched_with_youtube_api: items.filter((item) => metadata.videos.has(item.video_id)).length,
      by_content_form: byContentForm,
      by_policy_action: byPolicyAction,
      by_source: bySource,
      by_origin: byOrigin,
      errors: errors.length,
    },
    errors,
    items,
  };

  const json = JSON.stringify(report, null, 2);
  if (outputPath) {
    atomicWriteFile(path.resolve(outputPath), `${json}\n`);
    console.error(`Wrote ${path.resolve(outputPath)}`);
  } else {
    console.log(json);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
