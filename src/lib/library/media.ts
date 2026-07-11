import type { ProcessedArtifact, RawArtifact } from "./types";

export function getYouTubeVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1]
    || url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1]
    || url.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{11})/)?.[1]
    || url.match(/youtube\.com\/shorts\/([A-Za-z0-9_-]{11})/)?.[1]
    || null;
}

export function isYouTubeUrl(url: string | null | undefined): boolean {
  return Boolean(getYouTubeVideoId(url));
}

export function getVimeoVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/player\.vimeo\.com\/video\/(\d+)/i)?.[1]
    || url.match(/vimeo\.com\/(?:video\/)?(\d+)/i)?.[1]
    || null;
}

export function getXPostId(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/(\d+)/i)?.[1] || null;
}

// Heuristic: does this tweet text read like the opening post of a multi-tweet thread? Combined with
// conversation_id === tweet id (the tweet is the root of its own conversation), this signals a thread
// whose continuation lives in reply tweets we can't fetch without X API search access.
export function looksLikeThreadRoot(text: string): boolean {
  return /(^|\n)\s*1[.)\/]\s/.test(text)
    || /\b(?:here are|🧵)\s*\d*\s*(?:timeless\s+)?(?:lessons|things|reasons|tips|rules|steps|ways|takeaways|points|threads?)\b/i.test(text)
    || /🧵/.test(text)
    || /\bthread\b\s*(?:below|👇|:)/i.test(text)
    || /\b1\s*\/\s*\d+\b/.test(text);
}

export function isXVideoUrl(url: string | null | undefined): boolean {
  return Boolean(url && getXPostId(url) && /\/video(?:\/\d+)?(?:[?#].*)?$/i.test(url));
}

export function getXEmbedUrl(url: string | null | undefined): string | null {
  const postId = getXPostId(url);
  return postId ? `https://platform.twitter.com/embed/Tweet.html?id=${postId}&dnt=true` : null;
}

export function isXEmbedUrl(url: string | null | undefined): boolean {
  return Boolean(url && /^https:\/\/platform\.twitter\.com\/embed\/Tweet\.html/i.test(url));
}

export function getXEmbedPostId(url: string | null | undefined): string | null {
  if (!url || !isXEmbedUrl(url)) return null;
  try {
    return new URL(url).searchParams.get("id");
  } catch {
    return url.match(/[?&]id=(\d+)/)?.[1] || null;
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeMarkdownAlt(value: string): string {
  return value.replace(/]/g, "\\]");
}

function sourceImages(raw: RawArtifact): string[] {
  const media = Array.isArray(raw.metadata.media) ? raw.metadata.media : [];
  const links = media
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as Record<string, unknown>;
      const link = typeof record.link === "string" ? record.link : null;
      const type = typeof record.type === "string" ? record.type : "";
      if (!link || (type && type !== "image")) return null;
      return link;
    })
    .filter((link): link is string => Boolean(link));
  const ordered = raw.thumbnail ? [raw.thumbnail, ...links] : links;
  return Array.from(new Set(ordered)).slice(0, Number(process.env.LIBRARY_MEDIA_IMAGE_MAX || 3));
}

export function buildMediaMarkdown(raw: RawArtifact): string {
  const embeddedMediaUrl = typeof raw.metadata.video_url === "string" ? raw.metadata.video_url : raw.url;
  const videoId = getYouTubeVideoId(embeddedMediaUrl);
  if (videoId) {
    return `## Media

<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="${escapeHtml(raw.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>
`;
  }

  const vimeoId = getVimeoVideoId(embeddedMediaUrl);
  if (vimeoId) {
    return `## Media

<iframe width="560" height="315" src="https://player.vimeo.com/video/${vimeoId}" title="${escapeHtml(raw.title)}" frameborder="0" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe>
`;
  }

  if (/^https?:\/\/[^\s]+\.(?:mp4|m4v|webm|mov)(?:[?#].*)?$/i.test(embeddedMediaUrl)) {
    return `## Media

<video controls preload="metadata" src="${escapeHtml(embeddedMediaUrl)}" title="${escapeHtml(raw.title)}"></video>
`;
  }

  const xMediaUrl = typeof raw.metadata.video_url === "string" ? raw.metadata.video_url : typeof raw.metadata.expanded_url === "string" ? raw.metadata.expanded_url : raw.url;
  // Embed any X post, not just video ones — a bookmarked tweet (text, thread root, or video) should
  // show its embed at the top. Prefer a linked video URL when present, else embed the post itself.
  const xEmbedUrl = isXVideoUrl(xMediaUrl)
    ? getXEmbedUrl(xMediaUrl)
    : getXPostId(raw.url)
      ? getXEmbedUrl(raw.url)
      : null;
  if (xEmbedUrl) {
    return `## Media

<iframe width="550" height="900" src="${xEmbedUrl}" title="${escapeHtml(raw.title)}" frameborder="0" scrolling="no" allowfullscreen></iframe>
`;
  }

  const images = sourceImages(raw);
  if (images.length) {
    return `## Media

${images.map((image, index) => `![${escapeMarkdownAlt(index === 0 ? raw.title : `${raw.title} source image ${index + 1}`)}](${image})`).join("\n\n")}
`;
  }

  return "";
}

export function cachedSourceContent(processed: ProcessedArtifact): string {
  const fallback = processed.raw.content || "";
  const hasOnlyUrls = fallback.trim().split(/\s+/).every((token) => /^https?:\/\/\S+$/i.test(token));
  return (processed.source_cache?.content || (hasOnlyUrls ? "" : fallback)).trim();
}

export function stripDetailsWrapper(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^<details>\s*<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>$/i);
  return (match?.[1] || trimmed).trim();
}

/**
 * Format a video duration (in whole seconds) as a compact timestamp: "m:ss", or "h:mm:ss" past an
 * hour. Returns "" for missing/invalid values so callers can render nothing.
 */
export function formatVideoDuration(totalSeconds: number | null | undefined): string {
  if (typeof totalSeconds !== "number" || !Number.isFinite(totalSeconds) || totalSeconds <= 0) return "";
  const s = Math.round(totalSeconds);
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
