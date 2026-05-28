import type { ArtifactFetchBatch, FetchArtifactsOptions, LibrarySourceConfig, RawArtifact } from "../types";
import { MissingCredentialError } from "../errors";

function raindropMedia(value: unknown): Array<{ link: string; type?: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Array<{ link: string; type?: string }> => {
      if (!item || typeof item !== "object") return [];
      const record = item as Record<string, unknown>;
      const link = typeof record.link === "string" ? record.link : "";
      if (!link) return [];
      return [{ link, type: typeof record.type === "string" ? record.type : undefined }];
    });
}

function raindropCover(item: Record<string, unknown>, media: Array<{ link: string; type?: string }>): string | undefined {
  if (typeof item.cover === "string" && item.cover.trim()) return item.cover.trim();
  return media.find((entry) => entry.type === "image")?.link || media[0]?.link;
}

function collectionId(source: LibrarySourceConfig): string {
  if (typeof source.metadata.collection_id === "number" || typeof source.metadata.collection_id === "string") {
    return String(source.metadata.collection_id);
  }
  const match = source.url.match(/collection\/(-?\d+)/);
  return match?.[1] || "0";
}

export async function fetchRaindropArtifacts(
  source: LibrarySourceConfig,
  options: FetchArtifactsOptions = {},
): Promise<ArtifactFetchBatch> {
  const token = process.env.RAINDROP_TOKEN;
  if (!token) throw new MissingCredentialError(source.id, "RAINDROP_TOKEN");
  const limit = Number(options.limit || source.metadata.max_results || 50);
  const page = Number(options.cursor || source.backfill.cursor || 0);
  const url = new URL(`https://api.raindrop.io/rest/v1/raindrops/${collectionId(source)}`);
  url.searchParams.set("sort", "-created");
  url.searchParams.set("perpage", String(limit));
  url.searchParams.set("page", String(Number.isFinite(page) && page >= 0 ? page : 0));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Raindrop fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { items?: Array<Record<string, unknown>> };
  const items = json.items || [];
  const artifacts: RawArtifact[] = items.map((item) => {
    const media = raindropMedia(item.media);
    const cache = item.cache && typeof item.cache === "object" ? item.cache as Record<string, unknown> : {};
    return {
      url: String(item.link || ""),
      title: String(item.title || item.link || "Untitled bookmark"),
      author: typeof item.domain === "string" ? item.domain : undefined,
      date: typeof item.created === "string" ? item.created : new Date().toISOString(),
      thumbnail: raindropCover(item, media),
      content: typeof item.excerpt === "string" ? item.excerpt : undefined,
      metadata: {
        raindrop_id: item._id,
        tags: Array.isArray(item.tags) ? item.tags : [],
        collection: item.collection,
        format: item.type || "bookmark",
        signal: "raindrop_bookmark",
        media,
        cache_status: typeof cache.status === "string" ? cache.status : undefined,
        cache_size: typeof cache.size === "number" ? cache.size : undefined,
        cache_created: typeof cache.created === "string" ? cache.created : undefined,
      },
    };
  }).filter((item) => item.url);
  return {
    artifacts,
    cursor: String(page),
    next_cursor: items.length >= limit ? String(page + 1) : null,
  };
}
