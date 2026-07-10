/**
 * Pure merge logic for the top-level Chats view — ONE list of conversations.
 *
 * A conversation is one concept with two shapes: a feedback THREAD anchored to a system
 * object (comments + agent replies + processor transcripts) or a FREE-STANDING chat session
 * (started from a library item, a doc, or the API). The de-dupe invariant: a chat session
 * whose id appears in ANY thread's `chat_ids` is part of that thread's conversation and must
 * NOT also appear as a free row — it renders inside the thread's drawer instead.
 */
import type { ChatContextKind, ChatSessionSummary } from "@/lib/chat/types";
import type { CommentTarget } from "@/lib/comments/types";
import type { ThreadSummary } from "@/lib/threads/types";

export type ChatsLens = "needs-you" | "all" | "done";

export type ConversationKindFilter = "all" | ChatContextKind;

export type ConversationRow =
  | { type: "thread"; thread: ThreadSummary; updatedAtMs: number }
  | { type: "chat"; session: ChatSessionSummary; updatedAtMs: number };

/** Every chat id claimed by a thread — these sessions are thread evidence, not free rows. */
export function threadAttachedChatIds(threads: ThreadSummary[]): Set<string> {
  const attached = new Set<string>();
  for (const thread of threads) {
    for (const chatId of thread.chat_ids ?? []) attached.add(chatId);
  }
  return attached;
}

/** Needs-you: an open thread is always awaiting Justin — dev items stay open by design. */
export function threadNeedsYou(thread: Pick<ThreadSummary, "status">): boolean {
  return thread.status === "open";
}

export function threadDone(thread: Pick<ThreadSummary, "status">): boolean {
  return thread.status === "resolved";
}

/** Needs-you: unread replies or a turn in flight — archived-with-attention included (Loft semantics). */
export function chatNeedsYou(session: Pick<ChatSessionSummary, "status" | "unreadCount">): boolean {
  return session.status === "sending" || session.unreadCount > 0;
}

export function chatDone(session: Pick<ChatSessionSummary, "archivedAt">): boolean {
  return session.archivedAt != null;
}

/** Threads join the chat kind-filter space through their target kind. */
export function threadFilterKind(target: CommentTarget): ChatContextKind {
  switch (target.kind) {
    case "task":
      return "task";
    case "loop-item":
      return "loop-item";
    case "briefing":
    case "briefing-section":
    case "briefing-anchor":
      return "briefing-line";
    case "library":
      return "library";
    case "meeting":
      return "meeting";
  }
}

function parseTimeMs(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

function threadInLens(thread: ThreadSummary, lens: ChatsLens): boolean {
  if (lens === "needs-you") return threadNeedsYou(thread);
  if (lens === "done") return threadDone(thread);
  return true;
}

function chatInLens(session: ChatSessionSummary, lens: ChatsLens): boolean {
  if (lens === "needs-you") return chatNeedsYou(session);
  if (lens === "done") return chatDone(session);
  return true;
}

/**
 * The merged list: threads + free chats (attached chats de-duped out), lens-partitioned,
 * kind-filtered, sorted by recency desc across both types.
 */
export function mergeConversations(
  threads: ThreadSummary[],
  sessions: ChatSessionSummary[],
  lens: ChatsLens,
  kind: ConversationKindFilter = "all",
): ConversationRow[] {
  const attached = threadAttachedChatIds(threads);
  const rows: ConversationRow[] = [];

  for (const thread of threads) {
    if (!threadInLens(thread, lens)) continue;
    if (kind !== "all" && threadFilterKind(thread.target) !== kind) continue;
    rows.push({ type: "thread", thread, updatedAtMs: parseTimeMs(thread.updated_at) });
  }

  for (const session of sessions) {
    if (attached.has(session.id)) continue;
    if (!chatInLens(session, lens)) continue;
    if (kind !== "all" && session.context.kind !== kind) continue;
    rows.push({ type: "chat", session, updatedAtMs: session.updatedAt });
  }

  rows.sort((a, b) => b.updatedAtMs - a.updatedAtMs);
  return rows;
}

/** Default lens: Needs you when it has rows, otherwise All. */
export function defaultLens(threads: ThreadSummary[], sessions: ChatSessionSummary[]): ChatsLens {
  return mergeConversations(threads, sessions, "needs-you").length > 0 ? "needs-you" : "all";
}

/** Kind tab counts within the active lens (before the kind filter narrows the list). */
export function conversationKindCounts(rows: ConversationRow[]): Map<ChatContextKind, number> {
  const counts = new Map<ChatContextKind, number>();
  for (const row of rows) {
    const kind = row.type === "thread" ? threadFilterKind(row.thread.target) : row.session.context.kind;
    counts.set(kind, (counts.get(kind) ?? 0) + 1);
  }
  return counts;
}
