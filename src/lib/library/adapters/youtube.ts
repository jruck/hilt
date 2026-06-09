import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { LibrarySourceBlockedError, MissingCredentialError } from "../errors";
import { refreshGoogleAccessToken } from "../oauth";
import { parseFeed } from "./rss";

function extractVideoId(url: string): string | null {
  return url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1]
    || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1]
    || null;
}

async function resolveChannelId(source: LibrarySourceConfig): Promise<string> {
  if (typeof source.metadata.channel_id === "string") return source.metadata.channel_id;
  const urlChannelId = source.url.match(/youtube\.com\/channel\/(UC[A-Za-z0-9_-]+)/)?.[1];
  if (urlChannelId) return urlChannelId;
  const handle = youtubeHandleFromSource(source);
  if (handle) {
    const apiChannelId = await resolveChannelIdByHandle(handle);
    if (apiChannelId) return apiChannelId;
  }
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`YouTube channel page fetch failed: ${response.status}`);
  const html = await response.text();
  const id = html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[^"]+)"/)?.[1]
    || html.match(/<meta itemprop="channelId" content="([^"]+)"/)?.[1]
    || html.match(/"externalId":"(UC[^"]+)"/)?.[1]
    || html.match(/"browseId":"(UC[^"]+)"/)?.[1]
    || html.match(/"channelId":"(UC[^"]+)"/)?.[1];
  if (!id) throw new Error(`Unable to resolve YouTube channel ID for ${source.url}`);
  return id;
}

