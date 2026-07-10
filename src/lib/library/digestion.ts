import { execFile } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { promisify } from "util";
import type { DigestionProgressEvent, LibraryProcessingStage, LibrarySourceConfig, ProcessedArtifact, RawArtifact, SaveRecommendation } from "./types";
import { isoNow, scoreClamp } from "./utils";
import { isXVideoUrl, isYouTubeUrl, looksLikeThreadRoot } from "./media";
import { enrichRawArtifactMedia } from "./media-enrichment";
import { buildKbIndex, reweaveArtifact } from "./connections";
import { CODE_URL_RE, VIDEO_URL_RE } from "./content-type";
import { extractBullets } from "./markdown";
import { DIGEST_PROMPT } from "./pipeline";
import { artifactTaxonomy } from "./taxonomy";
import { getVideoDurationSeconds, isLikelyVideoUrl } from "./video-duration";
import { extractXVideoTranscript } from "./x-video-transcript";
import { detectYouTubeContentForm } from "./youtube-clip-detector";
import { loginWallVerdict, looksLikeBinaryGarbage } from "./capture-health";
import { extractPdfText, isPdfUrl, looksLikePdf } from "./pdf";
import { seriesFromRaw } from "./series";

const execFileAsync = promisify(execFile);

// External dependency: the summarize CLI (https://summarize.sh, `npm i -g @steipete/summarize`).
// Hilt references it rather than vendoring it. Resolve the binary per call (mirrors XURL_BIN) so
// non-PATH installs and remote machines can point at an explicit path, and degrade gracefully with
// install guidance when it is missing instead of failing opaquely.
let warnedMissingSummarize = false;
let warnedUnknownOption = false;

async function runSummarize(args: string[], options: { timeout: number; maxBuffer: number }): Promise<string | null> {
  const bin = process.env.SUMMARIZE_BIN || "summarize";
  try {
    const { stdout } = await execFileAsync(bin, args, options);
    return stdout.trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT" && !warnedMissingSummarize) {
      warnedMissingSummarize = true;
      console.warn(
        `[library] summarize CLI not found (tried "${bin}"). Install it with ` +
        `\`npm i -g @steipete/summarize\` (https://summarize.sh), set SUMMARIZE_BIN to its path, ` +
        `or set LIBRARY_SUMMARIZE_DISABLED=1 to skip digestion summaries.`,
      );
    }
    // A removed/renamed CLI flag (version drift) otherwise nulls EVERY digest silently — degrading the
    // whole library to structural fallbacks with no signal. Surface it loudly so it can't hide again.
    const stderr = (error as { stderr?: string })?.stderr || "";
    if (/unknown option|unknown argument|unrecognized option/i.test(stderr) && !warnedUnknownOption) {
      warnedUnknownOption = true;
      const flag = stderr.match(/unknown option '?(--[a-z-]+)'?/i)?.[1] || "(see stderr)";
      console.warn(
        `[library] summarize CLI rejected ${flag} — the installed summarize version (run \`summarize --version\`) ` +
        `does not support a flag Hilt passes. Digests are falling back to structural extracts until the flags ` +
        `in digestion.ts are reconciled with the CLI. stderr: ${stderr.trim().slice(0, 200)}`,
      );
    }
    return null;
  }
}

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

/** An X Article share (x.com/i/article/<id>): a login-walled long-form post the API can't read. The
 *  bookmarked tweet is just a wrapper whose only text is a t.co link to the article — the user's
 *  intent is to save the article itself, so we classify it as an x-article and route it to browser
 *  recovery rather than landing it as a bare metadata stub. */
function isXArticleUrl(url: string | null | undefined): boolean {
  return Boolean(url && /^https?:\/\/(?:www\.)?x\.com\/i\/article\/\d+/i.test(url));
}

