import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { loadEnvConfig } from "@next/env";
import { extractSection, markdownToPlain, parseMarkdownFile, stringifyMarkdown } from "../src/lib/library/markdown";
import { buildMediaMarkdown, getYouTubeVideoId, stripDetailsWrapper } from "../src/lib/library/media";
import type { RawArtifact } from "../src/lib/library/types";
import { atomicWriteFile, dateOnly, isoNow, walkMarkdown } from "../src/lib/library/utils";
import { assertLibrarySummarizeInvocation } from "../src/lib/library/summarize-policy";

loadEnvConfig(process.cwd());

const execFileAsync = promisify(execFile);
const args = process.argv.slice(2);
const write = args.includes("--write");
const refreshCache = args.includes("--refresh-cache");
const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";

interface YouTubeMetadata {
  id?: string;
  title?: string;
  channel?: string;
  uploader?: string;
  upload_date?: string;
  timestamp?: number;
  duration?: number;
  thumbnail?: string;
  webpage_url?: string;
}

interface SourceCache {
  kind: "article" | "transcript" | "source";
  extractor: "summarize-cli";
  captured_at: string;
  content: string;
  chars: number;
}

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

function durationToMs(value: string | null, fallbackMs: number): number {
  if (!value) return fallbackMs;
  const match = value.trim().match(/^(\d+(?:\.\d+)?)(ms|s|m)?$/i);
  if (!match) return fallbackMs;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return fallbackMs;
  const unit = (match[2] || "s").toLowerCase();
  if (unit === "ms") return Math.max(1, Math.round(amount));
  if (unit === "m") return Math.max(1, Math.round(amount * 60_000));
  return Math.max(1, Math.round(amount * 1_000));
}

function firstString(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function frontmatterDateString(value: unknown): string | null {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? dateOnly(value) : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? dateOnly(date) : null;
}

function titleFromBody(body: string, fallback: string): string {
  return body.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function descriptionFromBody(body: string, existing: unknown): string | undefined {
  if (typeof existing === "string" && existing.trim()) return existing.trim();
  const summary = markdownToPlain(extractSection(body, "Summary").replace(/^###\s+.+$/gm, ""));
  if (!summary) return undefined;
  if (summary.length <= 180) return summary;
  const truncated = summary.slice(0, 181).replace(/\s+\S*$/, "").trim();
  return truncated || summary.slice(0, 180).trim();
}

function publishedFromYouTube(metadata: YouTubeMetadata | null): string | undefined {
  if (!metadata) return undefined;
  if (typeof metadata.timestamp === "number" && Number.isFinite(metadata.timestamp)) {
    return dateOnly(new Date(metadata.timestamp * 1000));
  }
  if (typeof metadata.upload_date === "string") {
    const match = metadata.upload_date.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) return `${match[1]}-${match[2]}-${match[3]}`;
  }
  return undefined;
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

function replaceSection(body: string, sectionName: string, content: string): string {
  const heading = `## ${sectionName}`;
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === heading.toLowerCase());
  const replacement = [heading, "", content.trim(), ""];
  if (start === -1) {
    return `${body.trimEnd()}\n\n${replacement.join("\n")}`;
  }
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return [...lines.slice(0, start), ...replacement, ...lines.slice(end)].join("\n").trimEnd() + "\n";
}

function rawContentMarkdown(cache: SourceCache): string {
  return `<details>
<summary>Full source cache</summary>

${stripDetailsWrapper(cache.content)}

</details>`;
}

function comparableValue(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(comparableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, comparableValue(item)]),
    );
  }
  return value;
}

function frontmatterChanged(previous: Record<string, unknown>, next: Record<string, unknown>): boolean {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (JSON.stringify(comparableValue(previous[key])) !== JSON.stringify(comparableValue(next[key]))) return true;
  }
  return false;
}

async function fetchYouTubeMetadata(url: string): Promise<YouTubeMetadata | null> {
  try {
    const { stdout } = await execFileAsync("yt-dlp", ["--skip-download", "--dump-json", url], {
      timeout: durationToMs(argValue("--metadata-timeout", "45s"), 45_000),
      maxBuffer: 1024 * 1024 * 4,
    });
    return JSON.parse(stdout) as YouTubeMetadata;
  } catch {
    return null;
  }
}

async function extractSourceCache(url: string, isVideo: boolean): Promise<SourceCache | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1") return null;
  const timeoutValue = argValue("--timeout", process.env.LIBRARY_EXTRACT_TIMEOUT || process.env.LIBRARY_SUMMARIZE_TIMEOUT || "3m") || "3m";
  const minChars = Number(argValue("--min-cache-chars", process.env.LIBRARY_REPAIR_LEGACY_MIN_CACHE_CHARS || "500"));
  const cliArgs = [
    url,
    "--extract",
    "--format",
    "md",
    "--plain",
    "--no-color",
    "--max-extract-characters",
    argValue("--max-extract-characters", process.env.LIBRARY_MAX_EXTRACT_CHARACTERS || "200000") || "200000",
    "--timeout",
    timeoutValue,
  ];
  if (isVideo) {
    cliArgs.push("--youtube", process.env.LIBRARY_YOUTUBE_TRANSCRIPT_SOURCE || "auto");
    cliArgs.push("--video-mode", "transcript");
    cliArgs.push("--timestamps");
  }

  try {
    assertLibrarySummarizeInvocation(cliArgs);
    const summarizeBin = process.env.SUMMARIZE_BIN || "summarize";
    const { stdout } = await execFileAsync(summarizeBin, cliArgs, {
      timeout: durationToMs(timeoutValue, 240_000) + 5000,
      maxBuffer: 1024 * 1024 * 12,
    });
    const content = stdout.trim();
    if (content.length < (Number.isFinite(minChars) && minChars > 0 ? minChars : 500)) return null;
    return {
      kind: isVideo ? "transcript" : "article",
      extractor: "summarize-cli",
      captured_at: isoNow(),
      content,
      chars: content.length,
    };
  } catch {
    return null;
  }
}

