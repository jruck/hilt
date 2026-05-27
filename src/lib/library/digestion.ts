import { execFile } from "child_process";
import { promisify } from "util";
import type { LibrarySourceConfig, ProcessedArtifact, RawArtifact, SaveRecommendation } from "./types";
import { scoreClamp } from "./utils";

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

async function summarizeUrl(url: string): Promise<string | null> {
  if (process.env.LIBRARY_SUMMARIZE_DISABLED === "1") return null;
  try {
    const { stdout } = await execFileAsync("summarize", [
      url,
      "--plain",
      "--no-color",
      "--model",
      "google/gemini-3-flash-preview",
      "--timeout",
      "2m",
    ], { timeout: 150000, maxBuffer: 1024 * 1024 * 4 });
    return stdout.trim() || null;
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
  const shouldSummarize = options.useSummarize ?? true;
  const summarized = shouldSummarize && /^https?:\/\//.test(raw.url)
    ? await summarizeUrl(raw.url)
    : null;
  if (shouldSummarize && !summarized && /^https?:\/\//.test(raw.url)) {
    extractionNotes.push("summarize CLI was unavailable or failed; used source metadata/content fallback.");
  }

  const metadataExcerpt = typeof raw.metadata.excerpt === "string" ? raw.metadata.excerpt : "";
  const sourceText = stripMarkdown(summarized || raw.content || metadataExcerpt || raw.title);
  const sourceSentences = sentences(sourceText);
  const summary = sourceSentences.slice(0, 4).join(" ") || raw.title;
  const keyPoints = sourceSentences.slice(0, 5);
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
    format: inferFormat(raw, source),
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
  };
}
