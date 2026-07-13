import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  addStoredComment,
  getStoredComments,
  listStoredFeedback,
  markStoredCommentsProcessed,
  recordClusteredFeedback,
} from "../library/library-feedback";
import {
  appendToThread,
  createThread,
  markProcessed,
  readThread,
  resolveThread,
  threadsForTarget,
} from "../threads/store";
import { renderFeedbackHandledSection, runThreadHealthPass } from "./health-pass";

const originalDataDir = process.env.DATA_DIR;
const originalVault = process.env.BRIDGE_VAULT_PATH;
const originalWorkingFolder = process.env.HILT_WORKING_FOLDER;
const tmpDirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function setup(): { home: string } {
  process.env.DATA_DIR = tmpDir("hilt-health-pass-data-");
  process.env.BRIDGE_VAULT_PATH = tmpDir("hilt-health-pass-vault-");
  delete process.env.HILT_WORKING_FOLDER;
  const base = tmpDir("hilt-health-pass-base-");
  const home = path.join(base, "meta", "loops", "meeting-actions");
  fs.mkdirSync(home, { recursive: true });
  return { home };
}

test("health pass consumes an unreplied open thread", () => {
  const { home } = setup();
  const now = "2026-07-08T09:00:00.000Z";
  const runAt = "2026-07-08T09:00:00.000Z";
  const thread = createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" },
    { author: "justin", text: "calibrate   this\nplease" },
  );

  const summary = runThreadHealthPass({ loopId: "meeting-actions", home, now, runAt });

  assert.deepEqual(summary, {
    consumed: 1,
    threads: [thread.id],
    titles: ["calibrate this please"],
  });
  const reread = readThread(thread.id);
  assert.ok(reread);
  const last = reread.messages[reread.messages.length - 1];
  assert.equal(last.author, "agent:meeting-actions");
  assert.equal(last.text, "Consumed as calibration guidance for the meeting-actions run 2026-07-08.");
  assert.equal(reread.processed, undefined);
  assert.equal(reread.status, "open");
  assert.equal(reread.messages[0].handled_at, now);
  assert.equal(reread.outcomes?.at(-1)?.kind, "calibrated");
  assert.equal(reread.resolution, undefined);
});

test("skips replied, resolved, processed, and other-loop threads", () => {
  const { home } = setup();
  const now = "2026-07-08T09:00:00.000Z";
  const runAt = "2026-07-08T09:00:00.000Z";

  const replied = createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-replied" },
    { author: "justin", text: "already answered" },
  );
  appendToThread(replied.id, { author: "agent:x", text: "handled" });

  const resolved = createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-resolved" },
    { author: "justin", text: "already resolved" },
  );
  resolveThread(resolved.id, { action: "done", by: "agent:meeting-actions" });

  const processed = createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-processed" },
    { author: "justin", text: "already processed" },
  );
  markProcessed(processed.id, { at: now, run_at: runAt });

  createThread(
    { kind: "loop-item", loop: "briefing", itemId: "br-1" },
    { author: "justin", text: "wrong loop" },
  );

  assert.deepEqual(runThreadHealthPass({ loopId: "meeting-actions", home, now, runAt }), {
    consumed: 0,
    threads: [],
    titles: [],
  });
});

test("second pass is a no-op", () => {
  const { home } = setup();
  const now = "2026-07-08T09:00:00.000Z";
  const runAt = "2026-07-08T09:00:00.000Z";
  const thread = createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" },
    { author: "justin", text: "use this once" },
  );

  assert.equal(runThreadHealthPass({ loopId: "meeting-actions", home, now, runAt }).consumed, 1);
  assert.deepEqual(runThreadHealthPass({ loopId: "meeting-actions", home, now, runAt }), {
    consumed: 0,
    threads: [],
    titles: [],
  });

  const reread = readThread(thread.id);
  assert.ok(reread);
  assert.equal(reread.messages.filter((message) => message.author.startsWith("agent:")).length, 1);
});

test("renderFeedbackHandledSection", () => {
  setup();

  assert.equal(renderFeedbackHandledSection({ consumed: 0, threads: [], titles: [] }), "");
  const rendered = renderFeedbackHandledSection({
    consumed: 2,
    threads: ["thread-1", "thread-2"],
    titles: ["first handled title", "second handled title"],
  });

  assert.ok(rendered.startsWith("## Feedback handled\n\n"));
  assert.ok(rendered.includes(`- "first handled title" \u2192 calibrated`));
  assert.ok(rendered.includes(`- "second handled title" \u2192 calibrated`));
  assert.ok(rendered.endsWith("\n"));
});

test("recordClusteredFeedback handles selected comments without closing the conversation", () => {
  setup();
  const comment = addStoredComment("/unused", "art-9", "needs better clustering");
  const commentId = comment.id;
  const [thread] = threadsForTarget({ kind: "library", id: "art-9" });
  assert.ok(thread);

  assert.deepEqual(
    recordClusteredFeedback("/unused", [{ id: "art-9", commentIds: [commentId] }], "2026-07-08"),
    { replied: 1 },
  );

  const reread = readThread(thread.id);
  assert.ok(reread);
  const last = reread.messages[reread.messages.length - 1];
  assert.equal(last.author, "agent:library");
  assert.equal(last.text, "Clustered into the steering report 2026-07-08.");
  assert.equal(reread.resolution, undefined);
  assert.equal(reread.status, "open");
  assert.equal(reread.outcomes?.at(-1)?.kind, "clustered");
  assert.equal(reread.processed, undefined);
  assert.equal(reread.messages[0].handled_at !== undefined, true);
  assert.equal(getStoredComments("/unused", "art-9").length, 1);
  assert.deepEqual(getStoredComments("/unused", "art-9").map((stored) => stored.id), [commentId]);

  const feedback = listStoredFeedback("/unused");
  assert.equal(feedback.length, 1);
  assert.equal(feedback[0].id, "art-9");
  assert.deepEqual(feedback[0].comments.map((stored) => stored.id), [commentId]);

  assert.deepEqual(
    recordClusteredFeedback("/unused", [{ id: "art-9", commentIds: [commentId] }], "2026-07-08"),
    { replied: 0 },
  );

  markStoredCommentsProcessed("/unused", [{ id: "art-9" }]);
  const [processed] = getStoredComments("/unused", "art-9");
  assert.ok(processed.processed_at);
});

test("cleanup temp env", () => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalVault === undefined) delete process.env.BRIDGE_VAULT_PATH;
  else process.env.BRIDGE_VAULT_PATH = originalVault;
  if (originalWorkingFolder === undefined) delete process.env.HILT_WORKING_FOLDER;
  else process.env.HILT_WORKING_FOLDER = originalWorkingFolder;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});
