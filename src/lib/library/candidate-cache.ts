import fs from "fs";
import path from "path";
import type { CandidateStatus, ReferenceCandidate, ProcessedArtifact, PromotionReason } from "./types";
import { addDays, atomicWriteFile, canonicalUrl, dateOnly, ensureDir, hashId, isoNow, slugify, walkMarkdown } from "./utils";
import { extractBullets, extractSection, parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";
import { buildMediaMarkdown, cachedSourceContent, stripDetailsWrapper } from "./media";
import { readCitations } from "./citations";
import { PIPELINE_VERSION } from "./pipeline";
import { friendlyNewsletterSender, semanticTags, uniqueTags, validLibraryMode } from "./taxonomy";
import { youtubeFrontmatter } from "./youtube-frontmatter";

export const CANDIDATE_CACHE_DIR = path.join("references", ".cache", "library-candidates");
const NEWSLETTERS_SOURCE_ID = "superhuman-news";
const NEWSLETTERS_SOURCE_NAME = "Newsletters";
const BOOK_CAPTURE_SOURCE_ID = "book-capture";
const BOOK_CAPTURE_SOURCE_NAME = "Books";
const MANUAL_SOURCE_ID = "manual";
const MANUAL_SOURCE_NAME = "Manual";

export function candidateCacheDir(vaultPath: string): string {
  return path.join(vaultPath, CANDIDATE_CACHE_DIR);
}

// Per-file parsed-candidate cache — the candidate-lane twin of the reference detailCache in
// references.ts (same rationale, same mtimeMs+size invalidation, same read-only sharing contract).
const candidateCache = new Map<string, { mtimeMs: number; size: number; candidate: ReferenceCandidate }>();
const CANDIDATE_CACHE_MAX_ENTRIES = 8192;

export function parseCandidateFile(vaultPath: string, filePath: string): ReferenceCandidate | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const cached = candidateCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.candidate;
  }
  const { data, body } = parseMarkdownFile(filePath);
  if (data.type !== "reference-candidate") return null;
  const title = String(data.title || path.basename(filePath, ".md"));
  const score = typeof data.score === "object" && data.score !== null ? data.score as Record<string, unknown> : {};
  const promotion = typeof data.promotion === "object" && data.promotion !== null ? data.promotion as Record<string, unknown> : {};
  const keyPoints = extractBullets(extractSection(body, "Key Points"));
  const cachedSource = stripDetailsWrapper(extractSection(body, "Raw Content"));
  const sourceTags = uniqueTags(Array.isArray(data.source_tags) ? data.source_tags : []);
  const channel = String(data.channel || "manual") as ReferenceCandidate["channel"];
  const author = typeof data.author === "string" ? data.author : null;
  const rawSourceFolder = typeof data.source_folder === "string" && data.source_folder.trim()
    ? data.source_folder.trim()
    : channel === "email" && author
      ? author
      : null;
  const sourceFolder = channel === "email"
    ? friendlyNewsletterSender(rawSourceFolder) || rawSourceFolder
    : rawSourceFolder;
  const sourceFolderId = typeof data.source_folder_id === "string" || typeof data.source_folder_id === "number"
    ? String(data.source_folder_id)
    : channel === "email" && author
      ? author.toLowerCase()
      : null;
  const sourceId = String(data.source_id || "");
  const sourceName = sourceId === NEWSLETTERS_SOURCE_ID
    ? NEWSLETTERS_SOURCE_NAME
    : sourceId === BOOK_CAPTURE_SOURCE_ID
      ? BOOK_CAPTURE_SOURCE_NAME
      : sourceId === MANUAL_SOURCE_ID
        ? MANUAL_SOURCE_NAME
        : String(data.source_name || "");
  const candidate: ReferenceCandidate = {
    id: hashId(relativeVaultPath(vaultPath, filePath)),
    path: relativeVaultPath(vaultPath, filePath),
    title,
    url: String(data.url || ""),
    format: String(data.format || "article"),
    author,
    published: typeof data.published === "string" ? data.published : null,
    digested: String(data.digested || dateOnly()),
    channel,
    source_id: sourceId,
    source_name: sourceName,
    cited_from: readCitations(data),
    thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : null,
    intent: String(data.intent || "discovery") as ReferenceCandidate["intent"],
    status: String(data.status || "candidate") as CandidateStatus,
    expires: String(data.expires || addDays(new Date(), 30)),
    score: {
      relevance: Number(score.relevance || 0),
      novelty: Number(score.novelty || 0),
      confidence: Number(score.confidence || 0),
      total: Number(score.total || 0),
    },
    save_recommendation: String(data.save_recommendation || "review") as ReferenceCandidate["save_recommendation"],
    proposed_destination: typeof data.proposed_destination === "string" ? data.proposed_destination : null,
    connected_projects: Array.isArray(data.connected_projects) ? data.connected_projects.map(String) : [],
    tags: semanticTags(Array.isArray(data.tags) ? data.tags : []),
    source_tags: sourceTags,
    source_collection: typeof data.source_collection === "string" && data.source_collection.trim() ? data.source_collection.trim() : null,
    source_collection_id: typeof data.source_collection_id === "string" || typeof data.source_collection_id === "number" ? String(data.source_collection_id) : null,
    source_folder: sourceFolder,
    source_folder_id: sourceFolderId,
    library_mode: validLibraryMode(data.library_mode),
    promotion: {
      promoted_to: typeof promotion.promoted_to === "string" ? promotion.promoted_to : null,
      promoted_at: typeof promotion.promoted_at === "string" ? promotion.promoted_at : null,
      promoted_reason: typeof promotion.promoted_reason === "string" ? promotion.promoted_reason as PromotionReason : null,
    },
    summary: String(data.description || data.summary || extractSection(body, "Summary") || "").trim(),
    key_points: keyPoints,
    cached_source: cachedSource || null,
    content: body.trim(),
    raw_frontmatter: data,
  };
  if (candidateCache.size >= CANDIDATE_CACHE_MAX_ENTRIES) candidateCache.clear();
  candidateCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, candidate });
  return candidate;
}

