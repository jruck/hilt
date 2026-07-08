import fs from "fs";
import path from "path";
import type { CandidateStatus, LibraryArtifact, LibraryArtifactDetail, LibraryComment, LibraryLifecycleStatus, LibraryModeFilter, LibrarySourceFacetSummary, LibrarySourceSummary, ReferenceCandidate, SourceIntent, YouTubeClipReviewAttrs } from "./types";
import { CANDIDATE_CACHE_DIR, candidateCacheDir, findCandidateById, listCandidates, parseCandidateFile } from "./candidate-cache";
import { findSavedReferenceById, listSavedReferences, MANUAL_SOURCE_ID, MANUAL_SOURCE_NAME, parseReferenceFile, referencesDir } from "./references";
import { applyLibraryReadState, isLibraryArtifactNew, isLibraryArtifactUnread, readLibraryReadState } from "./read-state";
import { addStoredComment, deleteStoredComment, editStoredComment, getStoredComments, listStoredFeedback, markStoredCommentsProcessed } from "./library-feedback";
import { isMutedSender, readMutedSenders } from "./library-mute";
import { contentTypeForArtifact, type LibraryContentType } from "./content-type";
import { connectionPassState } from "./connection-state";
import { readReviewQueue } from "./review-queue";
import { loadSources, readSourceState } from "./source-config";
import { compareDatesDesc, dateTimestamp, ensureDir, hashId, isoNow, walkMarkdown } from "./utils";
import { parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";
import { artifactDisplayTags, validLibraryModeFilter } from "./taxonomy";
import { detectYouTubeContentForm } from "./youtube-clip-detector";
import { persistedYouTubeClip } from "./youtube-frontmatter";

export interface LibraryListOptions {
  source?: string | null;
  channel?: string | null;
  tag?: string | null;
  series?: string | null;
  mode?: LibraryModeFilter | null;
  status?: LibraryLifecycleStatus | "all" | null;
  unread?: boolean;
  q?: string | null;
  after?: string | null;
  before?: string | null;
  offset?: number;
  limit?: number;
  includeCandidates?: boolean;
  includeSkippedCandidates?: boolean;
  // Pipeline-inspection filters (frontmatter-based; the eval workbench in the sidebar).
  pipeline_version?: string | null;
  digested_with?: string | null;
  connection_state?: "has" | "abstained" | "never" | null;
  substance_graded?: "graded" | "ungraded" | null;
  reweave_pending?: boolean | null;
  feedback?: "none" | "unprocessed" | "processed" | null;
  youtube_clip_policy?: YouTubeClipReviewAttrs["policy_action"] | null;
  content_type?: LibraryContentType | null;
}

const candidateStatuses = new Set<LibraryLifecycleStatus>(["candidate", "skipped", "expired", "promoted"]);
const preciseRecencyFrontmatterKeys = [
  "captured_at",
  "saved_at",
  "digested_at",
  "created_at",
  "fetched_at",
] as const;

function preciseTimestamp(value: unknown): number {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    if (!Number.isFinite(timestamp)) return 0;
    const iso = value.toISOString();
    return /T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(iso) && !iso.endsWith("T00:00:00.000Z") ? timestamp : 0;
  }
  if (typeof value !== "string") return 0;
  const text = value.trim();
  if (!/[Tt]|\d{1,2}:\d{2}/.test(text)) return 0;
  const timestamp = Date.parse(text);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function artifactPreciseRecencyTimestamp(artifact: LibraryArtifactDetail): number {
  for (const key of preciseRecencyFrontmatterKeys) {
    const timestamp = preciseTimestamp(artifact.raw_frontmatter[key]);
    if (timestamp) return timestamp;
  }
  return dateTimestamp(artifact.updated_at) || dateTimestamp(artifact.created_at);
}

function compareArtifactsByRecent(a: LibraryArtifactDetail, b: LibraryArtifactDetail): number {
  const bySourceDate = compareDatesDesc(a.created_at, b.created_at);
  if (bySourceDate !== 0) return bySourceDate;

  const byPreciseRecency = artifactPreciseRecencyTimestamp(b) - artifactPreciseRecencyTimestamp(a);
  if (byPreciseRecency !== 0) return byPreciseRecency;

  return a.path.localeCompare(b.path);
}

function candidateToArtifact(vaultPath: string, candidate: ReferenceCandidate): LibraryArtifactDetail {
  const filePath = path.join(vaultPath, candidate.path);
  const updatedAt = fs.existsSync(filePath)
    ? fs.statSync(filePath).mtime.toISOString()
    : candidate.digested;
  return {
    id: candidate.id,
    path: candidate.path,
    abs_path: filePath,
    title: candidate.title,
    summary: candidate.summary || null,
    source_type: "reference-candidate",
    channel: candidate.channel,
    source_id: candidate.source_id,
    source_name: candidate.source_name,
    cited_from: candidate.cited_from,
    tags: candidate.tags,
    source_tags: candidate.source_tags,
    source_collection: candidate.source_collection,
    source_collection_id: candidate.source_collection_id,
    source_folder: candidate.source_folder,
    source_folder_id: candidate.source_folder_id,
    series: candidate.series,
    library_mode: candidate.library_mode,
    format: candidate.format || null,
    thumbnail: candidate.thumbnail,
    author: candidate.author,
    url: candidate.url,
    // Feed position = when this entered the library ("first seen" = digested), not the content's publish
    // date — same intake-ordering principle as saved refs (see referenceCreatedDate). This also aligns
    // the merged feed with candidate-cache's own digested-desc sort, which previously disagreed.
    // `digested` is always stamped (candidate-cache defaults it to today), so it is the reliable key.
    created_at: candidate.digested,
    updated_at: updatedAt,
    relevance_score: candidate.score.total,
    lifecycle_status: candidate.status,
    pipeline_version: typeof candidate.raw_frontmatter.pipeline_version === "string" ? candidate.raw_frontmatter.pipeline_version : undefined,
    video_duration_seconds: typeof candidate.raw_frontmatter.video_duration_seconds === "number"
      ? candidate.raw_frontmatter.video_duration_seconds
      : typeof candidate.raw_frontmatter.youtube_duration_seconds === "number"
        ? candidate.raw_frontmatter.youtube_duration_seconds
        : undefined,
    save_recommendation: candidate.save_recommendation,
    proposed_destination: candidate.proposed_destination,
    expires_at: candidate.expires,
    is_unread: false,
    read_at: null,
    content: candidate.content,
    key_points: candidate.key_points,
    connections: candidate.connected_projects,
    raw_frontmatter: candidate.raw_frontmatter,
  };
}

function matchesText(artifact: LibraryArtifactDetail, q: string): boolean {
  const haystack = [
    artifact.title,
    artifact.summary,
    artifact.url,
    artifact.source_name,
    artifact.tags.join(" "),
    artifact.source_tags.join(" "),
    artifact.source_collection,
    artifact.source_folder,
    artifact.series?.id,
    artifact.series?.title,
    artifact.content,
  ].join(" ").toLowerCase();
  return haystack.includes(q.toLowerCase());
}

function sourceIntent(value: unknown): SourceIntent | null {
  return value === "explicit_save" || value === "discovery" ? value : null;
}

function numberField(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function stringField(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function youtubeClipReviewForArtifact(artifact: LibraryArtifactDetail): YouTubeClipReviewAttrs | undefined {
  if (artifact.channel !== "youtube") return undefined;
  const fm = artifact.raw_frontmatter || {};
  const persisted = persistedYouTubeClip(fm.youtube_clip);
  if (persisted) return persisted;
  const detection = detectYouTubeContentForm({
    title: artifact.title,
    description: stringField(fm.youtube_description_preview) || stringField(fm.source_description) || stringField(fm.description) || artifact.summary || "",
    channelTitle: stringField(fm.youtube_channel_title) || artifact.author || stringField(fm.author),
    sourceId: artifact.source_id,
    sourceName: artifact.source_name,
    sourceIntent: sourceIntent(fm.intent),
    sourceSignal: stringField(fm.signal) || stringField(fm.source_signal),
    tags: [
      ...artifact.tags,
      ...artifact.source_tags,
      ...(Array.isArray(fm.youtube_tags) ? fm.youtube_tags.map(String) : []),
    ],
    durationSeconds: artifact.video_duration_seconds ?? numberField(fm.youtube_duration_seconds) ?? numberField(fm.duration_seconds),
  });
  return detection;
}

function withYouTubeClipReview<T extends LibraryArtifactDetail>(artifact: T): T {
  const youtubeClip = youtubeClipReviewForArtifact(artifact);
  return youtubeClip ? { ...artifact, youtube_clip: youtubeClip } : artifact;
}

function filterArtifacts(artifacts: LibraryArtifactDetail[], options: LibraryListOptions): LibraryArtifactDetail[] {
  const after = dateTimestamp(options.after);
  const before = dateTimestamp(options.before);
  const mode = validLibraryModeFilter(options.mode);
  return artifacts.filter((artifact) => {
    if (options.source && artifact.source_id !== options.source) return false;
    if (options.channel && artifact.channel !== options.channel) return false;
    if (options.tag && !artifactDisplayTags(artifact).some((tag) => tag.toLowerCase() === options.tag?.toLowerCase())) return false;
    if (options.series && artifact.series?.id !== options.series) return false;
    if (mode !== "all" && artifact.library_mode !== mode) return false;
    if (options.status && options.status !== "all" && artifact.lifecycle_status !== options.status) return false;
    if (options.unread && !artifact.is_unread) return false;
    if (after && dateTimestamp(artifact.created_at) < after) return false;
    if (before && dateTimestamp(artifact.created_at) > before) return false;
    if (options.q && !matchesText(artifact, options.q)) return false;
    if (options.pipeline_version && String(artifact.raw_frontmatter.pipeline_version || "") !== options.pipeline_version) return false;
    if (options.content_type && contentTypeForArtifact(artifact) !== options.content_type) return false;
    if (options.digested_with && String(artifact.raw_frontmatter.digested_with || "") !== options.digested_with) return false;
    if (options.youtube_clip_policy && artifact.youtube_clip?.policy_action !== options.youtube_clip_policy) return false;
    if (options.reweave_pending != null && (artifact.raw_frontmatter.reweave_pending === true) !== options.reweave_pending) return false;
    if (options.substance_graded) {
      const graded = typeof artifact.raw_frontmatter.substance === "number";
      if ((options.substance_graded === "graded") !== graded) return false;
    }
    if (options.connection_state) {
      const state = connectionPassState(artifact.raw_frontmatter);
      if (state !== options.connection_state) return false;
    }
    return true;
  });
}

export function listLibraryArtifactDetails(vaultPath: string, options: LibraryListOptions = {}): { artifacts: LibraryArtifactDetail[]; total: number; unread_total: number } {
  const saved = listSavedReferences(vaultPath);
  const includeClipReviewStatuses = Boolean((options.youtube_clip_policy && !options.status) || options.includeSkippedCandidates);
  const requestedCandidateStatus = options.status && options.status !== "all" && candidateStatuses.has(options.status)
    ? options.status as CandidateStatus
    : null;
  const candidates = options.includeCandidates === false
    || options.status === "saved"
    ? []
    : listCandidates(vaultPath, requestedCandidateStatus || undefined)
      .filter((candidate) => requestedCandidateStatus || candidate.status === "candidate" || (includeClipReviewStatuses && candidate.status === "skipped"))
      .map((candidate) => candidateToArtifact(vaultPath, candidate));
  const all = [...saved, ...candidates].sort(compareArtifactsByRecent);
  const state = readLibraryReadState(vaultPath);
  const readAware = applyLibraryReadState(all.map(withYouTubeClipReview), state);
  let pool = readAware;
  const mutedSenders = readMutedSenders(vaultPath);
  if (mutedSenders.size) {
    pool = pool.filter((artifact) => !isMutedSender(mutedSenders, artifact.author || (typeof artifact.raw_frontmatter.author === "string" ? artifact.raw_frontmatter.author : null)));
  }
  if (options.feedback) {
    const stored = listStoredFeedback(vaultPath);
    const hasComments = new Set(stored.filter((entry) => entry.comments.length).map((entry) => entry.id));
    const hasUnprocessed = new Set(stored.filter((entry) => entry.comments.some((c) => !c.processed_at)).map((entry) => entry.id));
    pool = pool.filter((artifact) => {
      if (options.feedback === "none") return !hasComments.has(artifact.id);
      if (options.feedback === "unprocessed") return hasUnprocessed.has(artifact.id);
      if (options.feedback === "processed") return hasComments.has(artifact.id) && !hasUnprocessed.has(artifact.id);
      return true;
    });
  }
  const filtered = filterArtifacts(pool, options);
  const offset = options.offset || 0;
  const limit = options.limit || 50;
  return {
    artifacts: filtered.slice(offset, offset + limit),
    total: filtered.length,
    unread_total: filtered.filter((artifact) => artifact.is_unread).length,
  };
}

/** Short-circuiting walk over every non-keep library artifact (saved + candidates). Returns true as
 *  soon as `predicate` matches one — shared by the unread and "new since visit" checks. */
function anyLibraryArtifact(vaultPath: string, predicate: (artifact: LibraryArtifactDetail) => boolean): boolean {
  for (const filePath of walkMarkdown(referencesDir(vaultPath))) {
    if (filePath.includes(`${path.sep}.cache${path.sep}`)) continue;
    const artifact = parseReferenceFile(vaultPath, filePath);
    if (artifact?.library_mode === "keep") continue;
    if (artifact && predicate(artifact)) return true;
  }

  for (const filePath of walkMarkdown(candidateCacheDir(vaultPath), { includeHidden: true })) {
    let candidate: ReferenceCandidate | null = null;
    try {
      candidate = parseCandidateFile(vaultPath, filePath);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[library] skipping malformed candidate for unread/new check: ${filePath}: ${message}`);
      continue;
    }
    if (!candidate || candidate.status !== "candidate") continue;
    const artifact = candidateToArtifact(vaultPath, candidate);
    if (artifact.library_mode === "keep") continue;
    if (predicate(artifact)) return true;
  }

  return false;
}

export function hasUnreadLibraryArtifacts(vaultPath: string): boolean {
  const state = readLibraryReadState(vaultPath);
  return anyLibraryArtifact(vaultPath, (artifact) => isLibraryArtifactUnread(artifact, state));
}

/** Any non-keep item that ARRIVED since the user last opened the Library tab — the nav-dot signal. */
export function hasNewLibraryArtifacts(vaultPath: string): boolean {
  const state = readLibraryReadState(vaultPath);
  return anyLibraryArtifact(vaultPath, (artifact) => isLibraryArtifactNew(artifact, state));
}

export function getLibraryArtifact(vaultPath: string, id: string): LibraryArtifactDetail | null {
  const saved = findSavedReferenceById(vaultPath, id);
  const artifact = saved || (() => {
    const candidate = findCandidateById(vaultPath, id);
    return candidate ? candidateToArtifact(vaultPath, candidate) : null;
  })();
  if (!artifact) return null;
  return applyLibraryReadState([withYouTubeClipReview(artifact)], readLibraryReadState(vaultPath))[0] || null;
}

function resolveArtifactPath(vaultPath: string, artifactPath: string): { relPath: string; filePath: string } | null {
  const relPath = artifactPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relPath.endsWith(".md")) return null;
  if (relPath.split("/").some((part) => part === "..")) return null;
  const vaultRoot = path.resolve(vaultPath);
  const filePath = path.resolve(vaultRoot, relPath);
  if (filePath !== vaultRoot && !filePath.startsWith(`${vaultRoot}${path.sep}`)) return null;
  if (!fs.existsSync(filePath)) return null;
  return { relPath, filePath };
}

export function getLibraryArtifactByPath(vaultPath: string, id: string, artifactPath: string): LibraryArtifactDetail | null {
  const resolved = resolveArtifactPath(vaultPath, artifactPath);
  if (!resolved) return null;
  if (hashId(resolved.relPath) !== id) return null;

  const candidatePrefix = `${CANDIDATE_CACHE_DIR.split(path.sep).join("/")}/`;
  const artifact = resolved.relPath.startsWith(candidatePrefix)
    ? (() => {
      const candidate = parseCandidateFile(vaultPath, resolved.filePath);
      return candidate ? candidateToArtifact(vaultPath, candidate) : null;
    })()
    : parseReferenceFile(vaultPath, resolved.filePath);
  if (!artifact) return null;
  return applyLibraryReadState([artifact], readLibraryReadState(vaultPath))[0] || null;
}

export function summarizeArtifact(artifact: LibraryArtifactDetail): LibraryArtifact {
  const { content: _content, key_points: _keyPoints, connections: _connections, raw_frontmatter: _frontmatter, ...summary } = artifact;
  return summary;
}

function facetId(kind: LibrarySourceFacetSummary["kind"], value: string): string {
  return `${kind}:${value.toLowerCase()}`;
}

function artifactFacets(artifact: LibraryArtifactDetail): Array<{ kind: LibrarySourceFacetSummary["kind"]; label: string; value: string }> {
  const entries: Array<{ kind: LibrarySourceFacetSummary["kind"]; label: string; value: string }> = [];
  if (artifact.source_collection) entries.push({ kind: "collection", label: artifact.source_collection, value: artifact.source_collection });
  if (artifact.source_folder) entries.push({ kind: "folder", label: artifact.source_folder, value: artifact.source_folder });
  for (const tag of artifact.source_tags) entries.push({ kind: "tag", label: tag, value: tag });
  return entries;
}

function sourceFacets(artifacts: LibraryArtifactDetail[], pendingReviewIds: Set<string>): LibrarySourceFacetSummary[] {
  const facets = new Map<string, LibrarySourceFacetSummary>();
  for (const artifact of artifacts) {
    for (const entry of artifactFacets(artifact)) {
      const id = facetId(entry.kind, entry.value);
      const current = facets.get(id) || {
        id,
        kind: entry.kind,
        label: entry.label,
        value: entry.value,
        count: 0,
        unread_count: 0,
        review_count: 0,
      };
      current.count += 1;
      if (artifact.is_unread) current.unread_count += 1;
      if (pendingReviewIds.has(artifact.id)) current.review_count += 1;
      facets.set(id, current);
    }
  }
  return Array.from(facets.values())
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))
    .slice(0, 40);
}

function summarizeSourceArtifacts(
  source: { id: string; name: string; channel: LibrarySourceSummary["channel"]; enabled: boolean; intent: LibrarySourceSummary["intent"] },
  artifacts: LibraryArtifactDetail[],
  pendingReviewIds: Set<string>,
  lastFetched: string | null,
  blocked: string | null,
): LibrarySourceSummary {
  return {
    id: source.id,
    name: source.name,
    channel: source.channel,
    enabled: source.enabled,
    intent: source.intent,
    artifact_count: artifacts.filter((artifact) => artifact.lifecycle_status === "saved").length,
    candidate_count: artifacts.filter((artifact) => artifact.lifecycle_status === "candidate").length,
    unread_count: artifacts.filter((artifact) => artifact.is_unread).length,
    saved_unread_count: artifacts.filter((artifact) => artifact.lifecycle_status === "saved" && artifact.is_unread).length,
    candidate_unread_count: artifacts.filter((artifact) => artifact.lifecycle_status === "candidate" && artifact.is_unread).length,
    study_count: artifacts.filter((artifact) => artifact.library_mode === "study").length,
    keep_count: artifacts.filter((artifact) => artifact.library_mode === "keep").length,
    study_unread_count: artifacts.filter((artifact) => artifact.library_mode === "study" && artifact.is_unread).length,
    keep_unread_count: artifacts.filter((artifact) => artifact.library_mode === "keep" && artifact.is_unread).length,
    review_count: artifacts.filter((artifact) => pendingReviewIds.has(artifact.id)).length,
    saved_review_count: artifacts.filter((artifact) => artifact.lifecycle_status === "saved" && pendingReviewIds.has(artifact.id)).length,
    candidate_review_count: artifacts.filter((artifact) => artifact.lifecycle_status === "candidate" && pendingReviewIds.has(artifact.id)).length,
    last_fetched: lastFetched,
    blocked,
    facets: sourceFacets(artifacts, pendingReviewIds),
  };
}

export function listLibrarySources(vaultPath: string, options: Omit<LibraryListOptions, "source" | "offset" | "limit" | "includeCandidates"> = {}): LibrarySourceSummary[] {
  const sources = loadSources(vaultPath);
  const state = readSourceState(vaultPath);
  const all = listLibraryArtifactDetails(vaultPath, {
    ...options,
    limit: 10000,
    includeCandidates: true,
  }).artifacts;
  // Pending-review item ids (review-queue keys ARE the artifact ids) — surfaced as a per-source
  // review count alongside total/unread in the sidebar.
  const reviewQueue = readReviewQueue(vaultPath);
  const pendingReviewIds = new Set(
    Object.entries(reviewQueue.items).filter(([, entry]) => entry.status === "pending").map(([id]) => id),
  );
  const summaries = sources.map((source) => summarizeSourceArtifacts(
    source,
    all.filter((artifact) => artifact.source_id === source.id),
    pendingReviewIds,
    state[source.id]?.last_success_at || null,
    state[source.id]?.blocked_reason || null,
  ));
  if (!summaries.some((source) => source.id === MANUAL_SOURCE_ID)) {
    const manualArtifacts = all.filter((artifact) => artifact.source_id === MANUAL_SOURCE_ID);
    if (manualArtifacts.length) {
      summaries.unshift(summarizeSourceArtifacts(
        {
          id: MANUAL_SOURCE_ID,
          name: MANUAL_SOURCE_NAME,
          channel: "manual",
          enabled: true,
          intent: "explicit_save",
        },
        manualArtifacts,
        pendingReviewIds,
        null,
        null,
      ));
    }
  }
  // The Editor's Memo writes first-class library items but has no source yaml — surface it as its
  // own sidebar source (same pattern as Manual) so memos are browsable as a stream. Unshifted
  // LAST so it sits ABOVE Manual at the top of the sidebar.
  const memoArtifacts = all.filter((artifact) => artifact.source_id === "library-memo");
  if (memoArtifacts.length && !summaries.some((source) => source.id === "library-memo")) {
    summaries.unshift(summarizeSourceArtifacts(
      {
        id: "library-memo",
        name: "Editor's Memo",
        channel: "manual",
        enabled: true,
        intent: "explicit_save",
      },
      memoArtifacts,
      pendingReviewIds,
      null,
      null,
    ));
  }
  return summaries;
}

export function contentHashForFile(filePath: string): string {
  return hashId(fs.readFileSync(filePath, "utf-8"), 20);
}

export function artifactFilePath(vaultPath: string, artifact: LibraryArtifact): string {
  return path.join(vaultPath, artifact.path);
}

function uniqueArchivePath(archiveDir: string, fileName: string): string {
  let target = path.join(archiveDir, fileName);
  const parsed = path.parse(fileName);
  let index = 2;
  while (fs.existsSync(target)) {
    target = path.join(archiveDir, `${parsed.name}-${index}${parsed.ext}`);
    index += 1;
  }
  return target;
}

export function archiveLibraryArtifact(vaultPath: string, id: string): { archived_to: string } {
  const artifact = getLibraryArtifact(vaultPath, id);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.lifecycle_status !== "saved") throw new Error("Only saved references can be archived");

  const filePath = artifactFilePath(vaultPath, artifact);
  if (!fs.existsSync(filePath)) throw new Error("Reference file not found");
  const archiveDir = path.join(path.dirname(filePath), ".archive");
  ensureDir(archiveDir);
  const targetPath = uniqueArchivePath(archiveDir, path.basename(filePath));
  const parsed = parseMarkdownFile(filePath);
  fs.writeFileSync(filePath, stringifyMarkdown({
    ...parsed.data,
    archived: true,
    archived_at: isoNow(),
    archived_from: artifact.path,
    // Records who dismissed it. Manual archive is sticky; the eval never sets this (it only flags
    // `to_archive`). When auto-archive ships, the system path writes `archived_by: system` instead.
    archived_by: "user",
  }, parsed.body), "utf-8");
  fs.renameSync(filePath, targetPath);
  return { archived_to: relativeVaultPath(vaultPath, targetPath) };
}

export interface LibraryFeedbackItem {
  id: string;
  title: string;
  path: string;
  comments: LibraryComment[];
  unprocessed: number;
}

// Feedback lives in Hilt's DATA_DIR store (library-feedback.ts), NOT the vault frontmatter — it is
// commentary to the eval engine, not article content. These are thin re-exports of the store ops.
export const addLibraryComment = addStoredComment;
export const editLibraryComment = editStoredComment;
export const deleteLibraryComment = deleteStoredComment;
export const markLibraryCommentsProcessed = markStoredCommentsProcessed;

/** Comments for one item (for the detail metadata panel). */
export function getLibraryComments(vaultPath: string, id: string): LibraryComment[] {
  return getStoredComments(vaultPath, id);
}

/** Items carrying feedback comments, joined with current title/path. Default = only unprocessed. */
export function listLibraryFeedback(vaultPath: string, options: { includeProcessed?: boolean } = {}): LibraryFeedbackItem[] {
  const stored = listStoredFeedback(vaultPath);
  if (!stored.length) return [];
  const byId = new Map<string, LibraryArtifactDetail>();
  for (const artifact of listLibraryArtifactDetails(vaultPath, { limit: 100000, includeCandidates: true, mode: "all" }).artifacts) {
    byId.set(artifact.id, artifact);
  }
  const items: LibraryFeedbackItem[] = [];
  for (const { id, comments } of stored) {
    const unprocessed = comments.filter((comment) => !comment.processed_at).length;
    if (!options.includeProcessed && unprocessed === 0) continue;
    const artifact = byId.get(id);
    items.push({ id, title: artifact?.title || id, path: artifact?.path || "", comments, unprocessed });
  }
  return items.sort((a, b) => b.unprocessed - a.unprocessed);
}