function stripInvisibleTracking(text: string): string {
  return text
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripInvisibleCharacters(text: string): string {
  return text
    .replace(/[\u00ad\u034f\u061c\u180e\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
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

/**
 * Detect when an L1 "digest" is actually a raw transcript / source dump rather than a summary. The
 * summarize CLI can pass verbatim source text straight through — notably YouTube
 * `--video-mode transcript`, whose output is the full transcript (usually led by a "Transcript:"
 * label). Using that as the digest body bloats the file, poisons the derived description, and — because
 * a 100k+ body makes the connection pass time out — leaves the item unable to self-heal. We treat such
 * output as a FAILED digest: drop it, fall back to a structural summary, and flag the item for reweave.
 */
export function looksLikeRawTranscriptDump(text: string | null | undefined): boolean {
  const t = (text || "").trim();
  if (!t) return false;
  // Strongest signal: summarize's video passthrough labels the verbatim transcript.
  if (/^transcript:\s/i.test(t)) return true;
  // Backstop: a genuine digest is bounded and structured (headings or several bullets); a raw
  // transcript is a very long wall of spoken text with essentially no markdown structure.
  const veryLong = t.length > 12000;
  const hasStructure = /(^|\n)#{1,4}\s/.test(t) || (t.match(/(^|\n)\s*[-*]\s/g) || []).length >= 3;
  return veryLong && !hasStructure;
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

/**
 * A short feed-card description derived from the free-form L1 digest (first sentence or two,
 * stripped + truncated). Used when there is no reweave to supply its own `description`.
 */
function deriveDescription(markdown: string): string {
  const plain = stripMarkdown(markdown).replace(/\s+/g, " ").trim();
  const firstTwo = sentences(plain).slice(0, 2).join(" ");
  return (firstTwo || plain).slice(0, 280).trim();
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
  return line ? line.slice(0, 180) : null;
}

function titleLooksTruncated(text: string): boolean {
  return text.length >= 110 || /\b(?:about|learned|here'?s|what|why|how|because)$/i.test(text.trim());
}

function normalizeXTitle(raw: RawArtifact, linkedXContent: string | null): RawArtifact {
  const current = cleanTitleText(raw.title);
  const linkedTitle = titleFromSourceText(linkedXContent || raw.content);
  if (current && linkedTitle && titleLooksTruncated(current) && linkedTitle.length > current.length) {
    return { ...raw, title: linkedTitle };
  }
  if (current && current !== raw.title.trim()) {
    return { ...raw, title: current.slice(0, 140) };
  }
  if (current) return raw;
  return {
    ...raw,
    title: linkedTitle || (raw.author ? `X bookmark by ${raw.author}` : "X bookmark"),
  };
}

function xStatusId(url: string | null | undefined): string | null {
  if (!url) return null;
  return url.match(/\/status\/(\d+)/)?.[1] || null;
}

function metadataNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function metadataString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

// We can fetch the root tweet and any long-form note_tweet, but the X API plan in use has no search
// access, so a thread's continuation tweets can't be retrieved — we flag the capture as partial
// rather than silently presenting tweet 1 of N.
interface XPostFetch {
  text: string;
  partialThread: boolean;
  videoUrl?: string;
  thumbnail?: string;
  videoDurationSeconds?: number;
}

async function fetchXPostText(url: string, source: LibrarySourceConfig): Promise<XPostFetch | null> {
  const id = xStatusId(url);
  if (!id) return null;
  const xurlBin = String(source.metadata.xurl_path || process.env.XURL_BIN || "");
  if (!xurlBin) return null;
  const apiPath = `/2/tweets/${id}?tweet.fields=note_tweet,conversation_id,created_at,entities,attachments&expansions=author_id,attachments.media_keys&user.fields=username,name&media.fields=media_key,type,url,preview_image_url,duration_ms`;
  try {
    const { stdout } = await execFileAsync(xurlBin, ["-X", "GET", apiPath, "--auth", "oauth2"], { timeout: 30000, maxBuffer: 1024 * 1024 * 4 });
    const parsed = JSON.parse(stripInvisibleTracking(stdout)) as {
      data?: {
        id?: string;
        text?: string;
        created_at?: string;
        conversation_id?: string;
        note_tweet?: { text?: string };
        entities?: { urls?: Array<{ expanded_url?: string; display_url?: string; url?: string }> };
        attachments?: { media_keys?: string[] };
      };
      includes?: {
        users?: Array<{ username?: string; name?: string }>;
        media?: Array<{ media_key?: string; type?: string; preview_image_url?: string; duration_ms?: number }>;
      };
    };
    // Prefer the long-form note_tweet body (up to 25k chars) over the 280-char truncation.
    const fullText = stripInvisibleCharacters(parsed.data?.note_tweet?.text || parsed.data?.text || "");
    if (!fullText) return null;
    const isThreadRoot = Boolean(parsed.data?.conversation_id && parsed.data.conversation_id === parsed.data.id);
    // A long-form note_tweet usually carries the whole thread inline; a short root tweet that looks
    // like a thread means the rest is in unreachable reply tweets.
    const partialThread = isThreadRoot && !parsed.data?.note_tweet?.text && looksLikeThreadRoot(fullText);
    const user = parsed.includes?.users?.[0];
    const links = (parsed.data?.entities?.urls || [])
      .map((item) => item.expanded_url || item.display_url || item.url)
      .filter(Boolean)
      .join("\n");
    const mediaByKey = new Map((parsed.includes?.media || [])
      .filter((item) => item.media_key)
      .map((item) => [String(item.media_key), item]));
    const attachedMedia = (parsed.data?.attachments?.media_keys || [])
      .map((key) => mediaByKey.get(key))
      .filter((item): item is NonNullable<ReturnType<typeof mediaByKey.get>> => Boolean(item));
    const attachedVideo = attachedMedia.find((item) => item.type === "video" || item.type === "animated_gif");
    const videoUrl = isXVideoUrl(url)
      ? url
      : attachedVideo
        ? url.replace(/[?#].*$/, "").replace(/\/video\/\d+$/i, "") + "/video/1"
        : undefined;
    const text = [
      fullText,
      user?.name || user?.username ? `Author: ${user.name || user.username}` : "",
      parsed.data?.created_at ? `Published: ${parsed.data.created_at}` : "",
      links ? `Links:\n${links}` : "",
    ].filter(Boolean).join("\n\n");
    return {
      text,
      partialThread,
      videoUrl,
      thumbnail: attachedVideo?.preview_image_url,
      videoDurationSeconds: typeof attachedVideo?.duration_ms === "number" ? Math.round(attachedVideo.duration_ms / 1000) : undefined,
    };
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
  return runSummarize(args, { timeout: durationToMs(timeoutValue, 210000) + 5000, maxBuffer: 1024 * 1024 * 4 });
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
    return await runSummarize(args, { timeout: durationToMs(timeoutValue, 210000) + 5000, maxBuffer: 1024 * 1024 * 4 });
  } catch {
    return null;
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Download a PDF URL and extract its text with pdftotext. The `summarize` CLI can't reliably read
 *  binary PDFs, so any bookmarked `.pdf` (from any source) goes through this instead. */
async function fetchPdfUrlText(url: string, maxCharacters: number): Promise<string | null> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return null;
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!looksLikePdf(res.headers.get("content-type"), buffer)) return null;
    return await extractPdfText(buffer, maxCharacters);
  } catch {
    return null;
  }
}

async function extractSourceContent(raw: RawArtifact, source: LibrarySourceConfig): Promise<ProcessedArtifact["source_cache"] | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1" || process.env.LIBRARY_FULL_CONTENT_DISABLED === "1") return null;
  if (!/^https?:\/\//.test(raw.url)) return null;

  const maxCharacters = process.env.LIBRARY_MAX_EXTRACT_CHARACTERS || "200000";
  // Direct PDF URLs (any source): extract text from the file rather than scraping a viewer page.
  if (isPdfUrl(raw.url)) {
    const pdfText = await fetchPdfUrlText(raw.url, Number(maxCharacters) || 200000);
    if (pdfText) {
      return { kind: "document", extractor: "pdftotext", captured_at: isoNow(), content: pdfText, chars: pdfText.length };
    }
    // fall through to summarize if the PDF couldn't be fetched/extracted
  }
  const timeoutValue = process.env.LIBRARY_EXTRACT_TIMEOUT || process.env.LIBRARY_SUMMARIZE_TIMEOUT || "3m";
  // NB: summarize >=0.9 dropped --max-extract-characters / --timestamps / --slides (they now error as
  // "unknown option", which silently nulled the whole extract). Pass only flags the current CLI knows
  // and apply the character cap in code below.
  const args = [
    raw.url,
    "--extract",
    "--format",
    "md",
    "--plain",
    "--no-color",
    "--timeout",
    timeoutValue,
  ];

  if (source.channel === "youtube" || isYouTubeUrl(raw.url) || raw.metadata.format === "video") {
    args.push("--youtube", process.env.LIBRARY_YOUTUBE_TRANSCRIPT_SOURCE || "auto");
    args.push("--video-mode", "transcript");
  }

  const raw_content = await runSummarize(args, { timeout: durationToMs(timeoutValue, 240000) + 5000, maxBuffer: 1024 * 1024 * 12 });
  if (!raw_content || raw_content.length < 40) return null;
  const content = raw_content.slice(0, Number(maxCharacters) || 200000);
  return {
    kind: source.channel === "youtube" || isYouTubeUrl(raw.url) ? "transcript" : source.channel === "raindrop" || source.channel === "rss" ? "article" : "source",
    extractor: "summarize-cli",
    captured_at: isoNow(),
    content,
    chars: content.length,
  };
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
    const maxCharacters = numericEnv(process.env.LIBRARY_RAINDROP_CACHE_MAX_CHARS, 200000);
    // Read BYTES, not text: a PDF (or any binary) read as text is unreadable AND UTF-8-corrupted. When
    // Raindrop's permanent copy is the uploaded file itself (PDFs), extract real prose with pdftotext.
    const buffer = Buffer.from(await response.arrayBuffer());
    if (looksLikePdf(contentType, buffer)) {
      const pdfText = await extractPdfText(buffer, maxCharacters);
      if (!pdfText) return null;
      return { kind: "document", extractor: "raindrop-pdf", captured_at: isoNow(), content: pdfText, chars: pdfText.length };
    }
    const text = buffer.toString("utf-8");
    const content = contentType.includes("html")
      ? readableHtmlText(text, maxCharacters)
      : text.trim().slice(0, maxCharacters);
    // Backstop: never let undecodable binary (image/font/unknown) land as a "cache".
    if (content.length < 80 || looksLikeBinaryGarbage(content)) return null;
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
  // An X Article share is a long-form article, not a tweet — classify it before the channel default.
  if (typeof raw.metadata.x_article_url === "string") return "x-article";
  if (source.channel === "youtube") return "video";
  if (source.channel === "twitter") return "tweet";
  if (source.channel === "email") return "newsletter";
  // Content-aware before the channel default (icon-system rule 3): a YouTube link or a repo saved
  // through Raindrop/manual is a video/code item, not a generic bookmark.
  if (VIDEO_URL_RE.test(raw.url)) return "video";
  if (CODE_URL_RE.test(raw.url)) return "code";
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

/**
 * Map a reweave connection target to a project slug when the note lives under projects/. The
 * reweave returns full vault-relative paths (e.g. "projects/foo/index" or "projects/foo"), so we
 * extract the leading segment after "projects/" and keep it only if it is an active project slug.
 */
function projectSlugFromTarget(target: string | null, projectSlugs: Set<string>): string | null {
  if (!target) return null;
  const normalized = target.replace(/^\/+/, "");
  const match = normalized.match(/^projects\/([^/]+)/);
  const slug = match ? match[1] : normalized;
  return projectSlugs.has(slug) ? slug : null;
}

export interface DigestArtifactOptions {
  useSummarize?: boolean;
  vaultPath?: string;
  preferCachedSource?: boolean;
  reweaveTimeoutMs?: number;
  onProgress?: (event: DigestionProgressEvent) => void | Promise<void>;
}

async function reportProgress(
  options: DigestArtifactOptions,
  stage: LibraryProcessingStage,
  status: DigestionProgressEvent["status"],
  raw: RawArtifact,
  details: Omit<DigestionProgressEvent, "stage" | "status" | "raw"> = {},
): Promise<void> {
  await options.onProgress?.({ stage, status, raw, ...details });
}

export async function digestArtifact(
  raw: RawArtifact,
  source: LibrarySourceConfig,
  options: DigestArtifactOptions = {},
): Promise<ProcessedArtifact> {
  await reportProgress(options, "metadata", "started", raw);
  const extractionNotes: string[] = [];
  const mediaEnrichment = await enrichRawArtifactMedia(raw, {
    disabled: source.channel === "raindrop" && Boolean(raw.metadata.raindrop_id),
  });
  raw = mediaEnrichment.raw;
  extractionNotes.push(...mediaEnrichment.notes);
  await reportProgress(options, "metadata", "completed", raw);

  const requestedSummarize = options.useSummarize ?? true;
  const captureStage: LibraryProcessingStage = source.channel === "youtube" || isYouTubeUrl(raw.url) ? "transcribe" : "capture";
  await reportProgress(options, captureStage, "started", raw);
  const xSource = source.channel === "twitter" || isXUrl(raw.url);
  const linkedUrl = xSource ? await resolveLinkedUrl(raw) : null;
  const directX = xSource ? await fetchXPostText(raw.url, source) : null;
  const linkedX = linkedUrl && isXUrl(linkedUrl) ? await fetchXPostText(linkedUrl, source) : null;
  const directXContent = directX?.text ?? null;
  const linkedXContent = linkedX?.text ?? null;
  const summarizeTarget = linkedUrl && /^https?:\/\//.test(linkedUrl) && !isXUrl(linkedUrl)
    ? linkedUrl
    : raw.url;
  if (linkedUrl && linkedUrl !== raw.url) {
    extractionNotes.push(`Resolved linked URL from source metadata: ${linkedUrl}`);
  }
  // An X Article share — the bookmarked tweet wraps a login-walled x.com/i/article link. Stamp the
  // article URL so the format classifier marks it x-article and browser recovery has a clean target.
  const xArticleUrl = xSource && isXArticleUrl(linkedUrl) ? linkedUrl : null;
  if (xArticleUrl) {
    raw = { ...raw, metadata: { ...raw.metadata, x_article_url: xArticleUrl } };
  }
  if (directXContent) {
    const fetchedLength = cleanSourceForDigest(directXContent).length;
    const originalLength = cleanSourceForDigest(raw.content || "").length;
    const directIsRicher = fetchedLength > originalLength + 80 || originalLength < 400;
    extractionNotes.push(directIsRicher
      ? fetchedLength > originalLength + 80
        ? "Fetched full X post text for digest context."
        : "Verified X post text for digest context."
      : "Kept richer cached X source text; direct post text was only wrapper metadata.");
    if (directX?.partialThread) {
      extractionNotes.push("X post is the root of a multi-tweet thread; only the opening post was captured (current X API plan has no thread/search access).");
    }
    if (directIsRicher) {
      raw = {
        ...raw,
        content: directXContent,
        metadata: {
          ...raw.metadata,
          ...(directX?.partialThread ? { partial_thread: true } : {}),
        },
      };
    }
  }
  if (linkedXContent) {
    extractionNotes.push("Fetched linked X post text for digest context.");
    if (linkedX?.partialThread) {
      extractionNotes.push("Linked X post is the root of a multi-tweet thread; only the opening post was captured (current X API plan has no thread/search access).");
    }
  } else if (xArticleUrl) {
    extractionNotes.push("X Article share — full text is login-walled and the API can't read it; run browser recovery (npm run library:x:recover) to fetch the article body.");
  } else if (xSource && linkedUrl && isXUrl(linkedUrl) && !xStatusId(linkedUrl)) {
    extractionNotes.push("Linked X URL is not a standard post URL; source text remains metadata-limited.");
  }
  if (xSource && raw.metadata.partial_thread && !directX?.partialThread && !linkedX?.partialThread) {
    extractionNotes.push("X bookmark is the root of a multi-tweet thread; only the opening post was captured (current X API plan has no thread/search access).");
  }
  if (xSource) {
    const normalizedTitle = normalizeXTitle(raw, linkedXContent || directXContent);
    if (normalizedTitle.title !== raw.title) {
      raw = normalizedTitle;
      extractionNotes.push("Normalized X/Twitter title by removing duplicate URL text.");
    }
  }
  const xVideoUrl = xSource
    ? [
      metadataString(raw.metadata.video_url),
      linkedUrl && isXVideoUrl(linkedUrl) ? linkedUrl : null,
      linkedX?.videoUrl || null,
      directX?.videoUrl || null,
      isXVideoUrl(raw.url) ? raw.url : null,
    ].find((item): item is string => Boolean(item && isXVideoUrl(item))) || null
    : null;
  if (xSource && xVideoUrl) {
    const existingMedia = Array.isArray(raw.metadata.media) ? raw.metadata.media : [];
    const hasLinkedVideo = existingMedia.some((item) => {
      if (!item || typeof item !== "object") return false;
      const record = item as Record<string, unknown>;
      return record.link === xVideoUrl || record.embed_url === xVideoUrl;
    });
    raw = {
      ...raw,
      thumbnail: raw.thumbnail || linkedX?.thumbnail || directX?.thumbnail,
      metadata: {
        ...raw.metadata,
        expanded_url: typeof raw.metadata.expanded_url === "string" ? raw.metadata.expanded_url : xVideoUrl,
        video_url: xVideoUrl,
        video_duration_seconds: metadataNumber(raw.metadata.video_duration_seconds)
          ?? linkedX?.videoDurationSeconds
          ?? directX?.videoDurationSeconds
          ?? undefined,
        media: hasLinkedVideo ? existingMedia : [
          { link: xVideoUrl, type: "video", source: linkedUrl === xVideoUrl ? "x_linked_post" : "x_post_media" },
          ...existingMedia,
        ],
      },
    };
    extractionNotes.push(linkedUrl === xVideoUrl ? "Added linked X video embed metadata." : "Added X video embed metadata.");
  }
  const xVideoTranscript = xVideoUrl ? await extractXVideoTranscript(xVideoUrl) : null;
  if (xVideoTranscript?.cache) {
    const tweetContext = [linkedXContent, directXContent, raw.content || ""]
      .filter((part): part is string => Boolean(part && cleanSourceForDigest(part).length))
      .join("\n\n");
    raw = {
      ...raw,
      content: [
        `X video transcript:\n${xVideoTranscript.cache.content}`,
        tweetContext ? `X post context:\n${tweetContext}` : "",
      ].filter(Boolean).join("\n\n"),
      metadata: {
        ...raw.metadata,
        video_url: xVideoUrl,
        source_recovered_from: xVideoUrl,
        x_video_transcript_status: xVideoTranscript.status,
        x_video_transcript_method: xVideoTranscript.method,
      },
    };
    extractionNotes.push(...xVideoTranscript.notes);
  } else if (xVideoTranscript && xVideoUrl) {
    raw = {
      ...raw,
      metadata: {
        ...raw.metadata,
        video_url: xVideoUrl,
        x_video_transcript_status: xVideoTranscript.status,
      },
    };
    extractionNotes.push(...xVideoTranscript.notes);
  } else if (xVideoUrl) {
    raw = {
      ...raw,
      metadata: {
        ...raw.metadata,
        x_video_transcript_status: "failed",
      },
    };
    extractionNotes.push("X video transcript was unavailable; capture remains video-metadata-limited.");
  }
  const shouldSummarizeUrl = requestedSummarize && (!xSource || (linkedUrl ? !isXUrl(linkedUrl) : false));
  const contentParts = xVideoTranscript
    ? [raw.content || ""]
    : xSource && linkedXContent
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
  // Acquire the full source content FIRST (live extract → Raindrop permanent copy → source-metadata),
  // so the text-summarize fallback below runs on the REAL article, not the short Raindrop excerpt.
  // (Previously the cache was fetched AFTER the summarize attempts, so a login-walled live fetch left
  // the item un-summarized — a "wall of text" — even when Raindrop held the full article underneath.)
  let sourceCache = xVideoTranscript?.cache || (shouldSummarizeUrl && !preferCachedSource ? await extractSourceContent({ ...raw, url: summarizeTarget }, source) : null);
  // A live extract that returned only login-wall chrome is not usable content — drop it so the Raindrop
  // cache (a logged-in full-DOM snapshot that usually carries the real article) takes over below.
  if (sourceCache && sourceCache.extractor !== "source-metadata") {
    const liveVerdict = loginWallVerdict(sourceCache.content);
    if (liveVerdict.isWall && !liveVerdict.hasRealContent) sourceCache = null;
  }
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
  // Text-summarize fallback when the live URL summarize produced nothing: run it on the FULL acquired
  // source (the cache content), not the short excerpt — unless that content is login-wall-only chrome.
  // On a cache-preferring redigest, `cleanedRawContent` is already the full reconstructed body, so keep
  // using it (no fresh Raindrop fetch needed for the summarize input).
  if (!summarized && requestedSummarize) {
    const summarizeInput = (!preferCachedSource && sourceCache && sourceCache.extractor !== "source-metadata")
      ? sourceCache.content
      : cleanedRawContent;
    const inputVerdict = loginWallVerdict(summarizeInput);
    if (summarizeInput.length >= 400 && !(inputVerdict.isWall && !inputVerdict.hasRealContent)) {
      summarized = await summarizeText(raw.title, summarizeInput);
      if (summarized) {
        extractionNotes.push(preferCachedSource
          ? "Preferred cached source text; summarized it with summarize CLI (no network re-extraction)."
          : "Summarized acquired source content with summarize CLI.");
      }
    }
  }
  if (shouldSummarizeUrl && !summarized && /^https?:\/\//.test(summarizeTarget)) {
    extractionNotes.push("summarize CLI was unavailable or failed; used source metadata/content fallback.");
  }
  if (shouldSummarizeUrl && !sourceCache && /^https?:\/\//.test(summarizeTarget)) {
    extractionNotes.push("Full source extraction was unavailable; Raw Content uses source-provided metadata/content fallback.");
  }
  await reportProgress(options, captureStage, "completed", raw, { source_cache: sourceCache || undefined });
  await reportProgress(options, "digest", "started", raw, { source_cache: sourceCache || undefined });

  const format = inferFormat(raw, source);
  // GUARD: the summarize CLI sometimes returns a raw transcript/source dump instead of a real digest
  // (notably YouTube --video-mode transcript). Treat that as a FAILED L1 digest so it never becomes the
  // body: drop it here so summary/key-points fall back to the structural source text, and (below) flag
  // the item for reweave to write a proper digest. Without this, the verbatim transcript lands as the
  // body — bloating the file, poisoning the description, and starving the reweave that would fix it.
  const summarizedWasRawDump = looksLikeRawTranscriptDump(summarized);
  if (summarizedWasRawDump) {
    summarized = null;
    extractionNotes.push("L1 digest looked like a raw transcript dump, not a summary; dropped it and flagged for reweave.");
  }
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
  // Login-wall verdict on the FINAL digest source: chrome-only means the capture is just a sign-in gate
  // with no real article under it — it must never grade "hot," and routes to authenticated recovery
  // (needs_auth_recovery). A capture that leads with chrome but carries the real article (the common
  // Raindrop case) is NOT chrome-only and proceeds normally.
  const sourceWallVerdict = loginWallVerdict(sourceText);
  const chromeOnly = sourceWallVerdict.isWall && !sourceWallVerdict.hasRealContent;
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
  const sourceCacheComplete = Boolean(sourceCache && sourceText.length >= 1000 && summary.length >= 160 && sourceSentences.length >= 3 && !chromeOnly);
  const xLooksPartial = Boolean(
    xSource &&
    ((raw.metadata.partial_thread || linkedX?.partialThread) ||
      (!directXContent && !linkedXContent && looksLikeThreadRoot(sourceText))),
  );
  const xSourceComplete = Boolean(
    xSource &&
    (!xVideoUrl || Boolean(xVideoTranscript?.cache) || xVideoTranscript?.status === "unavailable_no_audio" || xVideoTranscript?.status === "unavailable_source") &&
    sourceText.length >= 80 &&
    !isUrlOnlyText(sourceText) &&
    !xLooksPartial &&
    (directXContent || linkedXContent || sourceText.length >= 400 || !looksLikeThreadRoot(sourceText)),
  );
  if (sourceLimitedComplete) {
    extractionNotes.push("Source content is short; digest marked complete as source-limited.");
  }
  const hotDigestion = Boolean(
    (summarized && !chromeOnly && ((summary.length >= 160 && keyPoints.length >= 3) || substantialSummary || sourceLimitedComplete)) ||
    sourceCacheComplete ||
    xSourceComplete
  );
  const score = scoreArtifact(raw, source, summary);
  const saveRecommendation = recommendation(score, source);
  const taxonomy = artifactTaxonomy(raw, source);
  const series = seriesFromRaw(raw, source);
  const tags = taxonomy.semantic_tags;
  const proposedDestination = typeof raw.metadata.proposed_destination === "string"
    ? raw.metadata.proposed_destination
    : source.channel === "youtube" || source.channel === "twitter"
      ? "references/process"
      : "references";
  // ONE processing path, gated only by INTENT (study vs keep) — never by candidate-vs-saved or a
  // flag. STUDY items (candidate OR saved) get the full reweave: free-form digest + woven
  // connections. KEEP items (products/shopping/bookmarks) get the clean L1 digest only — no deep
  // analysis. The only quality divergence beyond study/keep is a TECHNICAL failure, handled by the
  // graceful degradation below (reweave_pending → re-upgraded on a later pass).
  const shouldWeaveConnections = taxonomy.library_mode === "study";
  let connectionSuggestions: ProcessedArtifact["connection_suggestions"] = [];
  let attentionJudgment: ProcessedArtifact["attention_judgment"];
  let connectedProjects: string[] = [];
  let connectionReasoning = "";
  let reconnectedAt: string | undefined;
  let reweaveCandidates: ProcessedArtifact["reweave_candidates"] = [];
  // L1 default body for EVERYONE: the free-form CAPTURE_VOICE digest from `summarize --prompt
  // DIGEST_PROMPT`. A study reweave overrides it below; a keep item keeps it; a study item whose
  // reweave can't run degrades to it and is flagged `reweave_pending` for re-upgrade on a later pass.
  let digestMarkdown: string | undefined = summarized?.trim() || undefined;
  let description: string | undefined = digestMarkdown ? deriveDescription(digestMarkdown) : undefined;
  let reweavePending = false;
  await reportProgress(options, "digest", "completed", raw, {
    summary,
    description,
    source_cache: sourceCache || undefined,
  });
  const vaultPath = options.vaultPath || process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER;
  if (shouldWeaveConnections && process.env.LIBRARY_CONNECTIONS_DISABLED !== "1" && vaultPath) {
    await reportProgress(options, "reweave", "started", raw, { summary, description, source_cache: sourceCache || undefined });
    const projectSlugs = projectSlugSet(vaultPath);
    const kbIndex = buildKbIndex(vaultPath);
    // Durable saves get the single-pass reweave: a free-form digest plus disciplined first-party
    // and library connections, replacing the old buildKbIndex+judgeConnections split.
    const sourceContent = sourceCache?.content || cleanedRawContent || raw.content || summary;
    // Intent signal: WHY he saved it (product vs idea vs aesthetic) so the reweave picks the mode.
    const intentTags = taxonomy.source_tags.length ? taxonomy.source_tags.join(", ") : "";
    const intent = [
      `format: ${format}`,
      `saved via: ${source.channel}`,
      raw.url ? `url: ${raw.url}` : "",
      intentTags ? `tags: ${intentTags}` : "",
      taxonomy.source_collection ? `collection: ${taxonomy.source_collection}` : "",
      taxonomy.source_folder ? `folder: ${taxonomy.source_folder}` : "",
      taxonomy.library_mode === "keep" ? "mode: keep / quiet durable memory" : "mode: study / weave into knowledge work",
    ].filter(Boolean).join("; ");
    const reweave = await reweaveArtifact(kbIndex, { title: raw.title, sourceContent, intent }, {
      vaultPath,
      timeoutMs: options.reweaveTimeoutMs,
    });
    if (reweave && reweave.digest_markdown.trim()) {
      digestMarkdown = reweave.digest_markdown || digestMarkdown;
      description = reweave.description || description;
      // Keep first-party ties ahead of library cross-references so rendering reflects priority.
      const orderedConnections = [...reweave.connections_first_party, ...reweave.connections_library];
      connectionSuggestions = orderedConnections.map((connection) => ({
        target: connection.target,
        label: connection.title,
        relationship: connection.relationship,
      }));
      connectionReasoning = connectionSuggestions.length
        ? `Woven into ${connectionSuggestions.length} note${connectionSuggestions.length === 1 ? "" : "s"} across Justin's work.`
        : "Connection pass completed; no durable first-party or library connections passed the gate.";
      reconnectedAt = isoNow();
      reweaveCandidates = reweave.reweave_candidates || [];
      attentionJudgment = reweave.attention_judgment;
      // connected_projects are the first-party targets whose path lives under projects/<slug>/.
      connectedProjects = Array.from(new Set(
        reweave.connections_first_party
          .map((connection) => projectSlugFromTarget(connection.target, projectSlugs))
          .filter((slug): slug is string => Boolean(slug)),
      ));
      // We never auto-rename files; raw.title is kept as the H1 and filename basis. The reweave's
      // proposed_title is a suggestion only and is not persisted from this path.
      await reportProgress(options, "reweave", "completed", raw, { summary, description, source_cache: sourceCache || undefined });
    } else {
      // Reweave couldn't run (rate-limited / parse failure). The L1 free-form digest stands as the
      // body; flag for re-upgrade so a later pass adds connections — never stamp a study item "done"
      // without them. The backfill orchestrator re-includes reweave_pending items regardless of stamp.
      reweavePending = true;
    }
  } else if (shouldWeaveConnections) {
    // Study item, but connections are disabled or there's no vault path — same technical degradation.
    reweavePending = true;
  }
  // A raw-transcript dump that produced no real digest (a keep item with no reweave, or a reweave that
  // couldn't run) must still be queued so a later pass writes a proper digest — otherwise it lingers as
  // a thin structural stub with the transcript discarded.
  if (summarizedWasRawDump && !digestMarkdown) reweavePending = true;
  const connectionWhy = connectionReasoning ? ` ${connectionReasoning}` : "";

  // For video sources, capture total duration (via yt-dlp) so the feed/list can badge it.
  let videoDurationSeconds: number | undefined;
  const durationProbeUrl = metadataString(raw.metadata.video_url) || raw.url;
  if (format === "video" || isLikelyVideoUrl(durationProbeUrl) || isXVideoUrl(durationProbeUrl)) {
    videoDurationSeconds = metadataNumber(raw.metadata.video_duration_seconds)
      ?? metadataNumber(raw.metadata.youtube_duration_seconds)
      ?? (await getVideoDurationSeconds(durationProbeUrl))
      ?? undefined;
  }
  const preflightClip = raw.metadata.youtube_clip && typeof raw.metadata.youtube_clip === "object"
    ? raw.metadata.youtube_clip as ProcessedArtifact["youtube_clip"]
    : undefined;
  const youtubeClip = source.channel === "youtube"
    ? preflightClip || detectYouTubeContentForm({
      title: raw.title,
      description: metadataString(raw.metadata.youtube_description_preview) || raw.content || "",
      channelTitle: metadataString(raw.metadata.youtube_channel_title) || raw.author,
      sourceId: source.id,
      sourceName: source.name,
      sourceIntent: source.intent,
      sourceSignal: source.signal || metadataString(raw.metadata.signal),
      tags: Array.isArray(raw.metadata.youtube_tags) ? raw.metadata.youtube_tags.map(String) : tags,
      durationSeconds: videoDurationSeconds ?? null,
    })
    : undefined;

  return {
    raw,
    source,
    format,
    summary,
    video_duration_seconds: videoDurationSeconds,
    youtube_clip: youtubeClip,
    series,
    key_points: keyPoints.length ? keyPoints : [raw.title],
    digest_markdown: digestMarkdown,
    description,
    reweave_pending: reweavePending || undefined,
    needs_auth_recovery: chromeOnly || undefined,
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
    source_tags: taxonomy.source_tags,
    source_collection: taxonomy.source_collection,
    source_collection_id: taxonomy.source_collection_id,
    source_folder: taxonomy.source_folder,
    source_folder_id: taxonomy.source_folder_id,
    library_mode: taxonomy.library_mode,
    proposed_destination: proposedDestination,
    connected_projects: connectedProjects,
    connection_suggestions: connectionSuggestions,
    connection_reasoning: connectionReasoning || undefined,
    reconnected_at: reconnectedAt,
    reweave_candidates: reweaveCandidates && reweaveCandidates.length ? reweaveCandidates : undefined,
    attention_judgment: attentionJudgment,
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
