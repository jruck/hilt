/**
 * Library eval feedback — THREAD-BACKED (v3 unit C2). These functions keep their original
 * signatures (steering, workbench, metrics, and the /api/library feedback routes call them
 * unchanged) but adapt over the thread store: one thread per conversation against
 * `{ kind: "library", id: <artifactId> }` under DATA_DIR/threads/. The old
 * `DATA_DIR/library-feedback/<vaultKey>.json` files are migration history
 * (scripts/threads-migrate.ts); nothing reads or writes them anymore.
 *
 * Shape contract preserved: every function still speaks LibraryComment —
 * message.id = comment.id, message.edited_at = updated_at, thread.processed.at = processed_at.
 * `vaultPath` stays in the signatures (the thread store is global app state, keyed by artifact
 * id, so it is unused — comments were never vault content).
 */
import crypto from "crypto";
import type { LibraryComment } from "./types";
import { isoNow } from "./utils";
import {
  appendToThread,
  createThread,
  deleteMessage,
  editMessage,
  listThreads,
  markProcessed,
  openThreadForTarget,
  saveThread,
  threadsForTarget,
} from "../threads/store";
import type { CommentTarget, Thread, ThreadMessage } from "../threads/types";

function libraryTarget(id: string): CommentTarget {
  return { kind: "library", id };
}

function toComment(thread: Thread, message: ThreadMessage): LibraryComment {
  return {
    id: message.id,
    text: message.text,
    created_at: message.created_at,
    ...(message.edited_at ? { updated_at: message.edited_at } : {}),
    ...(thread.processed ? { processed_at: thread.processed.at } : {}),
  };
}

function commentsForTarget(id: string): Array<{ thread: Thread; message: ThreadMessage }> {
  const entries: Array<{ thread: Thread; message: ThreadMessage }> = [];
  for (const thread of threadsForTarget(libraryTarget(id))) {
    for (const message of thread.messages) {
      entries.push({ thread, message });
    }
  }
  return entries.sort((a, b) => a.message.created_at.localeCompare(b.message.created_at));
}

export function getStoredComments(vaultPath: string, id: string): LibraryComment[] {
  void vaultPath;
  return commentsForTarget(id).map(({ thread, message }) => toComment(thread, message));
}

export function addStoredComment(vaultPath: string, id: string, text: string): LibraryComment {
  void vaultPath;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  const target = libraryTarget(id);
  const open = openThreadForTarget(target);
  const thread = open
    ? appendToThread(open.id, { author: "justin", text: trimmed })
    : createThread(target, { author: "justin", text: trimmed });
  return toComment(thread, thread.messages[thread.messages.length - 1]);
}

export function editStoredComment(vaultPath: string, id: string, commentId: string, text: string): LibraryComment {
  void vaultPath;
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  const entry = commentsForTarget(id).find(({ message }) => message.id === commentId);
  if (!entry) throw new Error("Comment not found");
  const updated = editMessage(entry.thread.id, commentId, trimmed);
  const message = updated.messages.find((m) => m.id === commentId);
  if (!message) throw new Error("Comment not found");
  return toComment(updated, message);
}

export function deleteStoredComment(vaultPath: string, id: string, commentId: string): { ok: true } {
  void vaultPath;
  const entry = commentsForTarget(id).find(({ message }) => message.id === commentId);
  if (entry) deleteMessage(entry.thread.id, commentId);
  return { ok: true };
}

/** Mark comments processed. Omit commentIds for a ref to mark all of that item's comments.
 *  Thread-granular: stamping any listed comment stamps its whole thread. */
export function markStoredCommentsProcessed(vaultPath: string, refs: Array<{ id: string; commentIds?: string[] }>): { processed: number } {
  void vaultPath;
  let processed = 0;
  const now = isoNow();
  for (const ref of refs) {
    for (const thread of threadsForTarget(libraryTarget(ref.id))) {
      if (thread.processed) continue;
      const matched = ref.commentIds
        ? thread.messages.filter((message) => ref.commentIds!.includes(message.id))
        : thread.messages;
      if (matched.length === 0) continue;
      markProcessed(thread.id, { at: now, run_at: now });
      processed += matched.length;
    }
  }
  return { processed };
}

export function listStoredFeedback(vaultPath: string): Array<{ id: string; comments: LibraryComment[] }> {
  void vaultPath;
  const byId = new Map<string, LibraryComment[]>();
  for (const thread of listLibraryThreads()) {
    const comments = byId.get(thread.target.id) || [];
    for (const message of thread.messages) {
      comments.push(toComment(thread, message));
    }
    byId.set(thread.target.id, comments);
  }
  return Array.from(byId.entries()).map(([id, comments]) => ({
    id,
    comments: comments.sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

function listLibraryThreads(): Array<Thread & { target: { kind: "library"; id: string } }> {
  return listThreads().filter(
    (thread): thread is Thread & { target: { kind: "library"; id: string } } => thread.target.kind === "library",
  );
}

/** Seed comments for an id without overwriting existing ones (used by the frontmatter→store migration). */
export function seedStoredComments(vaultPath: string, id: string, comments: LibraryComment[]): void {
  void vaultPath;
  if (!comments.length) return;
  if (threadsForTarget(libraryTarget(id)).length > 0) return;
  for (const comment of comments) {
    const processed = comment.processed_at
      ? { at: comment.processed_at, run_at: comment.processed_at }
      : undefined;
    saveThread({
      id: crypto.randomUUID(),
      target: libraryTarget(id),
      status: processed ? "resolved" : "open",
      created_at: comment.created_at,
      updated_at: comment.processed_at || comment.updated_at || comment.created_at,
      messages: [{
        id: comment.id,
        author: "justin",
        text: comment.text,
        created_at: comment.created_at,
        ...(comment.updated_at ? { edited_at: comment.updated_at } : {}),
      }],
      ...(processed ? { processed } : {}),
      source_ref: comment.id,
    });
  }
}
