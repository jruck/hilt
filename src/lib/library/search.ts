import type { LibrarySearchResult } from "./types";
import { listLibraryArtifactDetails, type LibraryListOptions } from "./library";

function snippetFor(content: string, query: string): string {
  const lower = content.toLowerCase();
  const index = lower.indexOf(query.toLowerCase());
  if (index === -1) return content.slice(0, 220);
  const start = Math.max(0, index - 90);
  const end = Math.min(content.length, index + query.length + 130);
  return `${start > 0 ? "..." : ""}${content.slice(start, end)}${end < content.length ? "..." : ""}`;
}

function score(content: string, query: string): number {
  const haystack = content.toLowerCase();
  const needle = query.toLowerCase();
  if (!needle) return 0;
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

export function searchLibrary(vaultPath: string, query: string, options: LibraryListOptions = {}): LibrarySearchResult[] {
  const normalized = query.trim();
  if (!normalized) return [];
  const all = listLibraryArtifactDetails(vaultPath, { ...options, limit: 10000, includeCandidates: true }).artifacts;
  return all
    .map((artifact) => {
      const content = [artifact.title, artifact.summary, artifact.tags.join(" "), artifact.content].filter(Boolean).join("\n");
      const matchScore = score(content, normalized);
      return {
        ...artifact,
        snippet: snippetFor(content, normalized),
        score: matchScore + (artifact.relevance_score || 0),
        match_type: "keyword" as const,
      };
    })
    .filter((result) => result.score > 0)
    .sort((a, b) => b.score - a.score);
}

