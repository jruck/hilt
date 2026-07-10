import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail, ProcessedArtifact, PromotionReason } from "./types";
import { atomicWriteFile, canonicalUrl, compareDatesDesc, dateOnly, ensureDir, hashId, isoNow, slugify, toArray, walkMarkdown } from "./utils";
import { extractBullets, extractConnections, extractHeading, extractSection, frontmatterTags, parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";
import { readCitations } from "./citations";
import { buildMediaMarkdown, cachedSourceContent, stripDetailsWrapper } from "./media";
import { PIPELINE_VERSION } from "./pipeline";
import { friendlyNewsletterSender, semanticTags, uniqueTags, validLibraryMode } from "./taxonomy";
import { youtubeFrontmatter } from "./youtube-frontmatter";
import { seriesFromFrontmatter, seriesFrontmatter } from "./series";
import { processingStateOf } from "./processing-state";

const REFERENCES_DIR = "references";
export const MANUAL_SOURCE_ID = "manual";
export const MANUAL_SOURCE_NAME = "Manual";
const NEWSLETTERS_SOURCE_ID = "superhuman-news";
const NEWSLETTERS_SOURCE_NAME = "Newsletters";
const BOOK_CAPTURE_SOURCE_ID = "book-capture";
const BOOK_CAPTURE_SOURCE_NAME = "Books";

export function referencesDir(vaultPath: string): string {
  return path.join(vaultPath, REFERENCES_DIR);
}

function frontmatterDate(value: unknown): string | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? dateOnly(date) : null;
}

function referenceCreatedDate(data: Record<string, unknown>, stat: fs.Stats): string {
  // Feed position reflects when an item entered Justin's library — "the first time he saw it" — NOT when
  // the source was originally published. A months-old tweet or a week-old candidate bookmarked today
  // surfaces at the TOP, because that bookmark is the moment it became his. So prefer the intake stamps
  // (saved_at / captured) over the content publish date, falling back to published for legacy items
  // written before intake stamping. For normal ingestion captured≈published (75/79 within 3 days), so
  // only deliberately-saved older content actually moves — which is exactly the desired behavior.
  return frontmatterDate(data.saved_at)
    || frontmatterDate(data.captured_at)
    || frontmatterDate(data.captured)
    || frontmatterDate(data.published)
    || frontmatterDate(data.created)
    || frontmatterDate(data.created_at)
    || frontmatterDate(data.digested_at)
    || frontmatterDate(data.fetched_at)
    || dateOnly(stat.birthtime);
}

// Per-file derived-detail cache. parseMarkdownFile already memoizes the raw gray-matter parse one
// layer down; this memoizes the full LibraryArtifactDetail transform — the regex Summary/Key
// Points/Connections extraction, tag derivation, and object construction that otherwise re-run for
// EVERY reference file on every list request. Keyed on mtimeMs+size, so any write (in-place edit or
// atomic temp+rename) changes the stat and invalidates exactly the touched file — no manual busting.
// Sharing the returned object is safe: the read path is mutation-free (read-state and YouTube-clip
// review derive new objects via spread; nothing mutates raw_frontmatter / tags / connections in
// place — verified), and write paths rebuild from ProcessedArtifact, never from a cached detail.
const detailCache = new Map<string, { mtimeMs: number; size: number; detail: LibraryArtifactDetail }>();
const DETAIL_CACHE_MAX_ENTRIES = 8192;

