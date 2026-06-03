import fs from "fs";
import path from "path";
import { atomicWriteFile, ensureDir, hashId, isoNow } from "./utils";

export type ReviewQueueStatus = "pending" | "approved" | "rejected";

export interface ReviewQueueEntry {
  path: string;
  pipeline_version: string;
  batch: string;
  status: ReviewQueueStatus;
  note?: string;
  added_at: string;
  reviewed_at?: string;
}

/**
 * A generation note authored per review batch (docs/review-notes/<version>.md), carried into the
 * manifest at batch-creation so the app can render it atop the Updated lane without serving repo
 * files. `version` is the pipeline version that produced the batch; `title` is the human name of the
 * generation; `markdown` is the brief "what to review / why" body.
 */
export interface ReviewBatchNote {
  version: string;
  title: string;
  markdown: string;
  created_at: string;
}

export type ReviewBatchNoteInput = Pick<ReviewBatchNote, "version" | "title" | "markdown">;

/** A batch note surfaced to the UI, annotated with its label and pending count. */
export interface ActiveBatchNote extends ReviewBatchNote {
  batch: string;
  pending_count: number;
}

export interface LibraryReviewQueue {
  version: 1;
  items: Record<string, ReviewQueueEntry>;
  batches: Record<string, ReviewBatchNote>;
}

/**
 * The review queue is vault-keyed and NOT Library-specific in its data model, so a sibling
 * store (`kind`) lets a second subsystem reuse it without colliding (ruling R10 / spec
 * "Versioning, Scheduling & Model Upgrades"). `library` → `library-review-queue`,
 * `semantic` → `semantic-review-queue`. The public functions default to `library` so every
 * existing caller is unchanged; the Phase-2 semantic backfill passes `semantic`.
 */
export type ReviewQueueKind = "library" | "semantic";

function reviewQueueDir(kind: ReviewQueueKind = "library"): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), `${kind}-review-queue`);
}

/** The semantic layer's sibling review-queue store dir (DATA_DIR/semantic-review-queue). */
export function semanticReviewQueueDir(): string {
  return reviewQueueDir("semantic");
}

function libraryReviewQueuePath(vaultPath: string, kind: ReviewQueueKind = "library"): string {
  const vaultKey = hashId(path.resolve(vaultPath), 16);
  return path.join(reviewQueueDir(kind), `${vaultKey}.json`);
}

function isReviewStatus(value: unknown): value is ReviewQueueStatus {
  return value === "pending" || value === "approved" || value === "rejected";
}

function normalizeEntry(value: unknown): ReviewQueueEntry | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ReviewQueueEntry>;
  const entryPath = typeof record.path === "string" ? record.path : null;
  const pipelineVersion = typeof record.pipeline_version === "string" ? record.pipeline_version : null;
  const batch = typeof record.batch === "string" ? record.batch : null;
  const addedAt = typeof record.added_at === "string" ? record.added_at : null;
  const status = isReviewStatus(record.status) ? record.status : "pending";
  if (!entryPath || !pipelineVersion || !batch || !addedAt) return null;
  const entry: ReviewQueueEntry = {
    path: entryPath,
    pipeline_version: pipelineVersion,
    batch,
    status,
    added_at: addedAt,
  };
  if (typeof record.note === "string") entry.note = record.note;
  if (typeof record.reviewed_at === "string") entry.reviewed_at = record.reviewed_at;
  return entry;
}

function normalizeBatchNote(value: unknown): ReviewBatchNote | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<ReviewBatchNote>;
  const version = typeof record.version === "string" ? record.version : null;
  const title = typeof record.title === "string" ? record.title : null;
  const markdown = typeof record.markdown === "string" ? record.markdown : null;
  const createdAt = typeof record.created_at === "string" ? record.created_at : null;
  if (!version || !title || !markdown || !createdAt) return null;
  return { version, title, markdown, created_at: createdAt };
}

function normalizeReviewQueue(value: unknown): LibraryReviewQueue | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<LibraryReviewQueue>;
  const items: Record<string, ReviewQueueEntry> = {};
  if (record.items && typeof record.items === "object") {
    for (const [id, raw] of Object.entries(record.items)) {
      const entry = normalizeEntry(raw);
      if (entry) items[id] = entry;
    }
  }
  const batches: Record<string, ReviewBatchNote> = {};
  if (record.batches && typeof record.batches === "object") {
    for (const [label, raw] of Object.entries(record.batches)) {
      const note = normalizeBatchNote(raw);
      if (note) batches[label] = note;
    }
  }
  return {
    version: 1,
    items,
    batches,
  };
}

