/**
 * Behavioral spec for the thread store (v3 unit C2): round-trip + normalize-on-read,
 * append-to-open semantics, edit/delete (incl. last-message-deletes-thread), target identity,
 * the FeedbackTarget↔CommentTarget bridge, migration mapping + idempotency (temp dirs only),
 * the loops-store re-point (FeedbackRecord-shaped adapters), and domain↔loop-id resolution.
 *
 * Vitest: npx vitest run src/lib/threads/threads.test.ts
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { FeedbackRecord } from "../loops/types";
import {
  appendFeedback,
  loopIdsForHome,
  markFeedbackProcessed,
  readFeedback,
  readUnprocessedFeedback,
} from "../loops/stores";
import {
  addStoredComment,
  getStoredComments,
  listStoredFeedback,
  markStoredCommentsProcessed,
} from "../library/library-feedback";
import { commentTargetToFeedback, feedbackTargetToComment } from "./feedback-bridge";
import {
  feedbackRecordToThread,
  libraryCommentToThread,
  migrateFeedbackJsonl,
  migrateLibraryFeedbackStore,
  existingSourceIds,
} from "./migrate";
import {
  appendToThread,
  createThread,
  deleteMessage,
  editMessage,
  isValidThreadId,
  listThreads,
  markProcessed,
  normalizeThread,
  openThreadForTarget,
  readThread,
  resolveThread,
  targetKey,
  threadsDir,
  threadsForTarget,
  toThreadSummary,
} from "./store";
import { targetKey as clientTargetKey } from "./target-key";
import type { CommentTarget, Thread } from "./types";

const originalDataDir = process.env.DATA_DIR;
const originalVault = process.env.BRIDGE_VAULT_PATH;
const originalWorkingFolder = process.env.HILT_WORKING_FOLDER;
const tmpDirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

// The stores resolve DATA_DIR per call; BRIDGE_VAULT_PATH is pinned to an EMPTY temp dir so
// the registry fallback never reads the real vault from a test.
beforeEach(() => {
  process.env.DATA_DIR = tmpDir("hilt-threads-test-");
  process.env.BRIDGE_VAULT_PATH = tmpDir("hilt-threads-vault-");
  delete process.env.HILT_WORKING_FOLDER;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalVault === undefined) delete process.env.BRIDGE_VAULT_PATH;
  else process.env.BRIDGE_VAULT_PATH = originalVault;
  if (originalWorkingFolder !== undefined) process.env.HILT_WORKING_FOLDER = originalWorkingFolder;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function writeRawThread(id: string, value: unknown): void {
  fs.mkdirSync(threadsDir(), { recursive: true });
  fs.writeFileSync(path.join(threadsDir(), `${id}.json`), JSON.stringify(value), "utf-8");
}

const libTarget: CommentTarget = { kind: "library", id: "art-1" };

describe("thread store — round-trip", () => {
  it("createThread → readThread round-trips; listThreads includes it; no temp files", () => {
    const thread = createThread(libTarget, { author: "justin", text: "hello" });
    expect(isValidThreadId(thread.id)).toBe(true);
    expect(readThread(thread.id)).toEqual(thread);
    expect(listThreads().map((t) => t.id)).toEqual([thread.id]);
    expect(thread.status).toBe("open");
    expect(thread.messages).toHaveLength(1);
    expect(thread.created_at).toBe(thread.messages[0].created_at);
    const leftovers = fs.readdirSync(threadsDir()).filter((name) => name.includes(".tmp."));
    expect(leftovers).toEqual([]);
  });

  it("toThreadSummary carries counts and a flattened snippet", () => {
    const thread = createThread(libTarget, { author: "justin", text: "line one\nline  two" });
    const summary = toThreadSummary(thread);
    expect(summary.message_count).toBe(1);
    expect(summary.last_message_snippet).toBe("line one line two");
    expect(summary.target).toEqual(libTarget);
  });

  it("rejects traversal-shaped ids before touching the filesystem", () => {
    expect(isValidThreadId("../../etc/passwd")).toBe(false);
    expect(readThread("../escape")).toBeNull();
    expect(() => appendToThread("../escape", { author: "justin", text: "x" })).toThrow(/not found|invalid/);
  });
});

describe("thread store — normalize on read", () => {
  it("coerces bad/missing fields instead of throwing", () => {
    const id = crypto.randomUUID();
    writeRawThread(id, {
      id: "garbage",
      target: { kind: "library", id: "art-9" },
      status: "weird",
      messages: [
        { id: "m1", author: "justin", text: "ok", created_at: "2026-07-01T00:00:00Z" },
        { author: 42, text: "coerced author" },
        "not an object",
        { id: "m3", author: "justin" }, // no text → dropped
      ],
      processed: { at: "2026-07-02T00:00:00Z" }, // missing run_at → dropped
      resolution: { action: "done" }, // missing at/by → dropped
      source_ref: 17,
    });
    const thread = readThread(id);
    expect(thread).not.toBeNull();
    expect(thread!.id).toBe(id); // filename wins over garbage embedded id
    expect(thread!.status).toBe("open"); // unknown status coerced; no valid processed stamp
    expect(thread!.messages).toHaveLength(2);
    expect(thread!.messages[1].author).toBe("justin"); // non-string author coerced
    expect(thread!.processed).toBeUndefined();
    expect(thread!.resolution).toBeUndefined();
    expect(thread!.source_ref).toBeUndefined();
    expect(thread!.created_at).toBe("2026-07-01T00:00:00Z"); // falls back to first message
  });

  it("a valid processed stamp forces resolved status", () => {
    const id = crypto.randomUUID();
    writeRawThread(id, {
      target: { kind: "library", id: "a" },
      status: "open",
      messages: [{ id: "m", author: "justin", text: "t", created_at: "2026-07-01T00:00:00Z" }],
      processed: { at: "2026-07-02T00:00:00Z", run_at: "2026-07-02T00:00:00Z" },
    });
    expect(readThread(id)!.status).toBe("resolved");
  });

  it("invalid target, zero messages, or corrupt JSON degrade to missing and never crash the list", () => {
    const good = createThread(libTarget, { author: "justin", text: "keep" });
    const badTarget = crypto.randomUUID();
    writeRawThread(badTarget, { target: { kind: "nope" }, messages: [{ id: "m", author: "j", text: "x", created_at: "" }] });
    const empty = crypto.randomUUID();
    writeRawThread(empty, { target: libTarget, messages: [] });
    const corrupt = crypto.randomUUID();
    fs.writeFileSync(path.join(threadsDir(), `${corrupt}.json`), "{ not json ", "utf-8");
    expect(readThread(badTarget)).toBeNull();
    expect(readThread(empty)).toBeNull();
    expect(readThread(corrupt)).toBeNull();
    expect(listThreads().map((t) => t.id)).toEqual([good.id]);
  });

  it("normalizeThread never throws on non-object input", () => {
    expect(normalizeThread(null, crypto.randomUUID())).toBeNull();
    expect(normalizeThread([], crypto.randomUUID())).toBeNull();
    expect(normalizeThread("junk", crypto.randomUUID())).toBeNull();
  });
});

describe("thread store — append-to-open semantics", () => {
  it("an open thread on the target absorbs the next comment; resolved targets start fresh", () => {
    const first = createThread(libTarget, { author: "justin", text: "one" });
    expect(openThreadForTarget(libTarget)!.id).toBe(first.id);

    appendToThread(first.id, { author: "justin", text: "two" });
    expect(readThread(first.id)!.messages).toHaveLength(2);

    resolveThread(first.id, { action: "done", by: "justin" });
    expect(openThreadForTarget(libTarget)).toBeNull();

    const second = createThread(libTarget, { author: "justin", text: "three" });
    expect(second.id).not.toBe(first.id);
    expect(threadsForTarget(libTarget)).toHaveLength(2);
    expect(openThreadForTarget(libTarget)!.id).toBe(second.id);
  });

  it("markProcessed resolves the thread (consumed feedback closes the conversation)", () => {
    const thread = createThread(libTarget, { author: "justin", text: "fb" });
    const stamped = markProcessed(thread.id, { at: "2026-07-08T01:00:00Z", run_at: "2026-07-08T01:00:00Z" });
    expect(stamped.status).toBe("resolved");
    expect(stamped.processed).toEqual({ at: "2026-07-08T01:00:00Z", run_at: "2026-07-08T01:00:00Z" });
    expect(openThreadForTarget(libTarget)).toBeNull();
  });
});

describe("thread store — edit and delete", () => {
  it("editMessage rewrites text and stamps edited_at", () => {
    const thread = createThread(libTarget, { author: "justin", text: "tpyo" });
    const messageId = thread.messages[0].id;
    const updated = editMessage(thread.id, messageId, "typo");
    expect(updated.messages[0].text).toBe("typo");
    expect(updated.messages[0].edited_at).toBeTruthy();
    expect(() => editMessage(thread.id, "ghost", "x")).toThrow("Message not found");
  });

  it("deleteMessage removes one message; deleting the last message deletes the thread file", () => {
    const thread = createThread(libTarget, { author: "justin", text: "one" });
    appendToThread(thread.id, { author: "justin", text: "two" });
    const [m1, m2] = readThread(thread.id)!.messages;

    const afterOne = deleteMessage(thread.id, m1.id);
    expect(afterOne!.messages.map((m) => m.id)).toEqual([m2.id]);

    const afterLast = deleteMessage(thread.id, m2.id);
    expect(afterLast).toBeNull();
    expect(readThread(thread.id)).toBeNull();
    expect(fs.existsSync(path.join(threadsDir(), `${thread.id}.json`))).toBe(false);
  });
});

describe("target identity (targetKey)", () => {
  it("distinguishes every kind and its ids", () => {
    const targets: CommentTarget[] = [
      { kind: "task", id: "t-1" },
      { kind: "task", id: "t-2" },
      { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" },
      { kind: "loop-item", loop: "runtime", itemId: "ma-1" },
      { kind: "briefing", date: "2026-07-08" },
      { kind: "briefing", date: "2026-07-07" },
      { kind: "briefing-section", date: "2026-07-08", section: "Meetings" },
      { kind: "briefing-section", date: "2026-07-08", section: "Library" },
      { kind: "briefing-anchor", date: "2026-07-08", anchor: { text: "bullet a" } },
      { kind: "briefing-anchor", date: "2026-07-08", anchor: { text: "bullet b" } },
      { kind: "library", id: "art-1" },
      { kind: "library", id: "art-2" },
      { kind: "meeting", rel: "meetings/2026-07-08/a.md" },
      { kind: "meeting", rel: "meetings/2026-07-08/b.md" },
    ];
    const keys = targets.map(targetKey);
    expect(new Set(keys).size).toBe(targets.length);
  });

  it("ignores non-identity fields: loop-item artifactDate, anchor citation", () => {
    expect(targetKey({ kind: "loop-item", loop: "l", itemId: "i", artifactDate: "2026-07-01" }))
      .toBe(targetKey({ kind: "loop-item", loop: "l", itemId: "i" }));
    expect(targetKey({ kind: "briefing-anchor", date: "d", anchor: { text: "t", citation: "c1" } }))
      .toBe(targetKey({ kind: "briefing-anchor", date: "d", anchor: { text: "t" } }));
    expect(targetKey({ kind: "briefing-anchor", date: "d", anchor: { text: "t", section: "A" } }))
      .not.toBe(targetKey({ kind: "briefing-anchor", date: "d", anchor: { text: "t", section: "B" } }));
  });
});

describe("feedback bridge — FeedbackTarget↔CommentTarget", () => {
  it("maps every level per the C2 table and round-trips", () => {
    expect(feedbackTargetToComment({ loop: "meeting-actions", level: "item", item_id: "ma-1", artifact_date: "2026-07-01" }))
      .toEqual({ kind: "loop-item", loop: "meeting-actions", itemId: "ma-1", artifactDate: "2026-07-01" });
    expect(feedbackTargetToComment({ loop: "briefing", level: "item", anchor: { section: "S", text: "T" }, artifact_date: "2026-07-01" }))
      .toEqual({ kind: "briefing-anchor", date: "2026-07-01", anchor: { section: "S", text: "T" } });
    expect(feedbackTargetToComment({ loop: "briefing", level: "section", artifact_date: "2026-07-01", section: "Meetings" }))
      .toEqual({ kind: "briefing-section", date: "2026-07-01", section: "Meetings" });
    expect(feedbackTargetToComment({ loop: "briefing", level: "briefing", artifact_date: "2026-07-01" }))
      .toEqual({ kind: "briefing", date: "2026-07-01" });
    // A dateless briefing-level record (live data has one) borrows the record's created_at day.
    expect(feedbackTargetToComment({ loop: "briefing", level: "briefing" }, { fallbackDate: "2026-07-03" }))
      .toEqual({ kind: "briefing", date: "2026-07-03" });

    const roundTrips: CommentTarget[] = [
      { kind: "loop-item", loop: "runtime", itemId: "rt-1", artifactDate: "2026-07-07" },
      { kind: "briefing", date: "2026-07-06" },
      { kind: "briefing-section", date: "2026-07-06", section: "Goals" },
      { kind: "briefing-anchor", date: "2026-07-06", anchor: { text: "bullet" } },
    ];
    for (const target of roundTrips) {
      expect(feedbackTargetToComment(commentTargetToFeedback(target)!)).toEqual(target);
    }
    expect(commentTargetToFeedback({ kind: "task", id: "t" })).toBeNull();
    expect(commentTargetToFeedback({ kind: "library", id: "a" })).toBeNull();
    expect(commentTargetToFeedback({ kind: "meeting", rel: "m.md" })).toBeNull();
  });
});

describe("migration — mapping, dry-run, idempotency (temp dirs only)", () => {
  const records: FeedbackRecord[] = [
    {
      id: "fb-anchor", author: "claude-sim", created_at: "2026-07-02T23:48:36.154Z",
      target: { loop: "meeting-actions", level: "item", anchor: { text: "[unclear] item" } },
      text: "anchor feedback",
      processed: { at: "2026-07-03T00:00:17.755Z", run_at: "2026-07-03T00:00:17.755Z" },
    },
    {
      id: "fb-item", author: "justin", created_at: "2026-07-07T21:39:23.994Z",
      target: { loop: "runtime", level: "item", artifact_date: "2026-07-07", item_id: "rt-1" },
      text: "item feedback",
    },
    {
      id: "fb-section", author: "justin", created_at: "2026-07-05T00:00:00.000Z",
      target: { loop: "briefing", level: "section", artifact_date: "2026-07-04", section: "Meetings" },
      text: "section feedback",
    },
    {
      id: "fb-briefing", author: "justin", created_at: "2026-07-03T00:50:34.619Z",
      target: { loop: "briefing", level: "briefing" },
      text: "briefing feedback",
    },
  ];

  it("feedbackRecordToThread maps each level; processed → resolved + stamp + agent message", () => {
    const anchor = feedbackRecordToThread(records[0]);
    expect(anchor.target).toEqual({ kind: "briefing-anchor", anchor: { text: "[unclear] item" } });
    expect(anchor.status).toBe("resolved");
    expect(anchor.processed).toEqual(records[0].processed);
    expect(anchor.source_ref).toBe("fb-anchor");
    expect(anchor.messages).toHaveLength(2);
    expect(anchor.messages[0]).toMatchObject({ id: "fb-anchor", author: "claude-sim", text: "anchor feedback" });
    expect(anchor.messages[1].author).toBe("agent:meeting-actions");
    expect(anchor.messages[1].text).toBe("Consumed by the meeting-actions loop run 2026-07-03T00:00:17.755Z");

    const item = feedbackRecordToThread(records[1]);
    expect(item.target).toEqual({ kind: "loop-item", loop: "runtime", itemId: "rt-1", artifactDate: "2026-07-07" });
    expect(item.status).toBe("open");
    expect(item.messages).toHaveLength(1);

    expect(feedbackRecordToThread(records[2]).target)
      .toEqual({ kind: "briefing-section", date: "2026-07-04", section: "Meetings" });
    // Dateless briefing-level record → the created_at day.
    expect(feedbackRecordToThread(records[3]).target).toEqual({ kind: "briefing", date: "2026-07-03" });
  });

  it("jsonl migration: dry-run writes nothing; --write lifts; re-run is a no-op", () => {
    const home = tmpDir("hilt-threads-loophome-");
    const jsonl = path.join(home, "feedback", "records.jsonl");
    fs.mkdirSync(path.dirname(jsonl), { recursive: true });
    fs.writeFileSync(jsonl, `${records.map((r) => JSON.stringify(r)).join("\n")}\nnot json\n`, "utf-8");

    const dry = migrateFeedbackJsonl(jsonl, existingSourceIds(), { write: false });
    expect(dry).toMatchObject({ total: 5, migrated: 4, skipped: 0, malformed: 1 });
    expect(listThreads()).toHaveLength(0);

    const write = migrateFeedbackJsonl(jsonl, existingSourceIds(), { write: true });
    expect(write.migrated).toBe(4);
    expect(listThreads()).toHaveLength(4);
    expect(fs.existsSync(jsonl)).toBe(true); // source left in place (history)

    const rerun = migrateFeedbackJsonl(jsonl, existingSourceIds(), { write: true });
    expect(rerun).toMatchObject({ migrated: 0, skipped: 4 });
    expect(listThreads()).toHaveLength(4);
  });

  it("library store migration: per-comment threads, processed_at → resolved + stamp; idempotent", () => {
    const storePath = path.join(tmpDir("hilt-threads-libstore-"), "abc.json");
    fs.writeFileSync(storePath, JSON.stringify({
      "art-a": [
        { id: "c1", text: "processed comment", created_at: "2026-06-04T16:08:52.590Z", processed_at: "2026-06-10T14:40:59.421Z" },
        { id: "c2", text: "open comment", created_at: "2026-06-09T14:07:22.319Z" },
      ],
    }), "utf-8");

    const write = migrateLibraryFeedbackStore(storePath, existingSourceIds(), { write: true });
    expect(write).toMatchObject({ total: 2, migrated: 2, skipped: 0 });
    const threads = threadsForTarget({ kind: "library", id: "art-a" });
    expect(threads).toHaveLength(2);
    const processedThread = threads.find((t) => t.source_ref === "c1")!;
    expect(processedThread.status).toBe("resolved");
    expect(processedThread.processed).toEqual({ at: "2026-06-10T14:40:59.421Z", run_at: "2026-06-10T14:40:59.421Z" });
    expect(threads.find((t) => t.source_ref === "c2")!.status).toBe("open");

    const rerun = migrateLibraryFeedbackStore(storePath, existingSourceIds(), { write: true });
    expect(rerun).toMatchObject({ migrated: 0, skipped: 2 });
    // And the comments read back through the re-pointed library adapter.
    const comments = getStoredComments("/ignored", "art-a");
    expect(comments.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(comments[0].processed_at).toBe("2026-06-10T14:40:59.421Z");
    expect(comments[1].processed_at).toBeUndefined();
  });

  it("libraryCommentToThread carries updated_at as edited_at", () => {
    const thread = libraryCommentToThread("art-x", {
      id: "c9", text: "edited", created_at: "2026-06-01T00:00:00Z", updated_at: "2026-06-02T00:00:00Z",
    });
    expect(thread.messages[0].edited_at).toBe("2026-06-02T00:00:00Z");
    expect(thread.status).toBe("open");
  });
});

const REGISTRY_YML = `loops:
  - id: briefing
    domain: briefings
    cadence: daily
    enabled: false
    phase: shadow
  - id: meeting-actions
    domain: meetings
    cadence: daily
    enabled: true
    phase: shadow
  - id: runtime
    domain: system
    cadence: daily
    enabled: true
    phase: live
`;

function makeBaseWithRegistry(): string {
  const base = tmpDir("hilt-threads-base-");
  fs.mkdirSync(path.join(base, "meta", "loops"), { recursive: true });
  fs.writeFileSync(path.join(base, "meta", "loops", "registry.yml"), REGISTRY_YML, "utf-8");
  return base;
}

describe("domain↔loop-id mapping (loopIdsForHome)", () => {
  it("resolves via a sibling registry: briefings→briefing, meetings→meeting-actions", () => {
    const base = makeBaseWithRegistry();
    expect(loopIdsForHome(path.join(base, "meta", "loops", "briefings"))).toEqual(["briefing"]);
    expect(loopIdsForHome(path.join(base, "meta", "loops", "meetings"))).toEqual(["meeting-actions"]);
    expect(loopIdsForHome(path.join(base, "meta", "loops", "system"))).toEqual(["runtime"]);
  });

  it("shadow homes without a sibling registry resolve through the env vault's registry", () => {
    const vault = makeBaseWithRegistry();
    process.env.BRIDGE_VAULT_PATH = vault;
    const shadowHome = path.join(tmpDir("hilt-threads-shadow-"), "meta", "loops", "meetings");
    expect(loopIdsForHome(shadowHome)).toEqual(["meeting-actions"]);
  });

  it("with no registry anywhere, falls back to the domain with the briefings alias pinned", () => {
    const home = path.join(tmpDir("hilt-threads-noreg-"), "meta", "loops", "briefings");
    expect(loopIdsForHome(home)).toEqual(["briefing"]);
    expect(loopIdsForHome(path.join(path.dirname(home), "references"))).toEqual(["references"]);
  });
});

describe("loops store re-point — FeedbackRecord-shaped adapters over threads", () => {
  it("appendFeedback → readFeedback round-trips the record shape the consumers read", () => {
    const base = makeBaseWithRegistry();
    const home = path.join(base, "meta", "loops", "meetings");
    const record: FeedbackRecord = {
      id: "fb-live-1", author: "justin", created_at: "2026-07-08T10:00:00.000Z",
      target: { loop: "meeting-actions", level: "item", item_id: "ma-9" },
      text: "attribute to the named attendee",
    };
    appendFeedback(home, record);

    const read = readFeedback(home);
    expect(read).toHaveLength(1);
    expect(read[0]).toEqual(record);
    // The exact fields scripts/loop-meeting-actions.ts consumes for guidance lines:
    expect(read[0].created_at.slice(0, 10)).toBe("2026-07-08");
    expect(read[0].target.item_id).toBe("ma-9");
    expect(read[0].text).toBe("attribute to the named attendee");
    // Other homes don't see it.
    expect(readFeedback(path.join(base, "meta", "loops", "briefings"))).toEqual([]);
  });

  it("append-to-open merges same-target comments; both read back as records", () => {
    const base = makeBaseWithRegistry();
    const home = path.join(base, "meta", "loops", "system");
    const target = { loop: "runtime", level: "item" as const, item_id: "rt-1" };
    appendFeedback(home, { id: "fb-a", author: "justin", created_at: "2026-07-08T10:00:00.000Z", target, text: "first" });
    appendFeedback(home, { id: "fb-b", author: "justin", created_at: "2026-07-08T11:00:00.000Z", target, text: "second" });
    expect(listThreads()).toHaveLength(1);
    expect(readFeedback(home).map((r) => r.id)).toEqual(["fb-a", "fb-b"]);
  });

  it("markFeedbackProcessed stamps by record id; readUnprocessedFeedback empties; agent notes stay out", () => {
    const base = makeBaseWithRegistry();
    const home = path.join(base, "meta", "loops", "briefings");
    appendFeedback(home, {
      id: "fb-br-1", author: "justin", created_at: "2026-07-08T09:00:00.000Z",
      target: { loop: "briefing", level: "briefing", artifact_date: "2026-07-08" },
      text: "too long",
    });
    expect(readUnprocessedFeedback(home)).toHaveLength(1);

    const stamp = { at: "2026-07-08T12:00:00.000Z", run_at: "2026-07-08T12:00:00.000Z" };
    markFeedbackProcessed(home, ["fb-br-1"], stamp);
    expect(readUnprocessedFeedback(home)).toEqual([]);
    const all = readFeedback(home);
    expect(all).toHaveLength(1);
    expect(all[0].processed).toEqual(stamp);
    // The thread is resolved → the next comment on the same target starts a fresh thread.
    appendFeedback(home, {
      id: "fb-br-2", author: "justin", created_at: "2026-07-08T13:00:00.000Z",
      target: { loop: "briefing", level: "briefing", artifact_date: "2026-07-08" },
      text: "still too long",
    });
    expect(listThreads()).toHaveLength(2);
    expect(readUnprocessedFeedback(home).map((r) => r.id)).toEqual(["fb-br-2"]);
  });
});

describe("library adapter re-point — LibraryComment-shaped over threads", () => {
  it("add/list/mark-processed keep the store shapes; processed target starts a fresh thread", () => {
    const added = addStoredComment("/ignored", "art-lib", "needs a better summary");
    expect(added).toMatchObject({ text: "needs a better summary" });
    expect(added.created_at).toBeTruthy();

    const listed = listStoredFeedback("/ignored");
    expect(listed).toHaveLength(1);
    expect(listed[0].id).toBe("art-lib");
    expect(listed[0].comments.map((c) => c.id)).toEqual([added.id]);

    const second = addStoredComment("/ignored", "art-lib", "and fix the title");
    expect(listThreads()).toHaveLength(1); // append-to-open

    const { processed } = markStoredCommentsProcessed("/ignored", [{ id: "art-lib" }]);
    expect(processed).toBe(2);
    const comments = getStoredComments("/ignored", "art-lib");
    expect(comments.every((c) => c.processed_at)).toBe(true);
    expect(comments.map((c) => c.id)).toEqual([added.id, second.id]);

    addStoredComment("/ignored", "art-lib", "post-processing comment");
    expect(listThreads()).toHaveLength(2); // resolved target → fresh thread
  });
});

describe("targetKey — client-safe extraction parity (W1)", () => {
  it("the store re-export IS the client-safe implementation", () => {
    expect(targetKey).toBe(clientTargetKey);
  });

  it("produces identical keys for every kind and variant", () => {
    const targets: CommentTarget[] = [
      { kind: "task", id: "t-20260709-001" },
      { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" },
      { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1", artifactDate: "2026-07-09" },
      { kind: "briefing", date: "2026-07-09" },
      { kind: "briefing-section", date: "2026-07-09", section: "Signals" },
      { kind: "briefing-anchor", anchor: { text: "a bullet" } },
      { kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "Signals", citation: "meetings/x.md", text: "a bullet" } },
      { kind: "library", id: "art-1" },
      { kind: "meeting", rel: "meetings/2026-07-09/standup.md" },
    ];
    for (const target of targets) {
      expect(clientTargetKey(target)).toBe(targetKey(target));
    }
  });

  it("pins identity exclusions: artifactDate and citation are provenance, not identity", () => {
    expect(clientTargetKey({ kind: "loop-item", loop: "l", itemId: "i", artifactDate: "2026-07-01" }))
      .toBe(clientTargetKey({ kind: "loop-item", loop: "l", itemId: "i", artifactDate: "2026-07-08" }));
    expect(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", citation: "a.md", text: "t" } }))
      .toBe(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", citation: "b.md", text: "t" } }));
    // date/section/text ARE identity.
    expect(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", text: "t" } }))
      .not.toBe(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-08", anchor: { section: "S", text: "t" } }));
    expect(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", text: "t" } }))
      .not.toBe(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S2", text: "t" } }));
    expect(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", text: "t" } }))
      .not.toBe(clientTargetKey({ kind: "briefing-anchor", date: "2026-07-09", anchor: { section: "S", text: "t2" } }));
  });
});