export function parseReferenceFile(vaultPath: string, filePath: string): LibraryArtifactDetail | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }
  const cached = detailCache.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
    return cached.detail;
  }
  let parsed: ReturnType<typeof parseMarkdownFile>;
  try {
    parsed = parseMarkdownFile(filePath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[library] skipping malformed reference frontmatter: ${filePath}: ${message}`);
    return null;
  }
  const { data, body } = parsed;
  if (data.type !== "reference") return null;
  const relPath = relativeVaultPath(vaultPath, filePath);
  const fallbackTitle = path.basename(filePath, ".md");
  const title = String(data.title || extractHeading(body, fallbackTitle));
  const summary = String(data.description || extractSection(body, "Summary") || "").trim() || null;
  const url = typeof data.url === "string"
    ? data.url
    : typeof data.source === "string" && /^https?:\/\//.test(data.source)
      ? data.source
      : null;
  const channel = typeof data.channel === "string" ? data.channel : null;
  const explicitSourceId = typeof data.source_id === "string" ? data.source_id : null;
  const sourceId = explicitSourceId || MANUAL_SOURCE_ID;
  const sourceName = sourceId === NEWSLETTERS_SOURCE_ID
    ? NEWSLETTERS_SOURCE_NAME
    : sourceId === BOOK_CAPTURE_SOURCE_ID
      ? BOOK_CAPTURE_SOURCE_NAME
      : sourceId === MANUAL_SOURCE_ID
        ? MANUAL_SOURCE_NAME
        : typeof data.source_name === "string"
          ? data.source_name
          : explicitSourceId
            ? null
            : MANUAL_SOURCE_NAME;
  const created = referenceCreatedDate(data, stat);
  const updated = stat.mtime.toISOString();
  const keyPoints = extractBullets(extractSection(body, "Key Points"));
  const sourceTags = uniqueTags(toArray(data.source_tags));
  const sourceCollection = typeof data.source_collection === "string" && data.source_collection.trim() ? data.source_collection.trim() : null;
  const sourceCollectionId = typeof data.source_collection_id === "string" || typeof data.source_collection_id === "number" ? String(data.source_collection_id) : null;
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
  const tags = semanticTags(frontmatterTags(data));
  const series = seriesFromFrontmatter(data);
  const artifactUid = typeof data.artifact_uid === "string" && data.artifact_uid.trim() ? data.artifact_uid.trim() : undefined;
  const processing = processingStateOf(data.processing);

  const detail: LibraryArtifactDetail = {
    id: artifactUid || hashId(relPath),
    path: relPath,
    abs_path: filePath,
    title,
    source_title: typeof data.source_title === "string" ? data.source_title : null,
    summary,
    source_type: "reference",
    channel: (channel || MANUAL_SOURCE_ID) as LibraryArtifactDetail["channel"],
    source_id: sourceId,
    source_name: sourceName,
    cited_from: readCitations(data),
    tags,
    source_tags: sourceTags,
    source_collection: sourceCollection,
    source_collection_id: sourceCollectionId,
    source_folder: sourceFolder,
    source_folder_id: sourceFolderId,
    series,
    library_mode: validLibraryMode(data.library_mode),
    format: typeof data.format === "string" ? data.format : null,
    thumbnail: typeof data.thumbnail === "string" ? data.thumbnail : null,
    author,
    url,
    created_at: created,
    updated_at: updated,
    lifecycle_status: "saved",
    pipeline_version: typeof data.pipeline_version === "string" ? data.pipeline_version : undefined,
    video_duration_seconds: typeof data.video_duration_seconds === "number"
      ? data.video_duration_seconds
      : typeof data.youtube_duration_seconds === "number"
        ? data.youtube_duration_seconds
        : undefined,
    is_unread: false,
    read_at: null,
    processing,
    content: body.trim(),
    key_points: keyPoints,
    connections: extractConnections(body),
    raw_frontmatter: data,
  };
  if (detailCache.size >= DETAIL_CACHE_MAX_ENTRIES) detailCache.clear();
  detailCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, detail });
  return detail;
}

export function listSavedReferences(vaultPath: string): LibraryArtifactDetail[] {
  return walkMarkdown(referencesDir(vaultPath))
    .filter((filePath) => !filePath.includes(`${path.sep}.cache${path.sep}`))
    .map((filePath) => parseReferenceFile(vaultPath, filePath))
    .filter((artifact): artifact is LibraryArtifactDetail => Boolean(artifact))
    .sort((a, b) => compareDatesDesc(a.created_at, b.created_at));
}

export function listArchivedReferences(vaultPath: string): LibraryArtifactDetail[] {
  return walkMarkdown(referencesDir(vaultPath), { includeHidden: true })
    .filter((filePath) => filePath.includes(`${path.sep}.archive${path.sep}`))
    .filter((filePath) => !filePath.includes(`${path.sep}.cache${path.sep}`))
    .map((filePath) => parseReferenceFile(vaultPath, filePath))
    .filter((artifact): artifact is LibraryArtifactDetail => Boolean(artifact))
    .sort((a, b) => compareDatesDesc(a.created_at, b.created_at));
}

export function findSavedReferenceById(vaultPath: string, id: string): LibraryArtifactDetail | null {
  for (const filePath of walkMarkdown(referencesDir(vaultPath))) {
    if (filePath.includes(`${path.sep}.cache${path.sep}`)) continue;
    const artifact = parseReferenceFile(vaultPath, filePath);
    if (artifact?.id === id) return artifact;
  }
  return null;
}

export function findSavedReferenceByUrl(vaultPath: string, url: string): LibraryArtifact | null {
  const canonical = canonicalUrl(url);
  return listSavedReferences(vaultPath).find((artifact) => artifact.url && canonicalUrl(artifact.url) === canonical) || null;
}

export function findArchivedReferenceByUrl(vaultPath: string, url: string): LibraryArtifact | null {
  const canonical = canonicalUrl(url);
  return listArchivedReferences(vaultPath).find((artifact) => artifact.url && canonicalUrl(artifact.url) === canonical) || null;
}

function destinationDir(vaultPath: string, proposedDestination: string | null | undefined): string {
  const normalized = proposedDestination?.replace(/^\/+/, "").replace(/\/+$/, "");
  if (normalized && (normalized === "references" || normalized.startsWith("references/"))) {
    return path.join(vaultPath, normalized);
  }
  return referencesDir(vaultPath);
}

function uniqueReferencePath(dir: string, title: string, date: string): string {
  ensureDir(dir);
  const base = `${date}-${slugify(title)}`;
  let candidate = path.join(dir, `${base}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${base}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function connectionLines(processed: ProcessedArtifact): string {
  if (processed.connection_suggestions?.length) {
    return processed.connection_suggestions.map((suggestion) => {
      // Render the human title as the wikilink alias so the rendered text reads naturally while
      // the link still resolves to the note's vault path.
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

export function buildDurableReferenceMarkdown(processed: ProcessedArtifact, reason?: PromotionReason): string {
  const { raw, source } = processed;
  const capturedAt = processed.processing?.started_at || isoNow();
  const captured = dateOnly(capturedAt);
  const frontmatter: Record<string, unknown> = {
    type: "reference",
    artifact_uid: processed.artifact_uid || undefined,
    source_title: processed.source_title || undefined,
    pipeline_version: PIPELINE_VERSION,
    // Prefer the reweave's feed-card description when present, else the summary. The reweave
    // description is allowed a touch more room (300) than the legacy summary slice.
    description: (processed.description || processed.summary).slice(0, processed.digest_markdown ? 300 : 180),
    url: raw.url,
    format: processed.format,
    author: raw.author || undefined,
    published: raw.date ? dateOnly(raw.date) : undefined,
    captured,
    captured_at: capturedAt,
    channel: source.channel,
    source_id: source.id,
    source_name: source.name,
    cited_from: processed.cited_from?.length ? processed.cited_from : undefined,
    digestion_status: processed.digestion?.status,
    digested_with: processed.digestion?.extractor,
    digested_at: processed.digestion?.digested_at,
    extracted_chars: processed.digestion?.extracted_chars,
    cached_source_chars: processed.digestion?.cached_source_chars,
    cached_source_extractor: processed.digestion?.cached_source_extractor,
    video_url: typeof raw.metadata.video_url === "string" ? raw.metadata.video_url : undefined,
    video_duration_seconds: processed.video_duration_seconds,
    x_video_transcript_status: typeof raw.metadata.x_video_transcript_status === "string" ? raw.metadata.x_video_transcript_status : undefined,
    x_video_transcript_method: typeof raw.metadata.x_video_transcript_method === "string" ? raw.metadata.x_video_transcript_method : undefined,
    thumbnail: raw.thumbnail || undefined,
    source_recovered_from: typeof raw.metadata.source_recovered_from === "string" ? raw.metadata.source_recovered_from : undefined,
    tags: processed.tags,
    source_tags: processed.source_tags.length ? processed.source_tags : undefined,
    source_collection: processed.source_collection || undefined,
    source_collection_id: processed.source_collection_id || undefined,
    source_folder: processed.source_folder || undefined,
    source_folder_id: processed.source_folder_id || undefined,
    ...seriesFrontmatter(processed.series),
    library_mode: processed.library_mode,
    connected_projects: processed.connected_projects.length ? processed.connected_projects : undefined,
    connection_suggestions: processed.connection_suggestions?.length ? processed.connection_suggestions : undefined,
    connection_reasoning: processed.connection_reasoning || undefined,
    reconnected_at: processed.reconnected_at || undefined,
    reweave_candidates: processed.reweave_candidates?.length ? processed.reweave_candidates : undefined,
    attention_judgment: processed.attention_judgment || undefined,
    reweave_pending: processed.reweave_pending ? true : undefined,
    needs_auth_recovery: processed.needs_auth_recovery ? true : undefined,
    processing: processed.processing || undefined,
    relevance_signals: source.intent === "explicit_save" ? [{
      type: source.signal || "explicit_save",
      channel: source.channel,
      at: captured,
    }] : reason ? [{
      type: reason,
      channel: source.channel,
      at: captured,
    }] : undefined,
    ...youtubeFrontmatter(processed),
  };

  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }

  const keyPoints = processed.key_points.length
    ? processed.key_points.map((point) => `- ${point}`).join("\n")
    : "- ";
  const connections = connectionLines(processed);
  const media = buildMediaMarkdown(raw);
  const rawContent = stripDetailsWrapper(cachedSourceContent(processed));
  const notes = processed.extraction_notes.length
    ? `\n\n## Source Notes\n\n${processed.extraction_notes.map((note) => `- ${note}`).join("\n")}`
    : "";

  // When the reweave produced a free-form digest, it REPLACES the fixed ## Summary / ## Key Points
  // sections — the model chose its own ## headings. Otherwise keep the legacy Summary/Key Points form.
  const digestBlock = processed.digest_markdown
    ? processed.digest_markdown.trim()
    : `## Summary

${processed.summary}

## Key Points

${keyPoints}`;

  // Omit the Connections section entirely when there are none — no empty heading.
  const connectionsBlock = connections.trim() ? `\n\n## Connections\n\n${connections}` : "";

  const body = `# ${raw.title}

${media ? `${media}\n` : ""}${digestBlock}${connectionsBlock}

## Raw Content

<details>
<summary>Full source cache</summary>

${rawContent || "No cached source content available."}

</details>${notes}
`;

  return stringifyMarkdown(frontmatter, body);
}

export function writeDurableReference(vaultPath: string, processed: ProcessedArtifact, reason?: PromotionReason): string {
  const duplicate = findSavedReferenceByUrl(vaultPath, processed.raw.url);
  if (duplicate) return path.join(vaultPath, duplicate.path);
  const dir = destinationDir(vaultPath, processed.proposed_destination);
  const filePath = uniqueReferencePath(dir, processed.raw.title, dateOnly(processed.raw.date || new Date()));
  atomicWriteFile(filePath, buildDurableReferenceMarkdown(processed, reason));
  return filePath;
}

export function writeDurableReferenceAtPath(filePath: string, processed: ProcessedArtifact, reason?: PromotionReason): string {
  atomicWriteFile(filePath, buildDurableReferenceMarkdown(processed, reason));
  return filePath;
}

export function artifactSummary(artifact: LibraryArtifactDetail): LibraryArtifact {
  const { content: _content, key_points: _keyPoints, connections: _connections, raw_frontmatter: _frontmatter, ...summary } = artifact;
  return summary;
}
