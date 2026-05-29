import fs from "node:fs";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { extractHeading, extractSection, parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "../src/lib/library/markdown";
import { buildMediaMarkdown, getYouTubeVideoId } from "../src/lib/library/media";
import { enrichRawArtifactMedia } from "../src/lib/library/media-enrichment";
import type { RawArtifact } from "../src/lib/library/types";
import { atomicWriteFile, dateOnly, walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const write = args.includes("--write");
const includeCandidates = args.includes("--include-candidates");
const includeVideos = args.includes("--include-videos");
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";

function argValue(name: string, fallback: string | null = null): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || fallback : fallback;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function markdownSectionExists(body: string, sectionName: string): boolean {
  return Boolean(extractSection(body, sectionName).trim());
}

function addMediaSection(body: string, media: string): string {
  if (!media.trim() || markdownSectionExists(body, "Media") || body.includes("youtube.com/embed/") || body.includes("<iframe")) return body;
  const match = body.match(/^(#\s+.+\n+)/);
  if (!match) return `${media.trim()}\n\n${body.trimEnd()}\n`;
  return body.replace(/^(#\s+.+\n+)/, `$1\n${media.trim()}\n\n`);
}

function frontmatterDateString(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? dateOnly(value) : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateOnly(date) : null;
}

function selectedFiles(): string[] {
  const explicitPaths = argValues("--path");
  if (explicitPaths.length) {
    return explicitPaths.map((item) => path.isAbsolute(item) ? item : path.join(vaultPath, item));
  }

  const limit = Number(argValue("--limit", "100"));
  const sourceFilter = new Set(argValues("--source"));
  const referencesRoot = path.join(vaultPath, "references");
  return walkMarkdown(referencesRoot, { includeHidden: includeCandidates })
    .filter((filePath) => includeCandidates || !filePath.includes(`${path.sep}.cache${path.sep}`))
    .filter((filePath) => filePath.includes(`${path.sep}${CANDIDATE_CACHE_DIR}${path.sep}`) || !filePath.includes(`${path.sep}.cache${path.sep}`))
    .filter((filePath) => {
      if (!sourceFilter.size) return true;
      const parsed = parseMarkdownFile(filePath);
      const sourceId = typeof parsed.data.source_id === "string" ? parsed.data.source_id : "manual";
      return sourceFilter.has(sourceId);
    })
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
}

async function repairFile(filePath: string) {
  const parsed = parseMarkdownFile(filePath);
  if (parsed.data.type !== "reference" && parsed.data.type !== "reference-candidate") {
    return { path: relativeVaultPath(vaultPath, filePath), status: "skipped", reason: "not a reference" };
  }

  const url = firstString(parsed.data, ["url", "source"]);
  if (!url || !/^https?:\/\//i.test(url)) {
    return { path: relativeVaultPath(vaultPath, filePath), status: "skipped", reason: "no http url" };
  }

  const videoId = getYouTubeVideoId(firstString(parsed.data, ["video_url", "youtube_url", "media_url"]) || url);
  if (videoId && !includeVideos) {
    return { path: relativeVaultPath(vaultPath, filePath), status: "skipped", reason: "video handled by legacy repair" };
  }

  const existingThumbnail = firstString(parsed.data, ["thumbnail"]);
  const existingMedia = markdownSectionExists(parsed.body, "Media");
  if (existingThumbnail && existingMedia) {
    return { path: relativeVaultPath(vaultPath, filePath), status: "unchanged", reason: "media already present" };
  }

  const title = String(parsed.data.title || extractHeading(parsed.body, path.basename(filePath, ".md")));
  const raw: RawArtifact = {
    url,
    title,
    author: firstString(parsed.data, ["author"]) || undefined,
    date: frontmatterDateString(parsed.data.published) || frontmatterDateString(parsed.data.created) || frontmatterDateString(parsed.data.captured) || new Date().toISOString(),
    thumbnail: existingThumbnail || undefined,
    content: "",
    metadata: {
      format: parsed.data.format,
      media: parsed.data.media,
    },
  };
  const enriched = await enrichRawArtifactMedia(raw);
  const media = buildMediaMarkdown(enriched.raw);
  const nextData: Record<string, unknown> = {
    ...parsed.data,
    thumbnail: enriched.raw.thumbnail || parsed.data.thumbnail,
    media: enriched.raw.metadata.media || parsed.data.media,
    og_image: enriched.raw.metadata.og_image || parsed.data.og_image,
    og_title: enriched.raw.metadata.og_title || parsed.data.og_title,
    og_description: enriched.raw.metadata.og_description || parsed.data.og_description,
  };
  for (const key of Object.keys(nextData)) {
    if (nextData[key] === undefined || nextData[key] === null || nextData[key] === "") delete nextData[key];
  }
  const nextBody = addMediaSection(parsed.body, media);
  const changed = JSON.stringify(parsed.data) !== JSON.stringify(nextData) || parsed.body !== nextBody;
  if (write && changed) {
    atomicWriteFile(filePath, stringifyMarkdown(nextData, nextBody));
  }

  return {
    path: relativeVaultPath(vaultPath, filePath),
    status: changed ? (write ? "updated" : "dry_run") : "unchanged",
    title,
    thumbnail: enriched.raw.thumbnail || null,
    media_added: !existingMedia && Boolean(media.trim()),
    notes: enriched.notes,
  };
}

async function main() {
  const files = selectedFiles();
  const results = [];
  for (const filePath of files) {
    results.push(await repairFile(filePath));
  }
  console.log(JSON.stringify({
    write,
    include_candidates: includeCandidates,
    checked: results.length,
    updated: results.filter((item) => item.status === "updated" || item.status === "dry_run").length,
    results,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