export function listCandidates(vaultPath: string, status?: CandidateStatus): ReferenceCandidate[] {
  return walkMarkdown(candidateCacheDir(vaultPath), { includeHidden: true })
    .map((filePath) => parseCandidateFile(vaultPath, filePath))
    .filter((candidate): candidate is ReferenceCandidate => Boolean(candidate))
    .filter((candidate) => !status || candidate.status === status)
    .sort((a, b) => b.digested.localeCompare(a.digested));
}

export function findCandidateById(vaultPath: string, id: string): ReferenceCandidate | null {
  for (const filePath of walkMarkdown(candidateCacheDir(vaultPath), { includeHidden: true })) {
    const relPath = relativeVaultPath(vaultPath, filePath);
    if (hashId(relPath) !== id) continue;
    return parseCandidateFile(vaultPath, filePath);
  }
  return null;
}

export function findCandidateByUrl(vaultPath: string, url: string): ReferenceCandidate | null {
  const canonical = canonicalUrl(url);
  return listCandidates(vaultPath).find((candidate) => canonicalUrl(candidate.url) === canonical) || null;
}

function connectionLines(processed: ProcessedArtifact): string {
  if (processed.connection_suggestions?.length) {
    return processed.connection_suggestions.map((suggestion) => {
      // Mirror the durable reference rendering: human title as the wikilink alias.
      const link = suggestion.target ? `[[${suggestion.target}|${suggestion.label}]]` : suggestion.label;
      return `- ${link} - ${suggestion.relationship}`;
    }).join("\n");
  }
  if (processed.connected_projects.length) {
    return processed.connected_projects.map((item) => `- [[${item}]]`).join("\n");
  }
  // No connections: render an empty section body rather than a lone "- " bullet.
  // The connection_reasoning lives in frontmatter instead.
  return "";
}

function candidateFilePath(vaultPath: string, processed: ProcessedArtifact): string {
  const date = dateOnly(processed.raw.date || new Date());
  const id = hashId(`${processed.source.id}:${canonicalUrl(processed.raw.url)}`, 10);
  return path.join(candidateCacheDir(vaultPath), `${date}-${slugify(processed.raw.title)}-${id}.md`);
}

