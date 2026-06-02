import fs from "fs";
import path from "path";
import { loadEnvConfig } from "@next/env";
import { CANDIDATE_CACHE_DIR } from "../src/lib/library/candidate-cache";
import { extractBullets, extractConnections, extractHeading, extractSection, parseMarkdownFile, relativeVaultPath } from "../src/lib/library/markdown";
import { walkMarkdown } from "../src/lib/library/utils";

loadEnvConfig(process.cwd());

const vaultPath = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || process.cwd();
const args = process.argv.slice(2);

const durableSourceIds = new Set(["raindrop-bookmarks", "twitter-bookmarks", "youtube-bookmarks", "book-capture"]);
const candidateSourceIds = new Set(["youtube-liked-videos", "superhuman-news"]);

function argValue(name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
}

function argValues(name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === name && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

function stripDetails(text: string): string {
  return text
    .replace(/<\/?details>/g, "")
    .replace(/<summary>[\s\S]*?<\/summary>/g, "")
    .trim();
}

function qualityFor(item: AuditItem): "hot" | "warm" | "cold" {
  if (item.source_limited) return "hot";
  if (!item.needs_redigestion && item.digestion_status === "hot") return "hot";
  if (item.summary_chars >= 100 && item.key_point_count >= 2) return "warm";
  return "cold";
}

interface AuditItem {
  path: string;
  type: "reference" | "reference-candidate";
  lifecycle_status: string;
  source_id: string;
  source_name: string;
  url: string;
  title: string;
  published: string | null;
  captured_or_digested: string | null;
  digestion_status: string | null;
  digested_with: string | null;
  summary_chars: number;
  key_point_count: number;
  raw_content_chars: number;
  extracted_chars: number;
  cached_source_chars: number;
  has_media: boolean;
  has_thumbnail: boolean;
  is_video: boolean;
  source_limited: boolean;
  fallback_note: boolean;
  url_summarizable: boolean;
  expected_storage: "durable" | "candidate" | "unknown";
  needs_redigestion: boolean;
  reasons: string[];
  quality: "hot" | "warm" | "cold";
}

function expectedStorage(sourceId: string): AuditItem["expected_storage"] {
  if (durableSourceIds.has(sourceId)) return "durable";
  if (candidateSourceIds.has(sourceId) || (sourceId.startsWith("youtube-") && !durableSourceIds.has(sourceId))) return "candidate";
  return "unknown";
}

function auditFile(filePath: string): AuditItem | null {
  const { data, body } = parseMarkdownFile(filePath);
  if (data.type !== "reference" && data.type !== "reference-candidate") return null;

  const sourceId = typeof data.source_id === "string" ? data.source_id : "";
  const sourceName = typeof data.source_name === "string" ? data.source_name : "";
  const url = typeof data.url === "string" ? data.url : "";
  const title = String(data.title || extractHeading(body, path.basename(filePath, ".md")));
  const summary = String(extractSection(body, "Summary") || data.description || "").trim();
  const keyPoints = extractBullets(extractSection(body, "Key Points"));
  const connections = extractConnections(body);
  const rawContent = stripDetails(extractSection(body, "Raw Content"));
  const mediaSection = extractSection(body, "Media");
  const digestionStatus = typeof data.digestion_status === "string" ? data.digestion_status : null;
  const digestedWith = typeof data.digested_with === "string" ? data.digested_with : null;
  const extractedChars = Number(data.extracted_chars || 0);
  const cachedSourceChars = Number(data.cached_source_chars || 0);
  const hasThumbnail = typeof data.thumbnail === "string" && data.thumbnail.length > 0;
  const isVideo = /youtube\.com\/watch|youtu\.be\//.test(url) || data.format === "video";
  const hasMedia = Boolean(mediaSection.trim() || body.includes("youtube.com/embed/") || body.includes("<iframe"));
  const fallbackNote = body.includes("summarize CLI was unavailable or failed");
  const extractionBlocked = data.source_extraction_status === "blocked" || digestionStatus === "blocked";
  const urlSummarizable = /^https?:\/\//.test(url);
  const sourceContentChars = Math.max(rawContent.length, extractedChars, cachedSourceChars);
  const nonTextAsset = /\.(png|jpe?g|gif|webp)(?:[?#].*)?$/i.test(url) || /api\.raindrop\.io\/v2\/raindrop\/\d+\/file/i.test(url);
  const shortCompleteTextSource = Boolean(
    !isVideo &&
    digestionStatus === "hot" &&
    sourceContentChars > 0 &&
    sourceContentChars < 1200 &&
    (summary.length < 160 || keyPoints.length < 3 || rawContent.length < 200)
  );
  const shortCompleteVideoSource = Boolean(
    isVideo &&
    digestionStatus === "hot" &&
    hasMedia &&
    sourceContentChars > 0 &&
    sourceContentChars < 500
  );
  const reviewCandidateComplete = Boolean(
    sourceId === "youtube-liked-videos" &&
    isVideo &&
    hasMedia &&
    summary.length >= 160 &&
    keyPoints.length >= 3 &&
    rawContent.length >= 100
  );
  const richLegacyManual = Boolean(
    sourceId === "manual" &&
    hasMedia &&
    summary.length >= 500 &&
    keyPoints.length >= 3
  );
  const substantialSummary = Boolean(summary.length >= 500 && sourceContentChars >= 1000);
  const sourceLimited = Boolean(
    extractionBlocked ||
    reviewCandidateComplete ||
    richLegacyManual ||
    (
      urlSummarizable &&
      !fallbackNote &&
      (nonTextAsset || shortCompleteTextSource || shortCompleteVideoSource || substantialSummary)
    )
  );
  const storage = expectedStorage(sourceId);
  const lifecycle = data.type === "reference"
    ? "saved"
    : typeof data.status === "string" ? data.status : "candidate";
  const reasons: string[] = [];

  if (sourceLimited) {
    reasons.push(
      extractionBlocked ? "source_extraction_blocked"
        : reviewCandidateComplete ? "source_limited_candidate_review"
        : richLegacyManual ? "source_limited_rich_legacy_manual"
          : substantialSummary ? "source_limited_substantial_summary"
            : nonTextAsset ? "source_limited_non_text_asset"
              : shortCompleteVideoSource ? "source_limited_short_video_transcript"
                : "source_limited_short_source"
    );
  }
  if (fallbackNote) reasons.push("summarize_fallback_note");
  if (digestionStatus !== "hot") reasons.push("not_marked_hot");
  if (summary.length < 160) reasons.push("short_summary");
  if (keyPoints.length < 3 && summary.length < 500) reasons.push("few_key_points");
  if (connections.length === 0) reasons.push("empty_connections");
  if (data.type === "reference" && urlSummarizable && digestionStatus !== "hot" && rawContent.length < 200) {
    reasons.push("short_or_empty_raw_content");
  }
  if (isVideo && !hasMedia) reasons.push("missing_media_embed");
  if (isVideo && rawContent.length < 500) reasons.push("short_or_empty_video_transcript");
  if ((isVideo || data.type === "reference-candidate") && !hasThumbnail) reasons.push("missing_thumbnail");
  if (storage === "candidate" && data.type === "reference") reasons.push("candidate_source_saved_durable");
  if (storage === "durable" && data.type === "reference-candidate") reasons.push("durable_source_still_candidate");

  const sourceLimitedOkReasons = new Set(["summarize_fallback_note", "short_summary", "few_key_points", "short_or_empty_raw_content", "short_or_empty_video_transcript", "not_marked_hot", "empty_connections"]);
  const actionableRedigestionReasons = reasons.filter((reason) => [
    "summarize_fallback_note",
    "not_marked_hot",
    "short_summary",
    "few_key_points",
    "short_or_empty_raw_content",
    "missing_media_embed",
    "short_or_empty_video_transcript",
    "missing_thumbnail",
    "empty_connections",
  ].includes(reason) && !(sourceLimited && sourceLimitedOkReasons.has(reason)));

  const needsRedigestion = Boolean(
    sourceId &&
    ((urlSummarizable && actionableRedigestionReasons.length > 0) || reasons.includes("candidate_source_saved_durable"))
  );

  const item: AuditItem = {
    path: relativeVaultPath(vaultPath, filePath),
    type: data.type as AuditItem["type"],
    lifecycle_status: lifecycle,
    source_id: sourceId,
    source_name: sourceName,
    url,
    title,
    published: typeof data.published === "string" ? data.published : null,
    captured_or_digested: typeof data.captured === "string" ? data.captured : typeof data.digested === "string" ? data.digested : null,
    digestion_status: digestionStatus,
    digested_with: digestedWith,
    summary_chars: summary.length,
    key_point_count: keyPoints.length,
    raw_content_chars: rawContent.length,
    extracted_chars: extractedChars,
    cached_source_chars: cachedSourceChars,
    has_media: hasMedia,
    has_thumbnail: hasThumbnail,
    is_video: isVideo,
    source_limited: sourceLimited,
    fallback_note: fallbackNote,
    url_summarizable: urlSummarizable,
    expected_storage: storage,
    needs_redigestion: needsRedigestion,
    reasons,
    quality: "warm",
  };
  item.quality = qualityFor(item);
  return item;
}

function summarizeBySource(items: AuditItem[]) {
  const bySource = new Map<string, {
    total: number;
    hot: number;
    warm: number;
    cold: number;
    needs_redigestion: number;
    saved: number;
    candidates: number;
    fallback_notes: number;
    candidate_source_saved_durable: number;
  }>();
  for (const item of items) {
    const key = item.source_id || "(missing)";
    const current = bySource.get(key) || {
      total: 0,
      hot: 0,
      warm: 0,
      cold: 0,
      needs_redigestion: 0,
      saved: 0,
      candidates: 0,
      fallback_notes: 0,
      candidate_source_saved_durable: 0,
    };
    current.total += 1;
    current[item.quality] += 1;
    if (item.needs_redigestion) current.needs_redigestion += 1;
    if (item.type === "reference") current.saved += 1;
    if (item.type === "reference-candidate") current.candidates += 1;
    if (item.fallback_note) current.fallback_notes += 1;
    if (item.reasons.includes("candidate_source_saved_durable")) current.candidate_source_saved_durable += 1;
    bySource.set(key, current);
  }
  return Object.fromEntries([...bySource.entries()].sort(([a], [b]) => a.localeCompare(b)));
}

const sourceFilter = new Set(argValues("--source"));
const limit = Number(argValue("--limit") || 0);
const referencesRoot = path.join(vaultPath, "references");
const files = walkMarkdown(referencesRoot, { includeHidden: true })
  .filter((filePath) => filePath.includes(`${path.sep}${CANDIDATE_CACHE_DIR}${path.sep}`) || !filePath.includes(`${path.sep}.cache${path.sep}`));
let items = files
  .map(auditFile)
  .filter((item): item is AuditItem => Boolean(item))
  .filter((item) => !sourceFilter.size || sourceFilter.has(item.source_id));

items = items.sort((a, b) => Number(b.needs_redigestion) - Number(a.needs_redigestion) || a.source_id.localeCompare(b.source_id));
const queueItems = items.filter((item) => item.needs_redigestion);
const queueLimit = limit > 0 ? queueItems.slice(0, limit) : queueItems;
const report = {
  generated_at: new Date().toISOString(),
  vault_path: vaultPath,
  totals: {
    items: items.length,
    saved: items.filter((item) => item.type === "reference").length,
    candidates: items.filter((item) => item.type === "reference-candidate").length,
    hot: items.filter((item) => item.quality === "hot").length,
    warm: items.filter((item) => item.quality === "warm").length,
    cold: items.filter((item) => item.quality === "cold").length,
    needs_redigestion: queueItems.length,
  },
  by_source: summarizeBySource(items),
  queue: queueLimit,
};

const queuePath = argValue("--queue");
if (queuePath) {
  fs.mkdirSync(path.dirname(queuePath), { recursive: true });
  fs.writeFileSync(queuePath, JSON.stringify({ generated_at: report.generated_at, items: queueLimit }, null, 2), "utf-8");
}

console.log(JSON.stringify(report, null, 2));
