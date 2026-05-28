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
  const videoId = getYouTubeVideoId(raw.url);
  if (videoId) {
    return `## Media

<iframe width="560" height="315" src="https://www.youtube.com/embed/${videoId}" title="${escapeHtml(raw.title)}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>

[Watch on YouTube](${raw.url})
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
  return (processed.source_cache?.content || processed.raw.content || "").trim();
}

export function stripDetailsWrapper(markdown: string): string {
  const trimmed = markdown.trim();
  const match = trimmed.match(/^<details>\s*<summary>[\s\S]*?<\/summary>\s*([\s\S]*?)\s*<\/details>$/i);
  return (match?.[1] || trimmed).trim();
}
