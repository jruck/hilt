import type { LibrarySourceConfig, RawArtifact } from "../types";

function decodeXml(input: string): string {
  return input
    .replace(/<!\[CDATA\[([\s\S]*?)]]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function tag(block: string, name: string): string | undefined {
  const match = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? decodeXml(match[1]).replace(/<[^>]+>/g, "").trim() : undefined;
}

function link(block: string): string | undefined {
  const atom = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i)?.[1];
  return atom || tag(block, "link");
}

export function parseFeed(xml: string): RawArtifact[] {
  const blocks = Array.from(xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)).map((match) => match[0]);
  return blocks.map((block) => {
    const url = link(block) || "";
    return {
      url,
      title: tag(block, "title") || url,
      author: tag(block, "author") || tag(block, "dc:creator"),
      date: tag(block, "published") || tag(block, "updated") || tag(block, "pubDate") || new Date().toISOString(),
      content: tag(block, "content:encoded") || tag(block, "content") || tag(block, "summary") || tag(block, "description"),
      metadata: { source: "rss" },
    };
  }).filter((item) => item.url && item.title);
}

export async function fetchRssArtifacts(source: LibrarySourceConfig): Promise<RawArtifact[]> {
  const response = await fetch(source.url);
  if (!response.ok) throw new Error(`RSS fetch failed: ${response.status} ${response.statusText}`);
  const xml = await response.text();
  return parseFeed(xml).slice(0, Number(source.metadata.max_results || 25));
}

