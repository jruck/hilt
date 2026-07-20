import fs from "node:fs";
import path from "node:path";
import type {
  DigestionProgressEvent,
  LibraryArtifact,
  LibraryIntakeArtifactResult,
  LibraryProcessingState,
  LibrarySourceConfig,
  RawArtifact,
} from "./types";
import { CANDIDATE_CACHE_DIR, findCandidateByUrl } from "./candidate-cache";
import { findArchivedReferenceByUrl, findSavedReferenceByUrl } from "./references";
import { buildMediaMarkdown } from "./media";
import { artifactTaxonomy } from "./taxonomy";
import { seriesFrontmatter, seriesFromRaw } from "./series";
import { atomicWriteFile, canonicalUrl, dateOnly, ensureDir, hashId, isoNow, slugify } from "./utils";
import { parseMarkdownFile, relativeVaultPath, stringifyMarkdown } from "./markdown";

export const PROCESSING_MAX_ATTEMPTS = 2;
export const PROCESSING_STALE_ACTIVE_MS = 45 * 60 * 1000;
const PROCESSING_DIR = "library-processing";

export interface LibraryProcessingQueueRecord {
  version: 1;
  artifact_uid: string;
  vault_path: string;
  target_path: string;
  lifecycle_status: "saved" | "candidate";
  source_title: string;
  raw: RawArtifact;
  source: LibrarySourceConfig;
  queued_at: string;
  updated_at: string;
  attempt: number;
  status: "queued" | "active" | "blocked";
  next_retry_at: string | null;
  processing_options?: {
    use_summarize?: boolean;
    reweave_timeout_ms?: number;
  };
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function libraryProcessingDir(vaultPath: string): string {
  return path.join(dataDir(), PROCESSING_DIR, hashId(path.resolve(vaultPath), 16));
}

export function libraryProcessingQueuePath(vaultPath: string, artifactUid: string): string {
  return path.join(libraryProcessingDir(vaultPath), `${artifactUid}.json`);
}

function intakeBatchLockPath(vaultPath: string): string {
  return path.join(libraryProcessingDir(vaultPath), ".intake-active");
}

export function beginLibraryIntakeBatch(vaultPath: string): void {
  const filePath = intakeBatchLockPath(vaultPath);
  ensureDir(path.dirname(filePath));
  atomicWriteFile(filePath, `${isoNow()}\n`);
}

export function endLibraryIntakeBatch(vaultPath: string): void {
  try { fs.unlinkSync(intakeBatchLockPath(vaultPath)); } catch { /* already clear */ }
}

export function libraryIntakeBatchActive(vaultPath: string): boolean {
  return fs.existsSync(intakeBatchLockPath(vaultPath));
}

export function isGenericLibraryThumbnail(value: string | null | undefined): boolean {
  if (!value) return false;
  return /abs\.twimg\.com\/rweb\/ssr\/default\//i.test(value)
    || /(?:x|twitter)\.com\/.*\bdefault[_-]?og\b/i.test(value);
}

function usableThumbnail(value: string | undefined): string | undefined {
  return value && !isGenericLibraryThumbnail(value) ? value : undefined;
}

function looksLikeUrlDump(value: string): boolean {
  if (!value.trim()) return true;
  const withoutUrls = value.replace(/https?:\/\/\S+/gi, " ")
    .replace(/\b(?:Author|Published|Links?|Source)\s*:/gi, " ")
    .replace(/[\d:TZ.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (withoutUrls.match(/\b[A-Za-z]{3,}\b/g) || []).length < 5;
}

function sourceHost(raw: RawArtifact): string | null {
  try {
    return new URL(raw.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function placeholderTitle(raw: RawArtifact, source: LibrarySourceConfig): string {
  const title = raw.title.trim();
  const expanded = typeof raw.metadata.expanded_url === "string" ? raw.metadata.expanded_url : "";
  const xArticle = /(?:x|twitter)\.com\/i\/article\//i.test(expanded);
  if (xArticle && (/^x bookmark\b/i.test(title) || looksLikeUrlDump(raw.content || title))) {
    return raw.author ? `Article shared by ${raw.author}` : "Article shared on X";
  }
  const titleIsMetadataDump = /^https?:\/\//i.test(title)
    || /\b(?:Author|Published|Links?|Source)\s*:/i.test(title)
    || (title.match(/https?:\/\/\S+/gi) || []).join("").length > title.length / 2;
  if (title && !titleIsMetadataDump) return title;
  const kind = source.channel === "youtube" ? "Video" : source.channel === "email" ? "Newsletter" : "Article";
  if (raw.author) return `${kind} from ${raw.author}`;
  const host = sourceHost(raw);
  return host ? `${kind} from ${host}` : `${kind} saved from ${source.name}`;
}

export function placeholderDescription(raw: RawArtifact, source: LibrarySourceConfig): string {
  const content = (raw.content || "").replace(/\s+/g, " ").trim();
  if (content && !looksLikeUrlDump(content)) return content.slice(0, 300);
  const kind = source.channel === "youtube" ? "Video" : source.channel === "twitter" ? "Item" : "Reference";
  return `${kind} saved from ${source.name}${raw.author ? ` by ${raw.author}` : ""}.`;
}

function uniquePath(dir: string, basename: string): string {
  ensureDir(dir);
  let candidate = path.join(dir, `${basename}.md`);
  let index = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${basename}-${index}.md`);
    index += 1;
  }
  return candidate;
}

function targetPath(vaultPath: string, raw: RawArtifact, source: LibrarySourceConfig, uid: string): string {
  const date = dateOnly(raw.date || new Date());
  const title = placeholderTitle(raw, source);
  if (source.intent !== "explicit_save") {
    return path.join(vaultPath, CANDIDATE_CACHE_DIR, `${date}-${slugify(title)}-${uid.slice(0, 10)}.md`);
  }
  const proposed = typeof raw.metadata.proposed_destination === "string"
    ? raw.metadata.proposed_destination.replace(/^\/+|\/+$/g, "")
    : source.channel === "youtube" || source.channel === "twitter"
      ? "references/process"
      : "references";
  const relativeDir = proposed === "references" || proposed.startsWith("references/") ? proposed : "references";
  return uniquePath(path.join(vaultPath, relativeDir), `${date}-${slugify(title)}`);
}

function initialProcessing(now: string): LibraryProcessingState {
  return {
    state: "queued",
    stage: "metadata",
    completed_stages: [],
    started_at: now,
    updated_at: now,
    attempt: 0,
    next_retry_at: null,
    last_error: null,
  };
}

function placeholderBody(raw: RawArtifact, title: string, description: string): string {
  const cleanRaw = { ...raw, title, thumbnail: usableThumbnail(raw.thumbnail) };
  const media = buildMediaMarkdown(cleanRaw);
  return `# ${title}\n\n${media ? `${media}\n` : ""}${description}\n`;
}

function placeholderFrontmatter(raw: RawArtifact, source: LibrarySourceConfig, uid: string, processing: LibraryProcessingState): Record<string, unknown> {
  const taxonomy = artifactTaxonomy(raw, source);
  const series = seriesFromRaw(raw, source);
  const title = placeholderTitle(raw, source);
  const description = placeholderDescription(raw, source);
  const nowDate = dateOnly(processing.started_at);
  const isSaved = source.intent === "explicit_save";
  const frontmatter: Record<string, unknown> = {
    type: isSaved ? "reference" : "reference-candidate",
    artifact_uid: uid,
    source_title: raw.title,
    title,
    description,
    url: raw.url,
    format: typeof raw.metadata.format === "string" ? raw.metadata.format : source.channel === "youtube" ? "video" : source.channel === "twitter" ? "tweet" : "article",
    author: raw.author || undefined,
    published: raw.date ? dateOnly(raw.date) : undefined,
    captured: isSaved ? nowDate : undefined,
    captured_at: isSaved ? processing.started_at : undefined,
    digested: isSaved ? undefined : nowDate,
    channel: source.channel,
    source_id: source.id,
    source_name: source.name,
    intent: source.intent,
    thumbnail: usableThumbnail(raw.thumbnail),
    tags: taxonomy.semantic_tags,
    source_tags: taxonomy.source_tags.length ? taxonomy.source_tags : undefined,
    source_collection: taxonomy.source_collection || undefined,
    source_collection_id: taxonomy.source_collection_id || undefined,
    source_folder: taxonomy.source_folder || undefined,
    source_folder_id: taxonomy.source_folder_id || undefined,
    ...seriesFrontmatter(series),
    library_mode: taxonomy.library_mode,
    processing,
    status: isSaved ? undefined : "candidate",
    expires: isSaved ? undefined : dateOnly(new Date(Date.now() + source.retention.candidate_ttl_days * 86_400_000)),
    score: isSaved ? undefined : { relevance: 0, novelty: 0, confidence: 0, total: 0 },
    save_recommendation: isSaved ? undefined : "review",
    proposed_destination: typeof raw.metadata.proposed_destination === "string" ? raw.metadata.proposed_destination : undefined,
    connected_projects: isSaved ? undefined : [],
    promotion: isSaved ? undefined : { promoted_to: null, promoted_at: null, promoted_reason: null },
    relevance_signals: isSaved ? [{ type: source.signal || "explicit_save", channel: source.channel, at: nowDate }] : undefined,
  };
  for (const key of Object.keys(frontmatter)) {
    if (frontmatter[key] === undefined) delete frontmatter[key];
  }
  return frontmatter;
}

export function readProcessingQueueRecord(filePath: string): LibraryProcessingQueueRecord | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as LibraryProcessingQueueRecord;
    return parsed?.version === 1 && typeof parsed.artifact_uid === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export function listProcessingQueue(vaultPath: string, options: { includeBlocked?: boolean } = {}): LibraryProcessingQueueRecord[] {
  const dir = libraryProcessingDir(vaultPath);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => readProcessingQueueRecord(path.join(dir, name)))
    .filter((record): record is LibraryProcessingQueueRecord => Boolean(record))
    .filter((record) => options.includeBlocked || record.status !== "blocked")
    .sort((a, b) => a.queued_at.localeCompare(b.queued_at));
}

export function processingQueueRecordIsDue(record: LibraryProcessingQueueRecord, now = new Date()): boolean {
  if (record.status === "blocked") return false;
  if (record.status === "active") {
    const updated = Date.parse(record.updated_at);
    return !Number.isFinite(updated) || now.getTime() - updated >= PROCESSING_STALE_ACTIVE_MS;
  }
  if (!record.next_retry_at) return true;
  const retry = Date.parse(record.next_retry_at);
  return !Number.isFinite(retry) || retry <= now.getTime();
}

export function processingQueueHasDueWork(vaultPath: string, now = new Date()): boolean {
  return listProcessingQueue(vaultPath).some((record) => processingQueueRecordIsDue(record, now));
}

export function writeProcessingQueueRecord(record: LibraryProcessingQueueRecord): void {
  atomicWriteFile(libraryProcessingQueuePath(record.vault_path, record.artifact_uid), `${JSON.stringify(record, null, 2)}\n`);
}

export function removeProcessingQueueRecord(record: LibraryProcessingQueueRecord): void {
  try { fs.unlinkSync(libraryProcessingQueuePath(record.vault_path, record.artifact_uid)); } catch { /* already removed */ }
}

export interface EnqueueArtifactResult extends LibraryIntakeArtifactResult {
  queue_record?: LibraryProcessingQueueRecord;
}

export function enqueueLibraryArtifact(
  vaultPath: string,
  rawInput: RawArtifact,
  source: LibrarySourceConfig,
  options: { useSummarize?: boolean; reweaveTimeoutMs?: number } = {},
): EnqueueArtifactResult {
  const raw = { ...rawInput, thumbnail: usableThumbnail(rawInput.thumbnail), metadata: { ...rawInput.metadata } };
  const existingRef = findSavedReferenceByUrl(vaultPath, raw.url);
  if (existingRef) {
    return {
      artifact_uid: existingRef.id,
      url: raw.url,
      title: existingRef.title,
      lifecycle_status: "saved",
      path: existingRef.path,
      status: "duplicate",
      reason: "saved_reference_exists",
    };
  }
  const archived = findArchivedReferenceByUrl(vaultPath, raw.url);
  if (archived) {
    return {
      artifact_uid: archived.id,
      url: raw.url,
      title: archived.title,
      lifecycle_status: "saved",
      path: archived.path,
      status: "duplicate",
      reason: "archived_reference_exists",
    };
  }
  const existingCandidate = findCandidateByUrl(vaultPath, raw.url);
  if (existingCandidate) {
    return {
      artifact_uid: existingCandidate.id,
      url: raw.url,
      title: existingCandidate.title,
      lifecycle_status: "candidate",
      path: existingCandidate.path,
      status: "duplicate",
      reason: "candidate_exists",
    };
  }

  const uid = hashId(canonicalUrl(raw.url), 24);
  const processing = initialProcessing(isoNow());
  const filePath = targetPath(vaultPath, raw, source, uid);
  const frontmatter = placeholderFrontmatter(raw, source, uid, processing);
  const title = String(frontmatter.title);
  const description = String(frontmatter.description);
  atomicWriteFile(filePath, stringifyMarkdown(frontmatter, placeholderBody(raw, title, description)));
  const record: LibraryProcessingQueueRecord = {
    version: 1,
    artifact_uid: uid,
    vault_path: vaultPath,
    target_path: relativeVaultPath(vaultPath, filePath),
    lifecycle_status: source.intent === "explicit_save" ? "saved" : "candidate",
    source_title: raw.title,
    raw,
    source,
    queued_at: processing.started_at,
    updated_at: processing.updated_at,
    attempt: 0,
    status: "queued",
    next_retry_at: null,
    processing_options: {
      use_summarize: options.useSummarize,
      reweave_timeout_ms: options.reweaveTimeoutMs,
    },
  };
  writeProcessingQueueRecord(record);
  return {
    artifact_uid: uid,
    url: raw.url,
    title,
    lifecycle_status: record.lifecycle_status,
    path: record.target_path,
    status: "queued",
    reason: "processing_queued",
    queue_record: record,
  };
}

function processingForEvent(current: LibraryProcessingState, record: LibraryProcessingQueueRecord, event: DigestionProgressEvent): LibraryProcessingState {
  const completed = new Set(current.completed_stages);
  if (event.status === "completed") completed.add(event.stage);
  return {
    ...current,
    state: "active",
    stage: event.stage,
    completed_stages: Array.from(completed),
    updated_at: isoNow(),
    attempt: record.attempt,
    next_retry_at: null,
    last_error: null,
  };
}

export function updateProcessingCheckpoint(record: LibraryProcessingQueueRecord, event: DigestionProgressEvent): void {
  const filePath = path.join(record.vault_path, record.target_path);
  if (!fs.existsSync(filePath)) return;
  const parsed = parseMarkdownFile(filePath);
  const current = (parsed.data.processing as LibraryProcessingState | undefined) || initialProcessing(record.queued_at);
  const nextProcessing = processingForEvent(current, record, event);
  const nextRaw = { ...event.raw, thumbnail: usableThumbnail(event.raw.thumbnail) };
  const title = placeholderTitle(nextRaw, record.source);
  const description = event.description || event.summary || String(parsed.data.description || placeholderDescription(nextRaw, record.source));
  const nextData = {
    ...parsed.data,
    title,
    description: description.slice(0, 300),
    thumbnail: nextRaw.thumbnail || undefined,
    processing: nextProcessing,
  };
  for (const key of Object.keys(nextData)) {
    if (nextData[key as keyof typeof nextData] === undefined) delete nextData[key as keyof typeof nextData];
  }
  atomicWriteFile(filePath, stringifyMarkdown(nextData, placeholderBody(nextRaw, title, description)));
}

export function markProcessingBlocked(record: LibraryProcessingQueueRecord, error: { code: string; message: string; retryable: boolean }, nextRetryAt: string | null): void {
  const filePath = path.join(record.vault_path, record.target_path);
  if (!fs.existsSync(filePath)) return;
  const parsed = parseMarkdownFile(filePath);
  const current = (parsed.data.processing as LibraryProcessingState | undefined) || initialProcessing(record.queued_at);
  const terminal = !error.retryable || record.attempt >= PROCESSING_MAX_ATTEMPTS;
  const processing: LibraryProcessingState = {
    ...current,
    state: terminal ? "blocked" : "queued",
    updated_at: isoNow(),
    attempt: record.attempt,
    next_retry_at: terminal ? null : nextRetryAt,
    last_error: { ...error, retryable: error.retryable && !terminal },
  };
  atomicWriteFile(filePath, stringifyMarkdown({ ...parsed.data, processing }, parsed.body));
  writeProcessingQueueRecord({
    ...record,
    status: terminal ? "blocked" : "queued",
    next_retry_at: processing.next_retry_at,
    updated_at: processing.updated_at,
  });
}

export function retryProcessingArtifact(vaultPath: string, artifactUid: string): LibraryProcessingQueueRecord | null {
  const filePath = libraryProcessingQueuePath(vaultPath, artifactUid);
  const record = readProcessingQueueRecord(filePath);
  if (!record) return null;
  const updated = { ...record, status: "queued" as const, attempt: 0, next_retry_at: null, updated_at: isoNow() };
  writeProcessingQueueRecord(updated);
  const artifactPath = path.join(vaultPath, updated.target_path);
  if (fs.existsSync(artifactPath)) {
    const parsed = parseMarkdownFile(artifactPath);
    const current = (parsed.data.processing as LibraryProcessingState | undefined) || initialProcessing(updated.queued_at);
    atomicWriteFile(artifactPath, stringifyMarkdown({
      ...parsed.data,
      processing: {
        ...current,
        state: "queued",
        stage: "metadata",
        completed_stages: [],
        updated_at: updated.updated_at,
        attempt: 0,
        next_retry_at: null,
        last_error: null,
        completed_at: null,
      },
    }, parsed.body));
  }
  return updated;
}

export interface LibraryProcessingQueueStaleRecord {
  artifact_uid: string;
  path: string;
  queue_path: string;
  queue_status: LibraryProcessingQueueRecord["status"];
  reason: "artifact_ready";
}

export interface LibraryProcessingQueueReconciliation {
  dry_run: boolean;
  scanned: number;
  stale: number;
  removed: number;
  records: LibraryProcessingQueueStaleRecord[];
}

function readyArtifactForQueueRecord(vaultPath: string, record: LibraryProcessingQueueRecord): boolean {
  const vaultRoot = path.resolve(vaultPath);
  if (path.resolve(record.vault_path) !== vaultRoot) return false;
  const target = path.resolve(vaultRoot, record.target_path);
  if (target !== vaultRoot && !target.startsWith(`${vaultRoot}${path.sep}`)) return false;
  if (!fs.existsSync(target)) return false;
  try {
    const parsed = parseMarkdownFile(target);
    if (parsed.data.artifact_uid !== record.artifact_uid) return false;
    const processing = parsed.data.processing as LibraryProcessingState | undefined;
    return processing?.state === "ready";
  } catch {
    return false;
  }
}

/**
 * Finds queue records whose matching markdown artifact already reached the durable ready state.
 * These records are redundant operational residue, commonly left by an out-of-band repair path.
 * Read paths use the same classifier but never delete; callers must opt into `write` explicitly.
 */
export function reconcileProcessingQueue(
  vaultPath: string,
  options: {
    write?: boolean;
    /** Test/maintenance seam used to prove a record changed after the initial scan is preserved. */
    beforeRemove?: (record: LibraryProcessingQueueStaleRecord) => void;
  } = {},
): LibraryProcessingQueueReconciliation {
  const records = listProcessingQueue(vaultPath, { includeBlocked: true });
  const staleEntries = records
    .filter((record) => readyArtifactForQueueRecord(vaultPath, record))
    .map((record) => ({
      original: record,
      result: {
        artifact_uid: record.artifact_uid,
        path: record.target_path,
        queue_path: libraryProcessingQueuePath(vaultPath, record.artifact_uid),
        queue_status: record.status,
        reason: "artifact_ready" as const,
      },
    }));
  const stale = staleEntries.map((entry) => entry.result);

  let removed = 0;
  if (options.write) {
    for (const { original, result } of staleEntries) {
      options.beforeRemove?.(result);
      // The worker may have retried or rewritten this UID after our initial scan. Re-read the exact
      // path immediately before unlinking and require the queue identity, state, timestamp, and
      // matching ready Markdown to remain unchanged. A changed record is live work, not residue.
      const current = readProcessingQueueRecord(result.queue_path);
      if (!current) {
        removed += 1;
        continue;
      }
      if (current.artifact_uid !== original.artifact_uid
        || current.vault_path !== original.vault_path
        || current.target_path !== original.target_path
        || current.status !== original.status
        || current.updated_at !== original.updated_at
        || !readyArtifactForQueueRecord(vaultPath, current)) continue;
      try {
        fs.unlinkSync(result.queue_path);
        removed += 1;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          removed += 1;
          continue;
        }
        throw error;
      }
    }
  }

  return {
    dry_run: !options.write,
    scanned: records.length,
    stale: stale.length,
    removed,
    records: stale,
  };
}

export function processingQueueSummary(vaultPath: string): {
  queue_depth: number;
  active: number;
  blocked: number;
  stale_records: number;
  oldest_queued_at: string | null;
  active_item: { artifact_uid: string; title: string; path: string } | null;
} {
  const records = listProcessingQueue(vaultPath, { includeBlocked: true });
  const current = records.filter((record) => !readyArtifactForQueueRecord(vaultPath, record));
  const queued = current.filter((record) => record.status !== "blocked");
  const active = current.find((record) => record.status === "active") || null;
  return {
    queue_depth: queued.length,
    active: current.filter((record) => record.status === "active").length,
    blocked: current.filter((record) => record.status === "blocked").length,
    stale_records: records.length - current.length,
    oldest_queued_at: queued[0]?.queued_at || null,
    active_item: active ? {
      artifact_uid: active.artifact_uid,
      title: active.source_title || active.raw.title,
      path: active.target_path,
    } : null,
  };
}

export function processingArtifactFromFile(vaultPath: string, filePath: string): Pick<LibraryArtifact, "id" | "path" | "title" | "processing"> | null {
  try {
    const parsed = parseMarkdownFile(filePath);
    const uid = typeof parsed.data.artifact_uid === "string" ? parsed.data.artifact_uid : hashId(relativeVaultPath(vaultPath, filePath));
    return {
      id: uid,
      path: relativeVaultPath(vaultPath, filePath),
      title: String(parsed.data.title || path.basename(filePath, ".md")),
      processing: parsed.data.processing as LibraryProcessingState | undefined,
    };
  } catch {
    return null;
  }
}
