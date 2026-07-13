/**
 * Library eval feedback — THREAD-BACKED (v3 unit C2). These functions keep their original
 * signatures (steering, workbench, metrics, and the /api/library feedback routes call them
 * unchanged) but adapt over the thread store: one thread per conversation against
 * `{ kind: "library", id: <artifactId> }` under DATA_DIR/threads/. The old
 * `DATA_DIR/library-feedback/<vaultKey>.json` files are migration history
 * (scripts/threads-migrate.ts); nothing reads or writes them anymore.
 *
 * Shape contract preserved: every function still speaks LibraryComment —
 * message.id = comment.id, message.edited_at = updated_at, and message.handled_at maps to
 * processed_at (with thread.processed as a legacy fallback).
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
  markMessagesHandled,
  openThreadForTarget,
  recordThreadOutcome,
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
    ...(message.handled_at
      ? { processed_at: message.handled_at }
      : thread.processed
        ? { processed_at: thread.processed.at }
        : {}),
  };
}

function isFeedbackMessage(message: ThreadMessage): boolean {
  // Without this filter, the agent's own "Clustered into..." reply reads back as new unprocessed feedback and steering re-clusters its own note.
  return message.author === "justin" || message.author === "claude-sim";
}

function commentsForTarget(id: string): Array<{ thread: Thread; message: ThreadMessage }> {
  const entries: Array<{ thread: Thread; message: ThreadMessage }> = [];
  for (const thread of threadsForTarget(libraryTarget(id))) {
    for (const message of thread.messages) {
      if (!isFeedbackMessage(message)) continue;
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

/** Mark only the selected comments handled. Omit commentIds to consume all pending comments. */
export function markStoredCommentsProcessed(vaultPath: string, refs: Array<{ id: string; commentIds?: string[] }>): { processed: number } {
  void vaultPath;
  let processed = 0;
  const now = isoNow();
  for (const ref of refs) {
    for (const thread of threadsForTarget(libraryTarget(ref.id))) {
      const matched = ref.commentIds
        ? thread.messages.filter((message) => isFeedbackMessage(message) && !message.handled_at && ref.commentIds!.includes(message.id))
        : thread.messages.filter((message) => isFeedbackMessage(message) && !message.handled_at);
      if (matched.length === 0) continue;
      markMessagesHandled(thread.id, matched.map((message) => message.id), { at: now, by: "agent:library" });
      processed += matched.length;
    }
  }
  return { processed };
}

/**
 * Record the steering loop's consumption receipt for selected comments without closing the
 * reusable conversation. The same per-message handled stamp prevents later double-clustering.
 */
export function recordClusteredFeedback(
  vaultPath: string,
  refs: Array<{ id: string; commentIds: string[] }>,
  reportDate: string,
): { replied: number } {
  void vaultPath;
  let replied = 0;
  for (const ref of refs) {
    const commentIds = new Set(ref.commentIds);
    for (const thread of threadsForTarget(libraryTarget(ref.id))) {
      if (thread.status === "resolved") continue;
      const pendingIds = thread.messages
        .filter((message) => isFeedbackMessage(message) && !message.handled_at && commentIds.has(message.id))
        .map((message) => message.id);
      if (pendingIds.length === 0) continue;
      const at = isoNow();
      const outcome = recordThreadOutcome(thread.id, {
        kind: "clustered",
        summary: `Clustered into the steering report ${reportDate}.`,
        at,
        by: "agent:library",
        message_ids: pendingIds,
      });
      markMessagesHandled(thread.id, pendingIds, { at, by: "agent:library", outcome_id: outcome.id });
      appendToThread(thread.id, {
        author: "agent:library",
        text: `Clustered into the steering report ${reportDate}.`,
        created_at: at,
      });
      replied += 1;
    }
  }
  return { replied };
}

export function listStoredFeedback(vaultPath: string): Array<{ id: string; comments: LibraryComment[] }> {
  void vaultPath;
  const byId = new Map<string, LibraryComment[]>();
  for (const thread of listLibraryThreads()) {
    const comments = byId.get(thread.target.id) || [];
    for (const message of thread.messages) {
      if (!isFeedbackMessage(message)) continue;
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
