import { describe, expect, it } from "vitest";
import type { ChatSessionSummary } from "@/lib/chat/types";
import type { ThreadSummary } from "@/lib/threads/types";
import {
  conversationKindCounts,
  defaultLens,
  conversationRowId,
  mergeConversations,
  threadAttachedChatIds,
  threadFilterKind,
} from "./conversations";

function makeThread(overrides: Partial<ThreadSummary> = {}): ThreadSummary {
  return {
    id: "th-1",
    target: { kind: "task", id: "t-1" },
    status: "open",
    created_at: "2026-07-09T10:00:00.000Z",
    updated_at: "2026-07-09T10:00:00.000Z",
    message_count: 1,
    last_message_snippet: "snippet",
    ...overrides,
  };
}

function makeSession(overrides: Partial<ChatSessionSummary> = {}): ChatSessionSummary {
  return {
    id: "chat-1",
    context: { kind: "library", id: "lib-1" },
    contextLabel: "A reference",
    title: "A chat",
    status: "idle",
    archivedAt: null,
    unreadCount: 0,
    createdAt: 1_000,
    updatedAt: 2_000,
    messageCount: 2,
    lastMessageSnippet: "hi",
    ...overrides,
  };
}

describe("thread-attached chat de-dupe", () => {
  it("excludes a chat whose id appears in any thread's chat_ids from free rows", () => {
    const threads = [
      makeThread({ id: "th-1", chat_ids: ["chat-attached"] }),
      makeThread({ id: "th-2", status: "resolved", resolution: { action: "closed", at: "2026-07-09T10:00:00.000Z", by: "justin" } }),
    ];
    const sessions = [
      makeSession({ id: "chat-attached" }),
      makeSession({ id: "chat-free" }),
    ];
    const rows = mergeConversations(threads, sessions, "all");
    const chatIds = rows.filter((row) => row.type === "chat").map((row) => row.session.id);
    expect(chatIds).toEqual(["chat-free"]);
    // The thread that owns the chat still appears — the conversation is not lost.
    expect(rows.filter((row) => row.type === "thread").map((row) => row.thread.id).sort()).toEqual(["th-1", "th-2"]);
  });

  it("de-dupes even when the attached chat would match the lens on its own", () => {
    const threads = [makeThread({ id: "th-1", chat_ids: ["chat-attached"] })];
    const sessions = [makeSession({ id: "chat-attached", status: "sending" })];
    const rows = mergeConversations(threads, sessions, "needs-you");
    expect(rows.filter((row) => row.type === "chat")).toHaveLength(0);
    expect(rows.filter((row) => row.type === "thread")).toHaveLength(1);
  });

  it("collects attached ids across all threads", () => {
    const threads = [
      makeThread({ id: "th-1", chat_ids: ["a", "b"] }),
      makeThread({ id: "th-2", chat_ids: ["c"] }),
      makeThread({ id: "th-3" }),
    ];
    expect([...threadAttachedChatIds(threads)].sort()).toEqual(["a", "b", "c"]);
  });
});

describe("needs-you partition", () => {
  it("includes open threads (dev items included), unread chats, and sending chats", () => {
    const threads = [
      makeThread({ id: "th-open" }),
      makeThread({ id: "th-dev", dev_item: { diagnosed_at: "2026-07-09T10:00:00.000Z" } }),
      makeThread({ id: "th-resolved", status: "resolved" }),
    ];
    const sessions = [
      makeSession({ id: "chat-unread", unreadCount: 2 }),
      makeSession({ id: "chat-sending", status: "sending" }),
      makeSession({ id: "chat-read-idle" }),
      makeSession({ id: "chat-archived-unread", archivedAt: 5_000, unreadCount: 1 }),
    ];
    const rows = mergeConversations(threads, sessions, "needs-you");
    const ids = rows.map((row) => (row.type === "thread" ? row.thread.id : row.session.id)).sort();
    expect(ids).toEqual(["chat-archived-unread", "chat-sending", "chat-unread", "th-dev", "th-open"]);
  });
});

describe("done partition", () => {
  it("includes resolved threads and archived chats only", () => {
    const threads = [
      makeThread({ id: "th-open" }),
      makeThread({ id: "th-resolved", status: "resolved" }),
    ];
    const sessions = [
      makeSession({ id: "chat-open" }),
      makeSession({ id: "chat-archived", archivedAt: 5_000 }),
    ];
    const rows = mergeConversations(threads, sessions, "done");
    const ids = rows.map((row) => (row.type === "thread" ? row.thread.id : row.session.id)).sort();
    expect(ids).toEqual(["chat-archived", "th-resolved"]);
  });
});