function selectedPaths(): string[] {
  const explicitPaths = argValues("--path");
  if (explicitPaths.length) {
    return explicitPaths.map((item) => path.isAbsolute(item) ? item : path.join(vaultPath, item));
  }
  const limit = Number(argValue("--limit", "25"));
  return walkMarkdown(path.join(vaultPath, "references"))
    .filter((filePath) => !filePath.includes(`${path.sep}.cache${path.sep}`))
    .slice(0, Number.isFinite(limit) && limit > 0 ? limit : undefined);
}

async function repairFile(filePath: string) {
  const parsed = parseMarkdownFile(filePath);
  if (parsed.data.type !== "reference") {
    return { path: path.relative(vaultPath, filePath), status: "skipped", reason: "not a reference" };
  }

  const relativePath = path.relative(vaultPath, filePath).split(path.sep).join("/");
  const title = titleFromBody(parsed.body, path.basename(filePath, ".md"));
  const canonicalUrl = firstString(parsed.data, ["url", "source"]);
  const embeddedMediaUrl = firstString(parsed.data, ["video_url", "youtube_url", "media_url"]) || canonicalUrl;
  const videoId = getYouTubeVideoId(embeddedMediaUrl);
  const extractionUrl = videoId ? embeddedMediaUrl : canonicalUrl;
  const existingRawContent = extractSection(parsed.body, "Raw Content");
  const needsCache = Boolean(extractionUrl && (refreshCache || !existingRawContent.trim() || existingRawContent.includes("No cached source content available.")));
  const youtubeMetadata = videoId && embeddedMediaUrl ? await fetchYouTubeMetadata(embeddedMediaUrl) : null;
  const recoveredPublished = publishedFromYouTube(youtubeMetadata);
  const existingPublished = frontmatterDateString(parsed.data.published);
  const published = recoveredPublished || existingPublished;
  const nextPublished = recoveredPublished || parsed.data.published;
  const thumbnail = firstString(parsed.data, ["thumbnail"]) || youtubeMetadata?.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg` : undefined);
  const author = firstString(parsed.data, ["author"]) || youtubeMetadata?.channel || youtubeMetadata?.uploader;
  const raw: RawArtifact = {
    url: canonicalUrl || embeddedMediaUrl || "",
    title,
    author,
    date: published || frontmatterDateString(parsed.data.created) || frontmatterDateString(parsed.data.captured) || new Date().toISOString(),
    thumbnail,
    content: "",
    metadata: {
      video_url: videoId ? embeddedMediaUrl : undefined,
      format: videoId ? "video" : parsed.data.format,
    },
  };

  const cache = needsCache && extractionUrl ? await extractSourceCache(extractionUrl, Boolean(videoId)) : null;
  let body = parsed.body;
  const media = buildMediaMarkdown(raw);
  const beforeMedia = body;
  body = addMediaSection(body, media);
  const mediaAdded = beforeMedia !== body;
  if (cache) body = replaceSection(body, "Raw Content", rawContentMarkdown(cache));

  const nextData: Record<string, unknown> = {
    ...parsed.data,
    description: descriptionFromBody(parsed.body, parsed.data.description),
    url: canonicalUrl,
    format: videoId ? "video" : parsed.data.format,
    author,
    published: nextPublished,
    video_url: videoId ? embeddedMediaUrl : parsed.data.video_url,
    thumbnail,
    digestion_status: cache ? "hot" : parsed.data.digestion_status,
    digested_with: cache ? "summarize-cli" : parsed.data.digested_with,
    digested_at: cache ? cache.captured_at : parsed.data.digested_at,
    cached_source_chars: cache ? cache.chars : parsed.data.cached_source_chars,
    cached_source_extractor: cache ? cache.extractor : parsed.data.cached_source_extractor,
    redigested_at: cache ? isoNow() : parsed.data.redigested_at,
  };
  for (const key of Object.keys(nextData)) {
    if (nextData[key] === undefined || nextData[key] === null || nextData[key] === "") delete nextData[key];
  }

  const changed = frontmatterChanged(parsed.data, nextData) || body !== parsed.body;
  if (write && changed) atomicWriteFile(filePath, stringifyMarkdown(nextData, body));

  return {
    path: relativePath,
    status: changed ? (write ? "updated" : "dry_run") : "unchanged",
    title,
    published: nextData.published || null,
    video_url: nextData.video_url || null,
    media_added: mediaAdded && Boolean(media.trim()),
    cache_added: Boolean(cache),
    cache_chars: cache?.chars || Number(parsed.data.cached_source_chars || 0),
    preserved_summary: Boolean(extractSection(parsed.body, "Summary").trim()),
    preserved_connections: Boolean(extractSection(parsed.body, "Connections").trim()),
  };
}

async function main() {
  const files = selectedPaths();
  const results = [];
  for (const filePath of files) {
    results.push(await repairFile(filePath));
  }
  console.log(JSON.stringify({ write, refresh_cache: refreshCache, checked: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
