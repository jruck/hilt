import fs from "fs";
import path from "path";
import type { LibraryComment } from "./types";
import { atomicWriteFile, ensureDir, hashId, isoNow } from "./utils";

/**
 * Library eval feedback — stored in Hilt's own DATA_DIR (NOT the vault markdown), keyed by artifact id,
 * exactly like read-state and the review queue. Feedback is commentary directed at Hilt's eval engine,
 * not content about the article, so it must not travel with the source for other agents crawling the
 * vault. One JSON file per vault: `DATA_DIR/library-feedback/<vaultKey>.json` → `{ [id]: LibraryComment[] }`.
 */
type FeedbackStore = Record<string, LibraryComment[]>;

function feedbackDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-feedback");
}

function feedbackPath(vaultPath: string): string {
  return path.join(feedbackDir(), `${hashId(path.resolve(vaultPath), 16)}.json`);
}

function readStore(vaultPath: string): FeedbackStore {
  try {
    const parsed = JSON.parse(fs.readFileSync(feedbackPath(vaultPath), "utf-8"));
    return parsed && typeof parsed === "object" ? (parsed as FeedbackStore) : {};
  } catch {
    return {};
  }
}

function writeStore(vaultPath: string, store: FeedbackStore): void {
  ensureDir(feedbackDir());
  atomicWriteFile(feedbackPath(vaultPath), JSON.stringify(store, null, 2));
}

function newCommentId(): string {
  return `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
}

export function getStoredComments(vaultPath: string, id: string): LibraryComment[] {
  return readStore(vaultPath)[id] || [];
}

export function addStoredComment(vaultPath: string, id: string, text: string): LibraryComment {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  const store = readStore(vaultPath);
  const comment: LibraryComment = { id: newCommentId(), text: trimmed, created_at: isoNow() };
  store[id] = [...(store[id] || []), comment];
  writeStore(vaultPath, store);
  return comment;
}

export function editStoredComment(vaultPath: string, id: string, commentId: string, text: string): LibraryComment {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  const store = readStore(vaultPath);
  const comment = (store[id] || []).find((entry) => entry.id === commentId);
  if (!comment) throw new Error("Comment not found");
  comment.text = trimmed;
  comment.updated_at = isoNow();
  writeStore(vaultPath, store);
  return comment;
}

export function deleteStoredComment(vaultPath: string, id: string, commentId: string): { ok: true } {
  const store = readStore(vaultPath);
  if (store[id]) {
    store[id] = store[id].filter((entry) => entry.id !== commentId);
    if (!store[id].length) delete store[id];
    writeStore(vaultPath, store);
  }
  return { ok: true };
}

/** Mark comments processed. Omit commentIds for a ref to mark all of that item's comments. */
export function markStoredCommentsProcessed(vaultPath: string, refs: Array<{ id: string; commentIds?: string[] }>): { processed: number } {
  const store = readStore(vaultPath);
  let processed = 0;
  let changed = false;
  const now = isoNow();
  for (const ref of refs) {
    for (const comment of store[ref.id] || []) {
      if (comment.processed_at) continue;
      if (!ref.commentIds || ref.commentIds.includes(comment.id)) {
        comment.processed_at = now;
        processed += 1;
        changed = true;
      }
    }
  }
  if (changed) writeStore(vaultPath, store);
  return { processed };
}

export function listStoredFeedback(vaultPath: string): Array<{ id: string; comments: LibraryComment[] }> {
  const store = readStore(vaultPath);
  return Object.entries(store).map(([id, comments]) => ({ id, comments }));
}

/** Seed comments for an id without overwriting existing ones (used by the frontmatter→store migration). */
export function seedStoredComments(vaultPath: string, id: string, comments: LibraryComment[]): void {
  if (!comments.length) return;
  const store = readStore(vaultPath);
  if (store[id] && store[id].length) return;
  store[id] = comments;
  writeStore(vaultPath, store);
}
