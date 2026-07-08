/**
 * Behavioral spec for the chat lib (Chat v1, Workstream 1): store normalize-on-read
 * coercions, atomic write round-trips, list ordering, deterministicTitle, and
 * summarizeToolInput trace-size discipline.
 *
 * Vitest (the config's src glob picks this up): npx vitest run src/lib/chat/chat.test.ts
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { deterministicTitle } from "./types";
import type { ChatSession } from "./types";
import { summarizeToolInput, CHAT_ALLOWED_TOOLS, CHAT_MODEL } from "./run-claude";
import {
  appendMessage,
  chatSessionsDir,
  createChat,
  isValidChatId,
  listChats,
  normalizeChatSession,
  normalizeContext,
  readChat,
  toChatSummary,
  updateChat,
} from "./store";

const originalDataDir = process.env.DATA_DIR;
const tmpDirs: string[] = [];

// chatSessionsDir() resolves DATA_DIR per call, so a fresh dir per test isolates state.
beforeEach(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-chat-test-"));
  tmpDirs.push(dir);
  process.env.DATA_DIR = dir;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeRawSession(id: string, value: unknown): void {
  fs.mkdirSync(chatSessionsDir(), { recursive: true });
  fs.writeFileSync(path.join(chatSessionsDir(), `${id}.json`), JSON.stringify(value), "utf-8");
}

describe("chat store — atomic write round-trip", () => {
  it("createChat → readChat round-trips the session", () => {
    const session = createChat({ kind: "library", id: "abc123" }, "Some artifact");
    const read = readChat(session.id);
    expect(read).toEqual(session);
    expect(read?.context).toEqual({ kind: "library", id: "abc123" });
    expect(read?.title).toBe("New chat");
    expect(read?.status).toBe("idle");
  });

  it("appendMessage persists and bumps updatedAt; no temp files left behind", async () => {
    const session = createChat({ kind: "none" }, "Chat");
    await new Promise((r) => setTimeout(r, 5));
    const after = appendMessage(session.id, {
      id: crypto.randomUUID(),
      role: "user",
      content: "hello",
      timestamp: Date.now(),
    });
    expect(after.messages).toHaveLength(1);
    expect(after.updatedAt).toBeGreaterThan(session.updatedAt);
    expect(readChat(session.id)?.messages[0].content).toBe("hello");
    const leftovers = fs.readdirSync(chatSessionsDir()).filter((name) => name.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });

  it("updateChat patches metadata but never transcript/identity", () => {
    const session = createChat({ kind: "doc", path: "/tmp/x.md" }, "x.md");
    appendMessage(session.id, { id: "m1", role: "user", content: "q", timestamp: 1 });
    const updated = updateChat(session.id, { title: "Renamed", archivedAt: 123, unreadCount: 2 });
    expect(updated.title).toBe("Renamed");
    expect(updated.archivedAt).toBe(123);
    expect(updated.unreadCount).toBe(2);
    expect(updated.id).toBe(session.id);
    expect(updated.createdAt).toBe(session.createdAt);
    expect(updated.messages).toHaveLength(1);
  });

  it("mutations on a missing chat throw; reads degrade to null", () => {
    const ghost = crypto.randomUUID();
    expect(readChat(ghost)).toBeNull();
    expect(() => appendMessage(ghost, { id: "m", role: "user", content: "x", timestamp: 1 })).toThrow(/not found/);
    expect(() => updateChat(ghost, { title: "t" })).toThrow(/not found/);
  });

  it("rejects traversal-shaped ids before touching the filesystem", () => {
    expect(isValidChatId("../../etc/passwd")).toBe(false);
    expect(isValidChatId("..%2F..%2Fevil")).toBe(false);
    expect(isValidChatId(crypto.randomUUID())).toBe(true);
    expect(readChat("../escape")).toBeNull();
  });
});

describe("chat store — normalize on read", () => {
  it("coerces bad/missing fields to defaults instead of throwing", () => {
    const id = crypto.randomUUID();
    writeRawSession(id, {
      id: "garbage-not-a-uuid",
      context: { kind: "weird", id: 42 },
      title: "   ",
      claudeSessionId: 17,
      messages: [
        { id: "ok", role: "user", content: "hi", timestamp: 5 },
        { role: "alien", content: "dropped" },
        "not even an object",
        { role: "assistant", content: 42, trace: [{ label: "Used Read", bogus: true }, { nope: 1 }] },
      ],
      status: "pending",
      archivedAt: "yesterday",
      unreadCount: -3.7,
      createdAt: "not-a-number",
    });
    const session = readChat(id);
    expect(session).not.toBeNull();
    const s = session as ChatSession;
    expect(s.id).toBe(id); // filename wins over a garbage embedded id
    expect(s.context).toEqual({ kind: "none" });
    expect(s.title).toBe("New chat");
    expect(s.claudeSessionId).toBeNull();
    expect(s.messages).toHaveLength(2); // bad role + non-object dropped
    expect(s.messages[1].content).toBe(""); // non-string content coerced
    expect(s.messages[1].trace).toHaveLength(1); // label-less trace entry dropped
    expect(s.messages[1].trace?.[0].type).toBe("step"); // unknown type coerced
    expect(s.status).toBe("idle"); // no 'pending' state in Hilt
    expect(s.archivedAt).toBeNull();
    expect(s.unreadCount).toBe(0);
    expect(s.createdAt).toBe(0);
  });

  it("normalizeContext round-trips every valid kind and collapses malformed refs", () => {
    const valid = [
      { kind: "library", id: "a" },
      { kind: "doc", path: "/abs/x.md" },
      { kind: "person", slug: "art-vandelay" },
      { kind: "task", id: "t-2026-07-08-01" },
      { kind: "meeting", path: "people/meetings/x.md" },
      { kind: "loop-item", loop: "meetings", itemId: "ma-1" },
      { kind: "briefing-line", date: "2026-07-08", anchor: "b2" },
      { kind: "none" },
    ] as const;
    for (const ref of valid) expect(normalizeContext(ref)).toEqual(ref);
    expect(normalizeContext({ kind: "loop-item", loop: "meetings" })).toEqual({ kind: "none" });
    expect(normalizeContext({ kind: "briefing-line", date: "2026-07-08" })).toEqual({ kind: "none" });
    expect(normalizeContext(null)).toEqual({ kind: "none" });
    expect(normalizeContext("library")).toEqual({ kind: "none" });
  });

  it("normalizeChatSession never throws on non-object input", () => {
    const id = crypto.randomUUID();
    expect(normalizeChatSession(null, id).id).toBe(id);
    expect(normalizeChatSession([], id).messages).toEqual([]);
    expect(normalizeChatSession("junk", id).status).toBe("idle");
  });

  it("a hand-corrupted file degrades to missing and never crashes the list", () => {
    const good = createChat({ kind: "none" }, "Chat");
    const corruptId = crypto.randomUUID();
    fs.mkdirSync(chatSessionsDir(), { recursive: true });
    fs.writeFileSync(path.join(chatSessionsDir(), `${corruptId}.json`), "{ not json ", "utf-8");
    expect(readChat(corruptId)).toBeNull();
    const list = listChats();
    expect(list.map((s) => s.id)).toEqual([good.id]);
  });
});

describe("chat store — list ordering and summaries", () => {
  it("lists sessions updatedAt desc, skipping non-session files", () => {
    const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
    const base = { context: { kind: "none" }, title: "T", messages: [], status: "idle" };
    writeRawSession(ids[0], { ...base, id: ids[0], createdAt: 1, updatedAt: 100 });
    writeRawSession(ids[1], { ...base, id: ids[1], createdAt: 1, updatedAt: 300 });
    writeRawSession(ids[2], { ...base, id: ids[2], createdAt: 1, updatedAt: 200 });
    fs.writeFileSync(path.join(chatSessionsDir(), "not-a-chat.json"), "{}", "utf-8");
    expect(listChats().map((s) => s.id)).toEqual([ids[1], ids[2], ids[0]]);
  });

  it("toChatSummary carries counts and a ≤120-char whitespace-flattened snippet", () => {
    const session = createChat({ kind: "person", slug: "art" }, "Art");
    appendMessage(session.id, { id: "m1", role: "user", content: "q", timestamp: 1 });
    const long = `line one\nline two   spaced ${"x".repeat(200)}`;
    const after = appendMessage(session.id, { id: "m2", role: "assistant", content: long, timestamp: 2 });
    const summary = toChatSummary(after);
    expect(summary.messageCount).toBe(2);
    expect(summary.lastMessageSnippet).toHaveLength(120);
    expect(summary.lastMessageSnippet).not.toMatch(/\n/);
    expect(summary.lastMessageSnippet?.startsWith("line one line two spaced")).toBe(true);
    expect(toChatSummary(createChat({ kind: "none" }, "Chat")).lastMessageSnippet).toBeNull();
  });
});

describe("deterministicTitle", () => {
  it("takes the first 7 words", () => {
    expect(deterministicTitle("one two three four five six seven eight nine")).toBe(
      "one two three four five six seven",
    );
  });

  it("caps at 58 chars with an ellipsis", () => {
    const title = deterministicTitle("wordthatkeepsgoing ".repeat(10));
    expect(title.length).toBeLessThanOrEqual(58);
    expect(title.endsWith("...")).toBe(true);
  });

  it("strips punctuation and collapses whitespace", () => {
    expect(deterministicTitle("Fix   the typo, in this reference's summary!")).toBe(
      "Fix the typo in this references summary",
    );
  });

  it("falls back for empty/symbol-only prompts", () => {
    expect(deterministicTitle("")).toBe("New chat");
    expect(deterministicTitle("!!! ??? ***")).toBe("New chat");
  });
});

describe("summarizeToolInput", () => {
  it("truncates Bash commands to 220 chars", () => {
    const out = summarizeToolInput("Bash", { command: "x".repeat(300) });
    expect((out?.command as string).length).toBe(220);
    expect((out?.command as string).endsWith("...")).toBe(true);
  });

  it("keeps only file_path for Read/Edit/Write", () => {
    for (const tool of ["Read", "Edit", "Write"]) {
      const out = summarizeToolInput(tool, {
        file_path: "/vault/notes.md",
        content: "SECRET ".repeat(500),
        old_string: "a",
        new_string: "b",
      });
      expect(out).toEqual({ file_path: "/vault/notes.md" });
    }
  });

  it("reduces MultiEdit to path + edit count", () => {
    const out = summarizeToolInput("MultiEdit", { file_path: "/v/f.md", edits: [{}, {}, {}] });
    expect(out).toEqual({ file_path: "/v/f.md", edits: 3 });
  });

  it("truncates Grep patterns at 120 and keeps path", () => {
    const out = summarizeToolInput("Grep", { pattern: "p".repeat(200), path: "/v" });
    expect((out?.pattern as string).length).toBe(120);
    expect(out?.path).toBe("/v");
  });

  it("generic tools keep only the first 4 primitive fields, truncated", () => {
    const out = summarizeToolInput("SomeTool", {
      a: "x".repeat(300),
      nested: { drop: true },
      arr: [1, 2],
      b: 2,
      c: true,
      d: "keep",
      e: "fifth primitive dropped",
    });
    expect(Object.keys(out ?? {})).toEqual(["a", "b", "c", "d"]);
    expect((out?.a as string).length).toBe(220);
  });

  it("returns null for non-object input", () => {
    expect(summarizeToolInput("Bash", null)).toBeNull();
    expect(summarizeToolInput("Bash", "ls")).toBeNull();
    expect(summarizeToolInput("Bash", [1, 2])).toBeNull();
  });
});

describe("chat constants", () => {
  it("pins the v1 tool surface (no Bash) and the Sonnet model", () => {
    expect(CHAT_ALLOWED_TOOLS).toBe("Read,Edit,Write,Grep,Glob,LS");
    expect(CHAT_MODEL).toBe("sonnet");
  });
});