export function buildCandidateMarkdown(processed: ProcessedArtifact): string {
  const now = dateOnly();
  const frontmatter: Record<string, unknown> = {
    type: "reference-candidate",
    pipeline_version: PIPELINE_VERSION,
    // The feed-card description. Prefer the reweave's free-form description; persist it so a
    // free-form digest body (which no longer carries a ## Summary heading) still yields a summary
    // on round-trip via parseCandidateFile.
    description: processed.description || undefined,
    url: processed.raw.url,
    format: processed.format,
    title: processed.raw.title,
    author: processed.raw.author || undefined,
    published: processed.raw.date ? dateOnly(processed.raw.date) : undefined,
    digested: now,
    channel: processed.source.channel,
    source_id: processed.source.id,
    source_name: processed.source.name,
    cited_from: processed.cited_from?.length ? processed.cited_from : undefined,
    intent: processed.source.intent,
    digestion_status: processed.digestion?.status,
    digested_with: processed.digestion?.extractor,
    digested_at: processed.digestion?.digested_at,
    extracted_chars: processed.digestion?.extracted_chars,
    cached_source_chars: processed.digestion?.cached_source_chars,
    cached_source_extractor: processed.digestion?.cached_source_extractor,
    video_url: typeof processed.raw.metadata.video_url === "string" ? processed.raw.metadata.video_url : undefined,
    video_duration_seconds: processed.video_duration_seconds,
    x_video_transcript_status: typeof processed.raw.metadata.x_video_transcript_status === "string" ? processed.raw.metadata.x_video_transcript_status : undefined,
    x_video_transcript_method: typeof processed.raw.metadata.x_video_transcript_method === "string" ? processed.raw.metadata.x_video_transcript_method : undefined,
    thumbnail: processed.raw.thumbnail || undefined,
    source_recovered_from: typeof processed.raw.metadata.source_recovered_from === "string" ? processed.raw.metadata.source_recovered_from : undefined,
    tags: processed.tags.length ? semanticTags(processed.tags) : undefined,
    source_tags: processed.source_tags.length ? processed.source_tags : undefined,
    source_collection: processed.source_collection || undefined,
    source_collection_id: processed.source_collection_id || undefined,
    source_folder: processed.source_folder || undefined,
    source_folder_id: processed.source_folder_id || undefined,
    library_mode: processed.library_mode,
    status: "candidate",
    expires: addDays(now, processed.source.retention.candidate_ttl_days),
    score: processed.score,
    save_recommendation: processed.assessment.save_recommendation,
    proposed_destination: processed.proposed_destination,
    connected_projects: processed.connected_projects,
    connection_suggestions: processed.connection_suggestions?.length ? processed.connection_suggestions : undefined,
    connection_reasoning: processed.connection_reasoning || undefined,
    reconnected_at: processed.reconnected_at || undefined,
    reweave_candidates: processed.reweave_candidates?.length ? processed.reweave_candidates : undefined,
    attention_judgment: processed.attention_judgment || undefined,
    reweave_pending: processed.reweave_pending ? true : undefined,
    promotion: {
      promoted_to: null,
      promoted_at: null,
      promoted_reason: null,
    },
    ...youtubeFrontmatter(processed),
  };

  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }

  const media = buildMediaMarkdown(processed.raw);
  // Mirror buildDurableReferenceMarkdown: a free-form digest_markdown REPLACES the fixed
  // ## Summary / ## Key Points scaffold (the model chose its own ## headings). Without one, degrade
  // identically to the legacy Summary/Key Points form. The ## Assessment scaffold is dropped —
  // score + save_recommendation already live in frontmatter.
  const digestBlock = processed.digest_markdown
    ? processed.digest_markdown.trim()
    : `## Summary

${processed.summary}

## Key Points

${processed.key_points.length ? processed.key_points.map((point) => `- ${point}`).join("\n") : "- "}`;

  // Omit the Connections section entirely when there are none — no empty heading.
  const connections = connectionLines(processed);
  const connectionsBlock = connections.trim() ? `\n\n## Connections\n\n${connections}` : "";

  const body = `# ${processed.raw.title}

${media ? `${media}\n` : ""}${digestBlock}${connectionsBlock}

## Raw Content

<details>
<summary>Full source cache</summary>

${stripDetailsWrapper(cachedSourceContent(processed)) || "No cached source content available."}

</details>
`;

  return stringifyMarkdown(frontmatter, body);
}

export function writeCandidate(vaultPath: string, processed: ProcessedArtifact): string {
  const existing = findCandidateByUrl(vaultPath, processed.raw.url);
  if (existing) return path.join(vaultPath, existing.path);
  const filePath = candidateFilePath(vaultPath, processed);
  atomicWriteFile(filePath, buildCandidateMarkdown(processed));
  return filePath;
}

export function updateCandidate(vaultPath: string, candidate: ReferenceCandidate, updates: Record<string, unknown>): ReferenceCandidate {
  const filePath = path.join(vaultPath, candidate.path);
  const { data, body } = parseMarkdownFile(filePath);
  atomicWriteFile(filePath, stringifyMarkdown({ ...data, ...updates }, body));
  const updated = parseCandidateFile(vaultPath, filePath);
  if (!updated) throw new Error(`Failed to update candidate ${candidate.path}`);
  return updated;
}

export function expireCandidates(vaultPath: string, now = dateOnly()): ReferenceCandidate[] {
  const expired: ReferenceCandidate[] = [];
  for (const candidate of listCandidates(vaultPath, "candidate")) {
    if (candidate.expires < now) {
      expired.push(updateCandidate(vaultPath, candidate, { status: "expired", expired_at: isoNow() }));
    }
  }
  return expired;
}

export function ensureCandidateCache(vaultPath: string): void {
  ensureDir(candidateCacheDir(vaultPath));
}
