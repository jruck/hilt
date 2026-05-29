import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { LibrarySourceConfig, ProcessedArtifact, RawArtifact, SaveRecommendation } from "./types";
import { isoNow, scoreClamp } from "./utils";
import { isXVideoUrl, isYouTubeUrl } from "./media";
import { enrichRawArtifactMedia } from "./media-enrichment";
import { buildKbIndex, judgeConnections } from "./connections";
import { extractBullets } from "./markdown";

const execFileAsync = promisify(execFile);

const DIGEST_PROMPT = [
  "Write a 2-4 sentence narrative summary of this source for a personal reference library.",
  "Then a blank line.",
  "Then a line that is EXACTLY \"Key takeaways:\" on its own.",
  "Then 3-6 distinct markdown bullets, where each bullet is a standalone insight that does NOT restate the narrative summary.",
  "Ignore newsletter/site chrome, navigation, invisible tracking text, subscription/forwarding/unsubscribe boilerplate, and email metadata.",
  "Extract the actual argument, claims, examples, and implications.",
].join(" ");

function isUrlOnlyText(text: string): boolean {
  const compact = text.trim();
  return Boolean(compact) && compact.split(/\s+/).every((token) => /^https?:\/\/\S+$/i.test(token));
}

function sentences(text: string): string[] {
  return text
    .replace(/\bvs\./gi, "vs__DOT__")
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.replace(/vs__DOT__/gi, "vs.").trim())
    .filter((line) => line.length > 20 && !isUrlOnlyText(line));
}

