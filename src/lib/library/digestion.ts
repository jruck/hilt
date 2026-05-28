import { execFile } from "child_process";
import { promisify } from "util";
import type { LibrarySourceConfig, ProcessedArtifact, RawArtifact, SaveRecommendation } from "./types";
import { isoNow, scoreClamp } from "./utils";
import { isYouTubeUrl } from "./media";

const execFileAsync = promisify(execFile);

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 20);
}

function stripMarkdown(text: string): string {
  return text
    .replace(/^#+\s+/gm, "")
    .replace(/^[-*]\s+/gm, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function isXUrl(url: string): boolean {
  return /^https?:\/\/(www\.)?(x|twitter)\.com\//i.test(url);
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

export async function digestArtifact(
  raw: RawArtifact,
  source: LibrarySourceConfig,
  options: { useSummarize?: boolean } = {},
): Promise<ProcessedArtifact> {
  const extractionNotes: string[] = [];
  const requestedSummarize = options.useSummarize ?? true;
  const xSource = source.channel === "twitter" || isXUrl(raw.url);
  const shouldSummarize = requestedSummarize && !xSource;
  const summarized = shouldSummarize && /^https?:\/\//.test(raw.url)
    ? await summarizeUrl(raw.url)
    : null;
  let sourceCache = shouldSummarize ? await extractSourceContent(raw, source) : null;
  if (!sourceCache && source.channel === "raindrop" && !xSource) {
    sourceCache = await fetchRaindropCache(raw);
    if (sourceCache) {
      extractionNotes.push("Used Raindrop permanent copy as cached source fallback.");
    }
  }
  if (!sourceCache && xSource && raw.content?.trim()) {
    sourceCache = {
      kind: "source",
      extractor: "source-metadata",
      captured_at: isoNow(),
      content: raw.content.trim(),
      chars: raw.content.trim().length,
    };
    extractionNotes.push("Used X/Twitter source text as canonical source; skipped x.com webpage summarization.");
  }
  if (shouldSummarize && !summarized && /^https?:\/\//.test(raw.url)) {
    extractionNotes.push("summarize CLI was unavailable or failed; used source metadata/content fallback.");
  }
  if (shouldSummarize && !sourceCache && /^https?:\/\//.test(raw.url)) {
    extractionNotes.push("Full source extraction was unavailable; Raw Content uses source-provided metadata/content fallback.");
  }

  const format = inferFormat(raw, source);
  const metadataExcerpt = typeof raw.metadata.excerpt === "string" ? raw.metadata.excerpt : "";
  const sourceText = stripMarkdown(summarized || sourceCache?.content || raw.content || metadataExcerpt || raw.title);
  const sourceSentences = sentences(sourceText);
  const summary = sourceSentences.slice(0, 4).join(" ") || raw.title;
  const keyPoints = sourceSentences.slice(0, 5);
  const sourceLimitedComplete = Boolean(summarized && format !== "video" && sourceText.length > 0 && sourceText.length < 700);
  const substantialSummary = Boolean(summarized && summary.length >= 500 && sourceText.length >= 1000);
  const sourceCacheComplete = Boolean(sourceCache && sourceText.length >= 1000 && summary.length >= 160 && sourceSentences.length >= 3);
  const xSourceComplete = Boolean(xSource && sourceText.length > 0);
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

  return {
    raw,
    source,
    format,
    summary,
    key_points: keyPoints.length ? keyPoints : [raw.title],
    assessment: {
      save_recommendation: saveRecommendation,
      why: source.intent === "explicit_save"
        ? "The source action is configured as explicit save intent."
        : `Discovery score ${score.total.toFixed(2)} against source policy.`,
      what_changed: "",
      what_is_suspect: extractionNotes.length ? "Extraction fell back to available metadata." : "",
    },
    score,
    tags,
    proposed_destination: proposedDestination,
    connected_projects: [],
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