describe("merged ordering and filters", () => {
  it("sorts threads and chats together by recency desc", () => {
    const threads = [makeThread({ id: "th-mid", updated_at: "2026-07-09T10:00:00.000Z" })];
    const sessions = [
      makeSession({ id: "chat-newest", updatedAt: Date.parse("2026-07-09T12:00:00.000Z") }),
      makeSession({ id: "chat-oldest", updatedAt: Date.parse("2026-07-09T08:00:00.000Z") }),
    ];
    const rows = mergeConversations(threads, sessions, "all");
    const ids = rows.map((row) => (row.type === "thread" ? row.thread.id : row.session.id));
    expect(ids).toEqual(["chat-newest", "th-mid", "chat-oldest"]);
  });

  it("applies the kind filter across both row types via the thread target mapping", () => {
    const threads = [
      makeThread({ id: "th-task", target: { kind: "task", id: "t-1" } }),
      makeThread({ id: "th-briefing", target: { kind: "briefing", date: "2026-07-09" } }),
    ];
    const sessions = [
      makeSession({ id: "chat-lib" }),
      makeSession({ id: "chat-task", context: { kind: "task", id: "t-2" } }),
    ];
    const taskRows = mergeConversations(threads, sessions, "all", "task");
    expect(taskRows.map((row) => (row.type === "thread" ? row.thread.id : row.session.id)).sort()).toEqual(["chat-task", "th-task"]);
    const briefingRows = mergeConversations(threads, sessions, "all", "briefing-line");
    expect(briefingRows.map((row) => (row.type === "thread" ? row.thread.id : row.session.id))).toEqual(["th-briefing"]);
  });

  it("maps every thread target kind into the chat kind space", () => {
    expect(threadFilterKind({ kind: "task", id: "t" })).toBe("task");
    expect(threadFilterKind({ kind: "loop-item", loop: "goals", itemId: "i" })).toBe("loop-item");
    expect(threadFilterKind({ kind: "briefing", date: "2026-07-09" })).toBe("briefing-line");
    expect(threadFilterKind({ kind: "briefing-section", date: "2026-07-09", section: "s" })).toBe("briefing-line");
    expect(threadFilterKind({ kind: "briefing-anchor", anchor: { text: "x" } })).toBe("briefing-line");
    expect(threadFilterKind({ kind: "library", id: "l" })).toBe("library");
    expect(threadFilterKind({ kind: "meeting", rel: "meetings/m.md" })).toBe("meeting");
  });

  it("counts kinds within a lens for the filter tabs", () => {
    const rows = mergeConversations(
      [makeThread({ id: "th-task" })],
      [makeSession({ id: "chat-lib" }), makeSession({ id: "chat-lib-2", updatedAt: 3_000 })],
      "all",
    );
    const counts = conversationKindCounts(rows);
    expect(counts.get("task")).toBe(1);
    expect(counts.get("library")).toBe(2);
  });
});

describe("default lens", () => {
  it("defaults to needs-you when it is non-empty", () => {
    expect(defaultLens([makeThread()], [])).toBe("needs-you");
    expect(defaultLens([], [makeSession({ unreadCount: 1 })])).toBe("needs-you");
  });

  it("falls back to all when nothing needs attention", () => {
    expect(defaultLens([makeThread({ status: "resolved" })], [makeSession()])).toBe("all");
    expect(defaultLens([], [])).toBe("all");
  });

  it("ignores thread-attached sending chats already represented by their open thread", () => {
    // The attached chat is de-duped; the OPEN thread itself carries the needs-you signal.
    const threads = [makeThread({ id: "th-1", status: "resolved", chat_ids: ["chat-a"] })];
    const sessions = [makeSession({ id: "chat-a", status: "sending" })];
    expect(defaultLens(threads, sessions)).toBe("all");
  });
});

describe("in-session lens pins", () => {
  it("a pinned row that no longer qualifies stays in the lens", () => {
    const read = makeSession({ id: "chat-read", unreadCount: 0 });
    const unpinned = mergeConversations([], [read], "needs-you");
    expect(unpinned).toHaveLength(0);
    const pinned = mergeConversations([], [read], "needs-you", "all", new Set(["chat-read"]));
    expect(pinned.map(conversationRowId)).toEqual(["chat-read"]);
  });

  it("pins never bypass de-dupe or the kind filter", () => {
    const threads = [makeThread({ id: "th-1", status: "resolved", chat_ids: ["chat-att"] })];
    const sessions = [makeSession({ id: "chat-att", unreadCount: 0 })];
    // attached chat stays excluded even when pinned
    expect(mergeConversations(threads, sessions, "needs-you", "all", new Set(["chat-att", "th-1"])))
      .toHaveLength(1); // only the pinned resolved thread re-enters
    // kind filter still narrows a pinned row out
    const libChat = makeSession({ id: "chat-lib", unreadCount: 0 });
    expect(mergeConversations([], [libChat], "needs-you", "task", new Set(["chat-lib"])))
      .toHaveLength(0);
  });

  it("a resolved-while-pinned thread stays visible in needs-you", () => {
    const resolved = makeThread({ id: "th-done", status: "resolved" });
    expect(mergeConversations([resolved], [], "needs-you")).toHaveLength(0);
    expect(mergeConversations([resolved], [], "needs-you", "all", new Set(["th-done"])))
      .toHaveLength(1);
  });
});
