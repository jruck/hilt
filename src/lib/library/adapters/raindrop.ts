import type { LibrarySourceConfig, RawArtifact } from "../types";
import { MissingCredentialError } from "../errors";

function collectionId(source: LibrarySourceConfig): string {
  if (typeof source.metadata.collection_id === "number" || typeof source.metadata.collection_id === "string") {
    return String(source.metadata.collection_id);
  }
  const match = source.url.match(/collection\/(-?\d+)/);
  return match?.[1] || "0";
}

export async function fetchRaindropArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  const token = process.env.RAINDROP_TOKEN;
  if (!token) throw new MissingCredentialError(source.id, "RAINDROP_TOKEN");
  const url = new URL(`https://api.raindrop.io/rest/v1/raindrops/${collectionId(source)}`);
  url.searchParams.set("sort", "-created");
  url.searchParams.set("perpage", String(source.metadata.max_results || 50));
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Raindrop fetch failed: ${response.status} ${await response.text()}`);
  const json = await response.json() as { items?: Array<Record<string, unknown>> };
  return (json.items || []).map((item) => ({
    url: String(item.link || ""),
    title: String(item.title || item.link || "Untitled bookmark"),
    author: typeof item.domain === "string" ? item.domain : undefined,
    date: typeof item.created === "string" ? item.created : new Date().toISOString(),
    thumbnail: typeof item.cover === "string" ? item.cover : undefined,
    content: typeof item.excerpt === "string" ? item.excerpt : undefined,
    metadata: {
      raindrop_id: item._id,
      tags: Array.isArray(item.tags) ? item.tags : [],
      collection: item.collection,
      format: item.type || "bookmark",
      signal: "raindrop_bookmark",
    },
  })).filter((item) => item.url);
}

