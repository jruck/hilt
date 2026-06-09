import { getYouTubeVideoId, isYouTubeUrl } from "./media";
import { hasGoogleRefreshCredentials, refreshGoogleAccessToken } from "./oauth";
import type { LibrarySourceConfig, RawArtifact } from "./types";
import { isoNow } from "./utils";
import { detectYouTubeContentForm, parseYouTubeDurationSeconds } from "./youtube-clip-detector";

export interface YouTubePreflightResult {
  artifacts: RawArtifact[];
  checked: number;
  enriched: number;
  errors: string[];
}

interface YouTubeVideoMetadata {
  id: string;
  title: string | null;
  description: string | null;
  channelId: string | null;
  channelTitle: string | null;
  publishedAt: string | null;
  durationIso: string | null;
  durationSeconds: number | null;
  tags: string[];
  privacyStatus: string | null;
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return Array.from(new Set(values.filter((value): value is string => Boolean(value))));
}

function truncate(value: string | null | undefined, max = 500): string | undefined {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

async function youtubeAccessToken(): Promise<string | null> {
  if (process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) return process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  if (!hasGoogleRefreshCredentials()) return null;
  return refreshGoogleAccessToken();
}

async function fetchYouTubeVideoMetadata(videoIds: string[]): Promise<{ videos: Map<string, YouTubeVideoMetadata>; errors: string[] }> {
  const videos = new Map<string, YouTubeVideoMetadata>();
  const errors: string[] = [];
  const ids = uniqueStrings(videoIds);
  if (!ids.length) return { videos, errors };

  let token = await youtubeAccessToken().catch((error) => {
    errors.push(`youtube_metadata_token_failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  });
  if (!token) return { videos, errors };

  const fetchBatch = async (batch: string[], accessToken: string): Promise<Response> => {
    const url = new URL("https://www.googleapis.com/youtube/v3/videos");
    url.searchParams.set("part", "snippet,contentDetails,status");
    url.searchParams.set("id", batch.join(","));
    return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  };

  for (const batch of chunk(ids, 50)) {
    let response = await fetchBatch(batch, token);
    if (!response.ok && process.env.YOUTUBE_OAUTH_ACCESS_TOKEN && hasGoogleRefreshCredentials()) {
      const refreshed = await refreshGoogleAccessToken().catch(() => null);
      if (refreshed) {
        token = refreshed;
        response = await fetchBatch(batch, token);
      }
    }
    if (!response.ok) {
      const body = await response.text().catch(() => response.statusText);
      errors.push(`youtube_metadata_failed: ${response.status} ${truncate(body, 300) || response.statusText}`);
      continue;
    }
    const json = await response.json() as {
      items?: Array<{
        id?: string;
        snippet?: {
          title?: string;
          description?: string;
          channelId?: string;
          channelTitle?: string;
          publishedAt?: string;
          tags?: string[];
        };
        contentDetails?: { duration?: string };
        status?: { privacyStatus?: string };
      }>;
    };
    for (const item of json.items || []) {
      if (!item.id) continue;
      const durationIso = item.contentDetails?.duration || null;
      videos.set(item.id, {
        id: item.id,
        title: item.snippet?.title || null,
        description: item.snippet?.description || null,
        channelId: item.snippet?.channelId || null,
        channelTitle: item.snippet?.channelTitle || null,
        publishedAt: item.snippet?.publishedAt || null,
        durationIso,
        durationSeconds: parseYouTubeDurationSeconds(durationIso),
        tags: item.snippet?.tags || [],
        privacyStatus: item.status?.privacyStatus || null,
      });
    }
  }
  return { videos, errors };
}

function sourceSignal(source: LibrarySourceConfig, raw: RawArtifact): string | null {
  if (source.signal) return source.signal;
  const signal = raw.metadata.signal;
  return typeof signal === "string" ? signal : null;
}

function enrichOne(raw: RawArtifact, source: LibrarySourceConfig, metadata: YouTubeVideoMetadata): RawArtifact {
  const durationSeconds = metadata.durationSeconds ?? (typeof raw.metadata.video_duration_seconds === "number" ? raw.metadata.video_duration_seconds : null);
  const description = metadata.description || raw.content || "";
  const tags = uniqueStrings([
    ...(Array.isArray(raw.metadata.tags) ? raw.metadata.tags.map(String) : []),
    ...metadata.tags,
  ]);
  const detection = detectYouTubeContentForm({
    title: metadata.title || raw.title,
    description,
    channelTitle: metadata.channelTitle || raw.author,
    sourceId: source.id,
    sourceName: source.name,
    sourceIntent: source.intent,
    sourceSignal: sourceSignal(source, raw),
    tags,
    durationSeconds,
  });

  return {
    ...raw,
    title: raw.title || metadata.title || raw.url,
    author: metadata.channelTitle || raw.author,
    date: metadata.publishedAt || raw.date,
    content: raw.content || metadata.description || undefined,
    metadata: {
      ...raw.metadata,
      video_id: metadata.id,
      youtube_metadata_at: isoNow(),
      youtube_title: metadata.title || undefined,
      youtube_channel_id: metadata.channelId || undefined,
      youtube_channel_title: metadata.channelTitle || undefined,
      youtube_published_at: metadata.publishedAt || undefined,
      youtube_duration_iso: metadata.durationIso || undefined,
      youtube_duration_seconds: durationSeconds ?? undefined,
      video_duration_seconds: durationSeconds ?? undefined,
      youtube_tags: metadata.tags.length ? metadata.tags.slice(0, 25) : undefined,
      youtube_privacy_status: metadata.privacyStatus || undefined,
      youtube_description_preview: truncate(metadata.description, 500),
      youtube_description_has_shorts_marker: metadata.description ? /#shorts?\b/i.test(metadata.description) : undefined,
      youtube_description_links_full_episode: metadata.description ? /\b(?:full episode|watch the full|full interview|full conversation|full podcast)\b/i.test(metadata.description) : undefined,
      youtube_clip: detection,
    },
  };
}

export async function enrichYouTubeArtifacts(source: LibrarySourceConfig, artifacts: RawArtifact[]): Promise<YouTubePreflightResult> {
  if (process.env.LIBRARY_YOUTUBE_METADATA_PREFLIGHT_DISABLED === "1") {
    return { artifacts, checked: 0, enriched: 0, errors: [] };
  }
  const eligible = source.channel === "youtube" ? artifacts.filter((artifact) => isYouTubeUrl(artifact.url)) : [];
  const ids = eligible.map((artifact) => getYouTubeVideoId(artifact.url) || (typeof artifact.metadata.video_id === "string" ? artifact.metadata.video_id : null));
  const uniqueIds = uniqueStrings(ids);
  if (!uniqueIds.length) return { artifacts, checked: 0, enriched: 0, errors: [] };

  const { videos, errors } = await fetchYouTubeVideoMetadata(uniqueIds);
  if (!videos.size) return { artifacts, checked: uniqueIds.length, enriched: 0, errors };

  let enriched = 0;
  const nextArtifacts = artifacts.map((artifact) => {
    const id = getYouTubeVideoId(artifact.url) || (typeof artifact.metadata.video_id === "string" ? artifact.metadata.video_id : null);
    const metadata = id ? videos.get(id) : null;
    if (!metadata) return artifact;
    enriched += 1;
    return enrichOne(artifact, source, metadata);
  });
  return { artifacts: nextArtifacts, checked: uniqueIds.length, enriched, errors };
}