function youtubeHandleFromSource(source: LibrarySourceConfig): string | null {
  const configured = source.metadata.handle;
  if (typeof configured === "string" && configured.trim()) return configured.trim().replace(/^@?/, "@");
  try {
    const parsed = new URL(source.url);
    const match = parsed.pathname.match(/^\/(@[^/?#]+)/);
    return match ? decodeURIComponent(match[1]).replace(/^@?/, "@") : null;
  } catch {
    return null;
  }
}

async function resolveChannelIdByHandle(handle: string): Promise<string | null> {
  const token = await youtubeAccessToken().catch(() => null);
  if (!token) return null;
  const fetchWithToken = async (accessToken: string): Promise<Response> => {
    const url = new URL("https://www.googleapis.com/youtube/v3/channels");
    url.searchParams.set("part", "id");
    url.searchParams.set("forHandle", handle);
    return fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  };
  let response = await fetchWithToken(token);
  if (!response.ok && process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) {
    const refreshed = await refreshGoogleAccessToken().catch(() => null);
    if (refreshed) response = await fetchWithToken(refreshed);
  }
  if (!response.ok) return null;
  const json = await response.json() as { items?: Array<{ id?: string }> };
  return json.items?.find((item) => typeof item.id === "string" && item.id.startsWith("UC"))?.id || null;
}

function optionLimit(source: LibrarySourceConfig, options: FetchArtifactsOptions, fallback: number): number {
  const value = Number(options.limit || source.metadata.max_results || fallback);
  if (!Number.isFinite(value) || value < 1) return fallback;
  return Math.min(50, Math.floor(value));
}

function backfillAfter(source: LibrarySourceConfig): string | null {
  const value = source.metadata.backfill_after;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isOnOrAfter(date: string | undefined, cutoff: string | null): boolean {
  if (!cutoff || !date) return true;
  const dateMs = new Date(date).getTime();
  const cutoffMs = new Date(cutoff).getTime();
  if (Number.isNaN(dateMs) || Number.isNaN(cutoffMs)) return true;
  return dateMs >= cutoffMs;
}

function youtubeThumbnail(thumbnails: unknown): string | undefined {
  const typed = thumbnails as Record<string, { url?: string }> | undefined;
  return typed?.maxres?.url || typed?.high?.url || typed?.medium?.url || typed?.default?.url;
}

async function youtubeAccessToken(): Promise<string | null> {
  return process.env.YOUTUBE_OAUTH_ACCESS_TOKEN || await refreshGoogleAccessToken();
}

function playlistIdFromSource(source: LibrarySourceConfig): string | null {
  if (source.url.startsWith("youtube://playlist/")) {
    return source.url.slice("youtube://playlist/".length).trim() || null;
  }
  return typeof source.metadata.playlist_id === "string" && source.metadata.playlist_id.trim()
    ? source.metadata.playlist_id.trim()
    : null;
}

async function fetchChannelVideos(source: LibrarySourceConfig, options: FetchArtifactsOptions = {}): Promise<ArtifactFetchBatch> {
  if (options.cursor || backfillAfter(source) || source.metadata.fetch_strategy === "youtube_data_api") {
    return fetchChannelVideosFromDataApi(source, options);
  }
  const channelId = await resolveChannelId(source);
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`YouTube feed fetch failed: ${response.status}`);
  const xml = await response.text();
  const limit = optionLimit(source, options, 15);
  const artifacts = parseFeed(xml).map((item) => {
    const videoId = extractVideoId(item.url);
    return {
      ...item,
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : item.thumbnail,
      metadata: { ...item.metadata, video_id: videoId, channel_id: channelId, format: "video" },
    };
  }).slice(0, limit);
  return { artifacts, cursor: options.cursor || null, next_cursor: null };
}

async function fetchChannelVideosFromDataApiWithToken(
  source: LibrarySourceConfig,
  token: string,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const channelId = await resolveChannelId(source);
  const uploadsPlaylistId = `UU${channelId.slice(2)}`;
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", uploadsPlaylistId);
  url.searchParams.set("maxResults", String(optionLimit(source, options, 25)));
  if (options.cursor) url.searchParams.set("pageToken", options.cursor);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.text();
    throw new LibrarySourceBlockedError(`YouTube channel uploads fetch failed: ${response.status} ${body}`, source.id);
  }

  const cutoff = backfillAfter(source);
  const json = await response.json() as {
    items?: Array<{
      snippet?: Record<string, unknown> & { resourceId?: { videoId?: string } };
      contentDetails?: { videoId?: string; videoPublishedAt?: string };
    }>;
    nextPageToken?: string;
  };
  const items = json.items || [];
  const sawOlderThanCutoff = cutoff
    ? items.some((item) => !isOnOrAfter(item.contentDetails?.videoPublishedAt || String(item.snippet?.publishedAt || ""), cutoff))
    : false;
  const artifacts: RawArtifact[] = items.map((item) => {
    const snippet = item.snippet || {};
    const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId || "";
    const publishedAt = item.contentDetails?.videoPublishedAt || (typeof snippet.publishedAt === "string" ? snippet.publishedAt : new Date().toISOString());
    return {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: String(snippet.title || videoId || "Untitled YouTube video"),
      author: typeof snippet.channelTitle === "string" ? snippet.channelTitle : undefined,
      date: publishedAt,
      thumbnail: youtubeThumbnail(snippet.thumbnails),
      content: typeof snippet.description === "string" ? snippet.description : undefined,
      metadata: { video_id: videoId, channel_id: channelId, format: "video", signal: "youtube_channel_upload" },
    };
  }).filter((artifact) => artifact.url.endsWith(extractVideoId(artifact.url) || "") && isOnOrAfter(artifact.date, cutoff));

  return {
    artifacts,
    cursor: options.cursor || null,
    next_cursor: sawOlderThanCutoff ? null : json.nextPageToken || null,
  };
}

async function fetchPlaylistVideosWithToken(
  source: LibrarySourceConfig,
  token: string,
  playlistId: string,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("playlistId", playlistId);
  url.searchParams.set("maxResults", String(optionLimit(source, options, 25)));
  if (options.cursor) url.searchParams.set("pageToken", options.cursor);

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.text();
    const message = `YouTube playlist fetch failed for ${playlistId}: ${response.status} ${body}`;
    if (/watchLaterNotAccessible|watchHistoryNotAccessible|playlistOperationUnsupported|playlistItemsNotAccessible/.test(body)) {
      throw new LibrarySourceBlockedError(message, source.id);
    }
    throw new Error(message);
  }

  const cutoff = backfillAfter(source);
  const json = await response.json() as {
    items?: Array<{
      snippet?: Record<string, unknown> & { resourceId?: { videoId?: string } };
      contentDetails?: { videoId?: string; videoPublishedAt?: string };
    }>;
    nextPageToken?: string;
  };
  const items = json.items || [];
  const sawOlderThanCutoff = cutoff
    ? items.some((item) => !isOnOrAfter(item.contentDetails?.videoPublishedAt || String(item.snippet?.publishedAt || ""), cutoff))
    : false;
  const signal = source.signal || String(source.metadata.signal || "youtube_playlist");
  const artifacts: RawArtifact[] = items.map((item) => {
    const snippet = item.snippet || {};
    const videoId = item.contentDetails?.videoId || snippet.resourceId?.videoId || "";
    const publishedAt = item.contentDetails?.videoPublishedAt || (typeof snippet.publishedAt === "string" ? snippet.publishedAt : new Date().toISOString());
    return {
      url: `https://www.youtube.com/watch?v=${videoId}`,
      title: String(snippet.title || videoId || "Untitled YouTube video"),
      author: typeof snippet.videoOwnerChannelTitle === "string"
        ? snippet.videoOwnerChannelTitle
        : typeof snippet.channelTitle === "string" ? snippet.channelTitle : undefined,
      date: publishedAt,
      thumbnail: youtubeThumbnail(snippet.thumbnails),
      content: typeof snippet.description === "string" ? snippet.description : undefined,
      metadata: { video_id: videoId, playlist_id: playlistId, format: "video", signal },
    };
  }).filter((artifact) => Boolean(extractVideoId(artifact.url)) && isOnOrAfter(artifact.date, cutoff));

  return {
    artifacts,
    cursor: options.cursor || null,
    next_cursor: sawOlderThanCutoff ? null : json.nextPageToken || null,
  };
}

async function fetchChannelVideosFromDataApi(source: LibrarySourceConfig, options: FetchArtifactsOptions = {}): Promise<ArtifactFetchBatch> {
  const token = await youtubeAccessToken();
  if (!token) throw new MissingCredentialError(source.id, "YOUTUBE_OAUTH_ACCESS_TOKEN or YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKEN");
  try {
    return await fetchChannelVideosFromDataApiWithToken(source, token, options);
  } catch (error) {
    if (!process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) throw error;
    const refreshed = await refreshGoogleAccessToken();
    if (!refreshed) throw error;
    return fetchChannelVideosFromDataApiWithToken(source, refreshed, options);
  }
}

async function fetchPlaylistVideos(source: LibrarySourceConfig, playlistId: string, options: FetchArtifactsOptions = {}): Promise<ArtifactFetchBatch> {
  const token = await youtubeAccessToken();
  if (!token) throw new MissingCredentialError(source.id, "YOUTUBE_OAUTH_ACCESS_TOKEN or YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKEN");
  try {
    return await fetchPlaylistVideosWithToken(source, token, playlistId, options);
  } catch (error) {
    if (!process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) throw error;
    const refreshed = await refreshGoogleAccessToken();
    if (!refreshed) throw error;
    return fetchPlaylistVideosWithToken(source, refreshed, playlistId, options);
  }
}

async function fetchLikedVideosWithToken(
  source: LibrarySourceConfig,
  token: string,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("myRating", "like");
  url.searchParams.set("maxResults", String(optionLimit(source, options, 25)));
  if (options.cursor) url.searchParams.set("pageToken", options.cursor);
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) {
    const body = await response.text();
    const message = `YouTube liked videos fetch failed: ${response.status} ${body}`;
    if (response.status === 403 && (/SERVICE_DISABLED|accessNotConfigured|youtube.googleapis.com/.test(body))) {
      throw new LibrarySourceBlockedError(message, source.id);
    }
    throw new Error(message);
  }
  const json = await response.json() as { items?: Array<{ id: string; snippet?: Record<string, unknown> }>; nextPageToken?: string };
  const cutoff = backfillAfter(source);
  const items = json.items || [];
  const sawOlderThanCutoff = cutoff
    ? items.some((item) => !isOnOrAfter(typeof item.snippet?.publishedAt === "string" ? item.snippet.publishedAt : undefined, cutoff))
    : false;
  const artifacts: RawArtifact[] = items.map((item) => {
    const snippet = item.snippet || {};
    return {
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: String(snippet.title || item.id),
      author: typeof snippet.channelTitle === "string" ? snippet.channelTitle : undefined,
      date: typeof snippet.publishedAt === "string" ? snippet.publishedAt : new Date().toISOString(),
      thumbnail: youtubeThumbnail(snippet.thumbnails),
      content: typeof snippet.description === "string" ? snippet.description : undefined,
      metadata: { video_id: item.id, format: "video", signal: "youtube_like" },
    };
  }).filter((artifact) => isOnOrAfter(artifact.date, cutoff));
  return { artifacts, cursor: options.cursor || null, next_cursor: sawOlderThanCutoff ? null : json.nextPageToken || null };
}

async function fetchLikedVideos(source: LibrarySourceConfig, options: FetchArtifactsOptions = {}): Promise<ArtifactFetchBatch> {
  const token = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN || await refreshGoogleAccessToken();
  if (!token) throw new MissingCredentialError(source.id, "YOUTUBE_OAUTH_ACCESS_TOKEN or YOUTUBE_CLIENT_ID/YOUTUBE_CLIENT_SECRET/YOUTUBE_REFRESH_TOKEN");
  try {
    return await fetchLikedVideosWithToken(source, token, options);
  } catch (error) {
    if (!process.env.YOUTUBE_OAUTH_ACCESS_TOKEN) throw error;
    const refreshed = await refreshGoogleAccessToken();
    if (!refreshed) throw error;
    return fetchLikedVideosWithToken(source, refreshed, options);
  }
}

export async function fetchYouTubeArtifacts(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  if (source.url === "youtube://liked-videos" || source.signal === "youtube_like") {
    return fetchLikedVideos(source, options);
  }
  const playlistId = playlistIdFromSource(source);
  if (playlistId) {
    return fetchPlaylistVideos(source, playlistId, options);
  }
  return fetchChannelVideos(source, options);
}