function writeLibraryReviewQueue(vaultPath: string, queue: LibraryReviewQueue, kind: ReviewQueueKind = "library"): void {
  const target = libraryReviewQueuePath(vaultPath, kind);
  ensureDir(path.dirname(target));
  atomicWriteFile(target, `${JSON.stringify(queue, null, 2)}\n`);
}

export function readReviewQueue(vaultPath: string, kind: ReviewQueueKind = "library"): LibraryReviewQueue {
  const target = libraryReviewQueuePath(vaultPath, kind);
  if (fs.existsSync(target)) {
    try {
      const parsed = normalizeReviewQueue(JSON.parse(fs.readFileSync(target, "utf-8")));
      if (parsed) return parsed;
    } catch {
      // Fall through to a fresh baseline if the local queue state is corrupt.
    }
  }
  return {
    version: 1,
    items: {},
    batches: {},
  };
}

export function addToReviewQueue(
  vaultPath: string,
  entries: Array<{ id: string; path: string; pipeline_version: string }>,
  opts: { batch: string; note?: ReviewBatchNoteInput; kind?: ReviewQueueKind },
): { added: number } {
  const cleaned = entries
    .map((entry) => ({
      id: entry.id.trim(),
      path: entry.path,
      pipeline_version: entry.pipeline_version,
    }))
    .filter((entry) => entry.id);
  if (!cleaned.length) return { added: 0 };

  const kind = opts.kind ?? "library";
  const queue = readReviewQueue(vaultPath, kind);
  const addedAt = isoNow();
  for (const entry of cleaned) {
    // Re-adding a regenerated item resets it to pending with a fresh added_at,
    // batch, and pipeline version (no status preservation).
    queue.items[entry.id] = {
      path: entry.path,
      pipeline_version: entry.pipeline_version,
      batch: opts.batch,
      status: "pending",
      added_at: addedAt,
    };
  }
  // Attach (or refresh) the generation note for this batch so the app can render it atop the lane.
  if (opts.note) {
    queue.batches[opts.batch] = { ...opts.note, created_at: addedAt };
  }
  writeLibraryReviewQueue(vaultPath, queue, kind);
  return { added: cleaned.length };
}

export function setReviewStatus(
  vaultPath: string,
  id: string,
  status: ReviewQueueStatus,
  note?: string,
  kind: ReviewQueueKind = "library",
): ReviewQueueEntry | null {
  const key = id.trim();
  if (!key) return null;

  const queue = readReviewQueue(vaultPath, kind);
  const existing = queue.items[key];
  if (!existing) return null;

  const updated: ReviewQueueEntry = {
    ...existing,
    status,
    reviewed_at: isoNow(),
  };
  if (typeof note === "string") updated.note = note;
  queue.items[key] = updated;
  writeLibraryReviewQueue(vaultPath, queue, kind);
  return updated;
}

export function listPendingReview(vaultPath: string, kind: ReviewQueueKind = "library"): ReviewQueueEntry[] {
  const queue = readReviewQueue(vaultPath, kind);
  return Object.values(queue.items).filter((entry) => entry.status === "pending");
}

/**
 * The generation notes worth showing right now: one per batch that still has pending items, each
 * annotated with how many of its items are awaiting review, newest first. Batches whose items are
 * all reviewed (or that never carried a note) are omitted.
 */
export function getActiveBatchNotes(vaultPath: string, kind: ReviewQueueKind = "library"): ActiveBatchNote[] {
  const queue = readReviewQueue(vaultPath, kind);
  const pendingByBatch = new Map<string, number>();
  for (const entry of Object.values(queue.items)) {
    if (entry.status !== "pending") continue;
    pendingByBatch.set(entry.batch, (pendingByBatch.get(entry.batch) || 0) + 1);
  }
  const notes: ActiveBatchNote[] = [];
  for (const [batch, count] of pendingByBatch) {
    const note = queue.batches[batch];
    if (!note) continue;
    notes.push({ ...note, batch, pending_count: count });
  }
  notes.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return notes;
}

export function removeFromReviewQueue(vaultPath: string, id: string, kind: ReviewQueueKind = "library"): boolean {
  const key = id.trim();
  if (!key) return false;

  const queue = readReviewQueue(vaultPath, kind);
  if (!(key in queue.items)) return false;
  delete queue.items[key];
  writeLibraryReviewQueue(vaultPath, queue, kind);
  return true;
}
