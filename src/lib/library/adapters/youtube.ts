import type { LibrarySourceConfig, RawArtifact } from "../types";
import { MissingCredentialError } from "../errors";
import { parseFeed } from "./rss";

function extractVideoId(url: string): string | null {
  return url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1]
    || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1]
    || null;
}

async function resolveChannelId(source: LibrarySourceConfig): Promise<string> {
  if (typeof source.metadata.channel_id === "string") return source.metadata.channel_id;
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`YouTube channel page fetch failed: ${response.status}`);
  const html = await response.text();
  const id = html.match(/"channelId":"(UC[^"]+)"/)?.[1]
    || html.match(/<meta itemprop="channelId" content="([^"]+)"/)?.[1];
  if (!id) throw new Error(`Unable to resolve YouTube channel ID for ${source.url}`);
  return id;
}

async function fetchChannelVideos(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  const channelId = await resolveChannelId(source);
  const feedUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`;
  const response = await fetch(feedUrl);
  if (!response.ok) throw new Error(`YouTube feed fetch failed: ${response.status}`);
  const xml = await response.text();
  return parseFeed(xml).map((item) => {
    const videoId = extractVideoId(item.url);
    return {
      ...item,
      thumbnail: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : item.thumbnail,
      metadata: { ...item.metadata, video_id: videoId, channel_id: channelId, format: "video" },
    };
  }).slice(0, Number(source.metadata.max_results || 15));
}

async function fetchLikedVideos(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  const token = process.env.YOUTUBE_OAUTH_ACCESS_TOKEN;
  if (!token) throw new MissingCredentialError(source.id, "YOUTUBE_OAUTH_ACCESS_TOKEN");
  const url = new URL("https://www.googleapis.com/youtube/v3/videos");
  url.searchParams.set("part", "snippet,contentDetails");
  url.searchParams.set("myRating", "like");
  url.searchParams.set("maxResults", String(source.metadata.max_results || 25));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`YouTube liked videos fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { items?: Array<{ id: string; snippet?: Record<string, unknown> }> };
  return (json.items || []).map((item) => {
    const snippet = item.snippet || {};
    const thumbnails = snippet.thumbnails as Record<string, { url?: string }> | undefined;
    return {
      url: `https://www.youtube.com/watch?v=${item.id}`,
      title: String(snippet.title || item.id),
      author: typeof snippet.channelTitle === "string" ? snippet.channelTitle : undefined,
      date: typeof snippet.publishedAt === "string" ? snippet.publishedAt : new Date().toISOString(),
      thumbnail: thumbnails?.high?.url || thumbnails?.default?.url,
      content: typeof snippet.description === "string" ? snippet.description : undefined,
      metadata: { video_id: item.id, format: "video", signal: "youtube_like" },
    };
  });
}

export async function fetchYouTubeArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  if (source.url === "youtube://liked-videos" || source.signal === "youtube_like") {
    return fetchLikedVideos(source);
  }
  return fetchChannelVideos(source);
}