function stripMarkdown(text: string): string {
  return text
    .replace(/(\s)(#{1,6}\s+[^\n*]+?)\s+\*\s+/g, "\n$2\n- ")
    .replace(/(^|\n)(#{1,6}\s+[^\n*]+?)\s+\*\s+/g, "$1$2\n- ")
    .replace(/^\s{0,3}#{1,6}\s+.+$/gm, " ")
    .replace(/^\s*[-*]\s+/gm, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*\n]+)\*/g, "$1")
    .replace(/(^|\s)#{1,6}\s+/g, "$1")
    .replace(/(^|\s)[-*]\s+(?=\S)/g, "$1")
    .trim();
}

function isXUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(url);
}

function stripInvisibleTracking(text: string): string {
  return text
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripWebChrome(text: string): string {
  const navWords = "Products|Solutions|Pricing|Login|Sign in|Sign up|Menu|Search|Home|Contact|About|Careers|Subscribe|Cookie|Accept|Privacy|Terms|Skip to content|NEW";
  return text
    // Collapse immediately-repeated tokens/short phrases ("Products Products", "North North").
    .replace(/\b([A-Za-z][\w'-]{1,20})(\s+\1\b)+/gi, "$1")
    // Strip standalone nav words only in high-capitalization segments without sentence punctuation.
    .replace(/[^.!?\n]*\b(?:[A-Z][\w'-]*\s+){0,8}(?:Products|Solutions|Pricing|Login|Sign in|Sign up|Menu|Search|Home|Contact|About|Careers|Subscribe|Cookie|Accept|Privacy|Terms|Skip to content|NEW)\b[^.!?\n]*/g, (segment) => {
      // Only treat as chrome when the segment is dominated by Title/UPPER tokens and has no sentence punctuation.
      const words = segment.trim().split(/\s+/).filter(Boolean);
      if (!words.length) return segment;
      const capitalized = words.filter((word) => /^[A-Z]/.test(word)).length;
      const hasSentencePunctuation = /[.!?]/.test(segment);
      const navRegex = new RegExp(`\\b(?:${navWords})\\b`);
      if (!hasSentencePunctuation && capitalized / words.length >= 0.6 && navRegex.test(segment)) {
        return " ";
      }
      return segment;
    });
}

function cleanSourceForDigest(text: string): string {
  const compact = stripInvisibleTracking(text);
  const dechromed = stripWebChrome(compact
    .replace(/\bForwarded this email\?\s*Subscribe here for more\.?/gi, " ")
    .replace(/\bREAD IN APP\b/gi, " ")
    .replace(/\bKeep reading with a \d+-day free trial[\s\S]*?(?=\b[A-Z][a-z]|\n|$)/gi, " ")
    .replace(/\bSubscribe to [^.]{1,120} to keep reading this post[^.]*\.?/gi, " ")
    .replace(/\bYou're currently a free subscriber[^.]*\.?/gi, " ")
    .replace(/\bUpgrade to paid\b/gi, " ")
    .replace(/\bLike\. Comment\. Restack\.?/gi, " ")
    .replace(/\bMetrics:\s*.*$/gi, " ")
    .replace(/©\s+\d{4}[\s\S]{0,220}\bUnsubscribe\.?/gi, " "));
  return dechromed
    .replace(/\s+/g, " ")
    .trim();
}

function parseDigestOutput(raw: string): { summary: string; keyPoints: string[] } {
  const lines = raw.split(/\r?\n/);
  const markerIndex = lines.findIndex((line) => /^\s*(?:key\s+)?takeaways:?\s*$/i.test(line));
  if (markerIndex === -1) {
    const summary = stripMarkdown(raw).replace(/\s+/g, " ").trim();
    return { summary, keyPoints: [] };
  }
  const narrative = lines.slice(0, markerIndex).join("\n");
  const bulletsBlock = lines.slice(markerIndex + 1).join("\n");
  const summary = stripMarkdown(narrative).replace(/\s+/g, " ").trim();
  const keyPoints = Array.from(new Set(
    extractBullets(bulletsBlock)
      .map((bullet) => stripMarkdown(bullet).replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )).slice(0, 6);
  return { summary, keyPoints };
}

function firstHttpUrl(text: string): string | null {
  return text.match(/https?:\/\/[^\s)>"]+/i)?.[0].replace(/[.,;:!?]+$/, "") || null;
}

function stripUrls(text: string): string {
  return text.replace(/https?:\/\/\S+/gi, " ").replace(/\s+/g, " ").trim();
}

function cleanTitleText(text: string): string {
  return stripUrls(stripInvisibleTracking(text))
    .replace(/^(Author|Published|Links):\s*.*$/gim, " ")
    .replace(/\s+/g, " ")
    .replace(/[ \t:;,-]+$/g, "")
    .trim();
}

function titleFromSourceText(text: string | null | undefined): string | null {
  if (!text) return null;
  const line = text.split(/\r?\n/).map(cleanTitleText).find((candidate) => candidate.length >= 12);
  return line ? line.slice(0, 140) : null;
}

function normalizeXTitle(raw: RawArtifact, linkedXContent: string | null): RawArtifact {
  const current = cleanTitleText(raw.title);
  if (current && current !== raw.title.trim()) {
    return { ...raw, title: current.slice(0, 140) };
  }
  if (current) return raw;
  const linkedTitle = titleFromSourceText(linkedXContent || raw.content);
  return {
    ...raw,
    title: linkedTitle || (raw.author ? `X bookmark by ${raw.author}` : "X bookmark"),
  };
}

function xStatusId(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/\/status\/(\d+)/)?.[1] || null;
}

async function resolveShortUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { method: "HEAD", redirect: "manual" });
    return response.headers.get("location");
  } catch {
    return null;
  }
}

async function resolveLinkedUrl(raw: RawArtifact): Promise<string | null> {
  const expanded = typeof raw.metadata.expanded_url === "string" ? raw.metadata.expanded_url : null;
  if (expanded && /^https?:\/\//.test(expanded)) return expanded;
  const inline = firstHttpUrl(raw.content || "");
  if (!inline) return null;
  if (/^https?:\/\/t\.co\//i.test(inline)) return resolveShortUrl(inline) || inline;
  return inline;
}

async function fetchXPostText(url: string, source: LibrarySourceConfig): Promise<string | null> {
  const id = xStatusId(url);
  if (!id) return null;
  const xurlBin = String(source.metadata.xurl_path || process.env.XURL_BIN || "");
  if (!xurlBin) return null;
  try {
    const { stdout } = await execFileAsync(xurlBin, ["read", id, "--auth", "oauth2"], { timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
    const parsed = JSON.parse(stdout) as {
      data?: {
        text?: string;
        created_at?: string;
        public_metrics?: Record<string, unknown>;
        entities?: { urls?: Array<{ expanded_url?: string; display_url?: string; url?: string }> };
      };
      includes?: { users?: Array<{ username?: string; name?: string }> };
    };
    const text = stripInvisibleTracking(parsed.data?.text || "");
    if (!text) return null;
    const user = parsed.includes?.users?.[0];
    const links = (parsed.data?.entities?.urls || [])
      .map((item) => item.expanded_url || item.display_url || item.url)
      .filter(Boolean)
      .join("\n");
    return [
      text,
      user?.name || user?.username ? `Author: ${user.name || user.username}` : "",
      parsed.data?.created_at ? `Published: ${parsed.data.created_at}` : "",
      links ? `Links:\n${links}` : "",
    ].filter(Boolean).join("\n\n");
  } catch {
    return null;
  }
}

function numericEnv(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function durationToMs(value: string | undefined, fallbackMs: number): number {
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

async function summarizeUrl(url: string): Promise<string | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1") return null;
  const timeoutValue = process.env.LIBRARY_SUMMARIZE_TIMEOUT || "3m";
  const args = [
    url,
    "--plain",
    "--no-color",
    "--length",
    process.env.LIBRARY_SUMMARIZE_LENGTH || "medium",
    "--timeout",
    timeoutValue,
    "--prompt",
    DIGEST_PROMPT,
  ];
  if (process.env.LIBRARY_SUMMARIZE_MODEL) {
    args.push("--model", process.env.LIBRARY_SUMMARIZE_MODEL);
  }
  try {
    const { stdout } = await execFileAsync("summarize", args, { timeout: durationToMs(timeoutValue, 210000) + 5000, maxBuffer: 1024 * 1024 * 4 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

async function summarizeText(title: string, content: string): Promise<string | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1") return null;
  const trimmed = content.trim();
  if (trimmed.length < 400) return null;
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "hilt-library-summarize-"));
  const filePath = path.join(dir, "source.md");
  const timeoutValue = process.env.LIBRARY_SUMMARIZE_TIMEOUT || "3m";
  const args = [
    filePath,
    "--plain",
    "--no-color",
    "--force-summary",
    "--length",
    process.env.LIBRARY_SUMMARIZE_LENGTH || "medium",
    "--timeout",
    timeoutValue,
    "--prompt",
    DIGEST_PROMPT,
  ];
  if (process.env.LIBRARY_SUMMARIZE_MODEL) {
    args.push("--model", process.env.LIBRARY_SUMMARIZE_MODEL);
  }
  try {
    await fs.promises.writeFile(filePath, `# ${title}\n\n${trimmed}`, "utf-8");
    const { stdout } = await execFileAsync("summarize", args, { timeout: durationToMs(timeoutValue, 210000) + 5000, maxBuffer: 1024 * 1024 * 4 });
    return stdout.trim() || null;
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function extractSourceContent(raw: RawArtifact, source: LibrarySourceConfig): Promise<ProcessedArtifact["source_cache"] | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1" || process.env.LIBRARY_FULL_CONTENT_DISABLED === "1") return null;
  if (!/^https?:\/\//.test(raw.url)) return null;

  const maxCharacters = process.env.LIBRARY_MAX_EXTRACT_CHARACTERS || "200000";
  const timeoutValue = process.env.LIBRARY_EXTRACT_TIMEOUT || process.env.LIBRARY_SUMMARIZE_TIMEOUT || "3m";
  const args = [
    raw.url,
    "--extract",
    "--format",
    "md",
    "--plain",
    "--no-color",
    "--max-extract-characters",
    maxCharacters,
    "--timeout",
    timeoutValue,
  ];

  if (source.channel === "youtube" || isYouTubeUrl(raw.url) || raw.metadata.format === "video") {
    args.push("--youtube", process.env.LIBRARY_YOUTUBE_TRANSCRIPT_SOURCE || "auto");
    args.push("--video-mode", "transcript");
    args.push("--timestamps");
    if (process.env.LIBRARY_EXTRACT_SLIDES === "1") {
      args.push("--slides");
      args.push("--slides-max", process.env.LIBRARY_EXTRACT_SLIDES_MAX || "4");
    }
  }

  try {
    const { stdout } = await execFileAsync("summarize", args, { timeout: durationToMs(timeoutValue, 240000) + 5000, maxBuffer: 1024 * 1024 * 12 });
    const content = stdout.trim();
    if (!content || content.length < 40) return null;
    return {
      kind: source.channel === "youtube" || isYouTubeUrl(raw.url) ? "transcript" : source.channel === "raindrop" || source.channel === "rss" ? "article" : "source",
      extractor: "summarize-cli",
      captured_at: isoNow(),
      content,
      chars: content.length,
    };
  } catch {
    return null;
  }
}

function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)));
}

function readableHtmlText(html: string, maxCharacters: number): string {
  const withoutHeavyBlocks = html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[\s\S]*?<\/svg>/gi, "")
    .replace(/data:image\/[^"')\s]+/gi, "");
  const withBreaks = withoutHeavyBlocks
    .replace(/<\/(h[1-6]|p|li|blockquote|tr|div|section|article|header|footer)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[\s\S]*?>/gi, "- ");
  return decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, " "))
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, maxCharacters);
}

async function fetchRaindropCache(raw: RawArtifact): Promise<ProcessedArtifact["source_cache"] | null> {
  if (process.env.LIBRARY_RAINDROP_CACHE_DISABLED === "1") return null;
  const id = raw.metadata.raindrop_id;
  if ((typeof id !== "string" && typeof id !== "number") || !process.env.RAINDROP_TOKEN) return null;
  const cacheStatus = typeof raw.metadata.cache_status === "string" ? raw.metadata.cache_status : "";
  if (cacheStatus && cacheStatus !== "ready") return null;

  try {
    const response = await fetch(`https://api.raindrop.io/rest/v1/raindrop/${encodeURIComponent(String(id))}/cache`, {
      headers: { Authorization: `Bearer ${process.env.RAINDROP_TOKEN}` },
    });
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    const maxCharacters = numericEnv(process.env.LIBRARY_RAINDROP_CACHE_MAX_CHARS, 200000);
    const content = contentType.includes("html")
      ? readableHtmlText(text, maxCharacters)
      : text.trim().slice(0, maxCharacters);
    if (content.length < 80) return null;
    return {
      kind: "article",
      extractor: "raindrop-cache",
      captured_at: isoNow(),
      content,
      chars: content.length,
    };
  } catch {
    return null;
  }
}

function inferFormat(raw: RawArtifact, source: LibrarySourceConfig): string {
  const explicit = typeof raw.metadata.format === "string" ? raw.metadata.format : null;
  if (explicit) return explicit;
  if (source.channel === "youtube") return "video";
  if (source.channel === "twitter") return "tweet";
  if (source.channel === "email") return "newsletter";
  if (source.channel === "raindrop") return "bookmark";
  return "article";
}

function scoreArtifact(raw: RawArtifact, source: LibrarySourceConfig, summary: string): ProcessedArtifact["score"] {
  if (source.intent === "explicit_save") {
    return { relevance: 1, novelty: 0.8, confidence: 0.9, total: 0.95 };
  }
  const haystack = `${raw.title} ${raw.content || ""} ${summary}`.toLowerCase();
  const includeMatches = source.filters.include_topics.filter((topic) => haystack.includes(topic.toLowerCase())).length;
  const excludeMatches = source.filters.exclude_topics.filter((topic) => haystack.includes(topic.toLowerCase())).length;
  const tagMatches = source.tags.filter((tag) => haystack.includes(tag.toLowerCase())).length;
  const relevance = scoreClamp(0.45 + Math.min(0.25, includeMatches * 0.08) + Math.min(0.15, tagMatches * 0.03) - Math.min(0.3, excludeMatches * 0.12));
  const novelty = scoreClamp(raw.content || summary ? 0.65 : 0.35);
  const confidence = scoreClamp(summary.length > 120 ? 0.78 : 0.45);
  const total = scoreClamp((relevance * 0.5) + (novelty * 0.2) + (confidence * 0.3));
  return { relevance, novelty, confidence, total };
}

function recommendation(score: ProcessedArtifact["score"], source: LibrarySourceConfig): SaveRecommendation {
  if (source.intent === "explicit_save") return "file";
  if (score.total >= source.retention.auto_promote_threshold) return "file";
  if (score.total < 0.35) return "skip";
  return "review";
}

/**
 * Slugs of the active projects in the vault. Used to split LLM connection targets into
 * connected_projects (project slugs) vs. all other connection kinds (areas, people, themes).
 */
function projectSlugSet(vaultPath: string): Set<string> {
  try {
    const dir = path.join(vaultPath, "projects");
    if (!fs.existsSync(dir)) return new Set();
    return new Set(
      fs.readdirSync(dir, { withFileTypes: true })
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => (entry.isDirectory() ? entry.name : entry.name.replace(/\.md$/, "")))
        .filter((name) => name && name !== "index"),
    );
  } catch {
    return new Set();
  }
}

export async function digestArtifact(
  raw: RawArtifact,
  source: LibrarySourceConfig,
  options: { useSummarize?: boolean; vaultPath?: string; preferCachedSource?: boolean } = {},
): Promise<ProcessedArtifact> {
  const extractionNotes: string[] = [];
  const mediaEnrichment = await enrichRawArtifactMedia(raw, {
    disabled: source.channel === "raindrop" && Boolean(raw.metadata.raindrop_id),
  });
  raw = mediaEnrichment.raw;
  extractionNotes.push(...mediaEnrichment.notes);

  const requestedSummarize = options.useSummarize ?? true;
  const xSource = source.channel === "twitter" || isXUrl(raw.url);
  const linkedUrl = xSource ? await resolveLinkedUrl(raw) : null;
  const linkedXContent = linkedUrl && isXUrl(linkedUrl) ? await fetchXPostText(linkedUrl, source) : null;
  const summarizeTarget = linkedUrl && /^https?:\/\//.test(linkedUrl) && !isXUrl(linkedUrl)
    ? linkedUrl
    : raw.url;
  if (linkedUrl && linkedUrl !== raw.url) {
    extractionNotes.push(`Resolved linked URL from source metadata: ${linkedUrl}`);
  }
  if (linkedXContent) {
    extractionNotes.push("Fetched linked X post text for digest context.");
  } else if (xSource && linkedUrl && isXUrl(linkedUrl) && !xStatusId(linkedUrl)) {
    extractionNotes.push("Linked X URL is not a standard post URL; source text remains metadata-limited.");
  }
  if (xSource) {
    const normalizedTitle = normalizeXTitle(raw, linkedXContent);
    if (normalizedTitle.title !== raw.title) {
      raw = normalizedTitle;
      extractionNotes.push("Normalized X/Twitter title by removing duplicate URL text.");
    }
  }
  if (xSource && linkedUrl && isXVideoUrl(linkedUrl)) {
    const existingMedia = Array.isArray(raw.metadata.media) ? raw.metadata.media : [];
    const hasLinkedVideo = existingMedia.some((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return record.link === linkedUrl || record.embed_url === linkedUrl;
    });
    raw = {
      ...raw,
      metadata: {
        ...raw.metadata,
        expanded_url: typeof raw.metadata.expanded_url === "string" ? raw.metadata.expanded_url : linkedUrl,
        video_url: linkedUrl,
        media: hasLinkedVideo ? existingMedia : [
          { link: linkedUrl, type: "video", source: "x_linked_post" },
          ...existingMedia,
        ],
      },
    };
    extractionNotes.push("Added linked X video embed metadata.");
  }
  const shouldSummarizeUrl = requestedSummarize && (!xSource || (linkedUrl ? !isXUrl(linkedUrl) : false));
  const contentParts = xSource && linkedXContent
    ? [linkedXContent, raw.content || ""]
    : [raw.content || "", linkedXContent || ""];
  const cleanedRawContent = cleanSourceForDigest(contentParts.filter(Boolean).join("\n\n"));
  // When the caller prefers the cached/source text and it is substantial and not chrome,
  // summarize from the cached text locally and skip the network round-trips.
  const preferCachedSource = Boolean(
    options.preferCachedSource &&
    cleanedRawContent.length >= 400 &&
    sentences(cleanedRawContent).length >= 2,
  );
  let summarized = shouldSummarizeUrl && !preferCachedSource && /^https?:\/\//.test(summarizeTarget)
    ? await summarizeUrl(summarizeTarget)
    : null;
  if (!summarized && requestedSummarize && cleanedRawContent.length >= 400) {
    summarized = await summarizeText(raw.title, cleanedRawContent);
    if (summarized) {
      extractionNotes.push(preferCachedSource
        ? "Preferred cached source text; summarized it with summarize CLI (no network re-extraction)."
        : "Summarized source-provided text with summarize CLI.");
    }
  }
  let sourceCache = shouldSummarizeUrl && !preferCachedSource ? await extractSourceContent({ ...raw, url: summarizeTarget }, source) : null;
  if (!sourceCache && source.channel === "raindrop" && !xSource) {
    sourceCache = await fetchRaindropCache(raw);
    if (sourceCache) {
      extractionNotes.push("Used Raindrop permanent copy as cached source fallback.");
    }
  }
  // Low-sentence guard: source text that yields fewer than 2 real sentences is treated as
  // site navigation / chrome and is not allowed to become the cached source or the summary.
  const cleanedRawContentLooksLikeChrome = Boolean(cleanedRawContent)
    && !xSource
    && !isUrlOnlyText(cleanedRawContent)
    && sentences(cleanedRawContent).length < 2;
  if (!sourceCache && cleanedRawContent && !isUrlOnlyText(cleanedRawContent) && !cleanedRawContentLooksLikeChrome) {
    sourceCache = {
      kind: "source",
      extractor: "source-metadata",
      captured_at: isoNow(),
      content: cleanedRawContent,
      chars: cleanedRawContent.length,
    };
    extractionNotes.push(xSource
      ? "Used X/Twitter source text as canonical source metadata."
      : "Used source-provided text as cached source fallback.");
  } else if (!sourceCache && cleanedRawContentLooksLikeChrome) {
    extractionNotes.push("Source text looked like site navigation; used title/excerpt instead.");
  }
  if (shouldSummarizeUrl && !summarized && /^https?:\/\//.test(summarizeTarget)) {
    extractionNotes.push("summarize CLI was unavailable or failed; used source metadata/content fallback.");
  }
  if (shouldSummarizeUrl && !sourceCache && /^https?:\/\//.test(summarizeTarget)) {
    extractionNotes.push("Full source extraction was unavailable; Raw Content uses source-provided metadata/content fallback.");
  }

  const format = inferFormat(raw, source);
  const metadataExcerpt = typeof raw.metadata.excerpt === "string" ? raw.metadata.excerpt : "";
  // The source text used to derive fallback sentences. When the cleaned content looked like
  // chrome, never let it become the summary; fall back to the excerpt or title instead.
  const digestSource = (sourceCache?.extractor === "source-metadata" ? contentParts.filter(Boolean).join("\n\n") : sourceCache?.content)
    || (cleanedRawContentLooksLikeChrome ? "" : raw.content)
    || metadataExcerpt
    || raw.title;
  const sourceText = cleanSourceForDigest(stripMarkdown(digestSource));
  const sourceSentences = sentences(sourceText);
  const fallbackSummary = sourceSentences.slice(0, 4).join(" ") || raw.title;
  // Prefer genuine markdown bullets from the source (distinct standalone insights); otherwise
  // take the NEXT sentences after the summary so key points are never a copy of slice(0,5).
  const sourceBullets = Array.from(new Set(
    extractBullets(digestSource)
      .map((bullet) => stripMarkdown(bullet).replace(/\s+/g, " ").trim())
      .filter(Boolean),
  )).slice(0, 6);
  const fallbackKeyPoints = sourceBullets.length ? sourceBullets : sourceSentences.slice(4, 9);
  let summary: string;
  let keyPoints: string[];
  if (summarized) {
    const parsed = parseDigestOutput(summarized);
    summary = parsed.summary || fallbackSummary;
    keyPoints = parsed.keyPoints.length ? parsed.keyPoints : fallbackKeyPoints;
    if (!keyPoints.length) keyPoints = [raw.title];
  } else {
    summary = fallbackSummary;
    keyPoints = fallbackKeyPoints.length ? fallbackKeyPoints : [raw.title];
  }
  const sourceLimitedComplete = Boolean(summarized && format !== "video" && sourceText.length > 0 && sourceText.length < 700);
  const substantialSummary = Boolean(summarized && summary.length >= 500 && sourceText.length >= 1000);
  const sourceCacheComplete = Boolean(sourceCache && sourceText.length >= 1000 && summary.length >= 160 && sourceSentences.length >= 3);
  const xSourceComplete = Boolean(xSource && sourceText.length >= 80 && !isUrlOnlyText(sourceText));
  if (sourceLimitedComplete) {
    extractionNotes.push("Source content is short; digest marked complete as source-limited.");
  }
  const hotDigestion = Boolean(
    (summarized && ((summary.length >= 160 && keyPoints.length >= 3) || substantialSummary || sourceLimitedComplete)) ||
    sourceCacheComplete ||
    xSourceComplete
  );
  const score = scoreArtifact(raw, source, summary);
  const saveRecommendation = recommendation(score, source);
  const tags = Array.from(new Set([
    ...source.tags,
    ...(Array.isArray(raw.metadata.tags) ? raw.metadata.tags.map(String) : []),
  ].map((tag) => tag.trim()).filter(Boolean)));
  const proposedDestination = typeof raw.metadata.proposed_destination === "string"
    ? raw.metadata.proposed_destination
    : source.channel === "youtube" || source.channel === "twitter"
      ? "references/process"
      : "references";
  // LLM connection judgment runs ONLY when the artifact will be durably saved — explicit-save
  // sources, or discovery items the policy recommends filing. Candidates that stay in the review
  // cache get no connections (no LLM spend) until they are promoted/re-judged.
  const willBeDurablySaved = source.intent === "explicit_save" || saveRecommendation === "file";
  let connectionSuggestions: ProcessedArtifact["connection_suggestions"] = [];
  let connectedProjects: string[] = [];
  let connectionReasoning = "";
  let reweaveCandidates: ProcessedArtifact["reweave_candidates"] = [];
  const vaultPath = options.vaultPath || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER;
  if (willBeDurablySaved && process.env.LIBRARY_CONNECTIONS_DISABLED !== "1" && vaultPath) {
    const kbIndex = buildKbIndex(vaultPath);
    const judgment = await judgeConnections(kbIndex, {
      title: raw.title,
      summary,
      keyPoints,
      sourceExcerpt: sourceCache?.content || raw.content || metadataExcerpt || summary,
    });
    connectionSuggestions = judgment.connections;
    connectionReasoning = judgment.reasoning;
    reweaveCandidates = judgment.reweave_candidates || [];
    const projectSlugs = projectSlugSet(vaultPath);
    connectedProjects = Array.from(new Set(
      judgment.connections
        .map((suggestion) => suggestion.target)
        .filter((target): target is string => Boolean(target) && projectSlugs.has(target as string)),
    ));
  }
  const connectionWhy = connectionReasoning ? ` ${connectionReasoning}` : "";

  return {
    raw,
    source,
    format,
    summary,
    key_points: keyPoints.length ? keyPoints : [raw.title],
    assessment: {
      save_recommendation: saveRecommendation,
      why: source.intent === "explicit_save"
        ? `The source action is configured as explicit save intent.${connectionWhy}`
        : `Discovery score ${score.total.toFixed(2)} against source policy.${connectionWhy}`,
      what_changed: "",
      what_is_suspect: extractionNotes.length ? "Extraction fell back to available metadata." : "",
    },
    score,
    tags,
    proposed_destination: proposedDestination,
    connected_projects: connectedProjects,
    connection_suggestions: connectionSuggestions,
    connection_reasoning: connectionReasoning || undefined,
    reweave_candidates: reweaveCandidates && reweaveCandidates.length ? reweaveCandidates : undefined,
    reasoning: source.intent === "explicit_save" ? "Explicit save signal" : "Automated discovery assessment",
    extraction_notes: extractionNotes,
    digestion: {
      status: hotDigestion ? "hot" : "warm",
      extractor: summarized ? "summarize-cli" : "source-metadata",
      digested_at: isoNow(),
      extracted_chars: sourceText.length,
      cached_source_chars: sourceCache?.chars,
      cached_source_extractor: sourceCache?.extractor,
    },
    source_cache: sourceCache || undefined,
  };
}
