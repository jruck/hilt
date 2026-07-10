/**
 * Behavioral spec for the thread processor: prompt composition, author/context mapping,
 * proposal-marker handling, chat/thread persistence, failure discipline, and route guards.
 *
 * Vitest: npx vitest run src/lib/threads/processor.test.ts
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { NextRequest } from "next/server";
import { readChat } from "../chat/store";
import type { ChatStreamEvent } from "../chat/types";
import type { RunClaudeResult } from "../chat/run-claude";
import { parseTaskFile } from "../tasks/task-file";
import { POST } from "../../app/api/threads/[id]/process/route";
import {
  PROCESSOR_INSTRUCTIONS,
  deriveProcessorAuthor,
  parseDevItemMarker,
  parseProposalMarker,
  processThread,
  threadContextRef,
  type ProcessorRunner,
} from "./processor";
import { createThread, readThread, resolveThread } from "./store";
import type { CommentTarget } from "./types";

const originalDataDir = process.env.DATA_DIR;
const originalVault = process.env.BRIDGE_VAULT_PATH;
const originalWorkingFolder = process.env.HILT_WORKING_FOLDER;
const tmpDirs: string[] = [];

function tmpDir(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  process.env.DATA_DIR = tmpDir("hilt-processor-test-");
  process.env.BRIDGE_VAULT_PATH = tmpDir("hilt-processor-vault-");
  delete process.env.HILT_WORKING_FOLDER;
});

afterAll(() => {
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalVault === undefined) delete process.env.BRIDGE_VAULT_PATH;
  else process.env.BRIDGE_VAULT_PATH = originalVault;
  if (originalWorkingFolder === undefined) delete process.env.HILT_WORKING_FOLDER;
  else process.env.HILT_WORKING_FOLDER = originalWorkingFolder;
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

function stubRunner(
  result: Partial<RunClaudeResult> & { text?: string },
  capture?: { prompt?: string },
): ProcessorRunner {
  return async (options) => {
    if (capture) capture.prompt = options.prompt;
    const collectedText = result.text ?? "";
    if (collectedText) options.onText?.(collectedText);
    return {
      collectedText,
      claudeSessionId: result.claudeSessionId ?? "cli-session-1",
      code: result.code ?? 0,
      stderr: result.stderr ?? "",
    };
  };
}

function createLoopItemThread() {
  return createThread(
    { kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" },
    { author: "justin", text: "fix the owner attribution" },
  );
}

function vaultRoot(): string {
  return process.env.BRIDGE_VAULT_PATH!;
}

describe("parseProposalMarker", () => {
  it("only accepts a PROPOSAL marker on the last non-empty line", () => {
    expect(parseProposalMarker("plain text")).toBeNull();
    expect(parseProposalMarker("first\nPROPOSAL: Rework owners\nmore prose")).toBeNull();

    expect(parseProposalMarker("Justin, this is bigger.  \n\nPROPOSAL:   Rework owners  \n\n")).toEqual({
      title: "Rework owners",
      stripped: "Justin, this is bigger.",
    });
  });
});

describe("parseDevItemMarker", () => {
  it("only accepts a DEVITEM marker on the last non-empty line", () => {
    expect(parseDevItemMarker("plain text")).toBeNull();
    expect(parseDevItemMarker("DEVITEM: mid\nmore prose")).toBeNull();
    expect(parseDevItemMarker("prose\nDEVITEM:   ")).toBeNull(); // whitespace-only diagnosis rejected

    expect(parseDevItemMarker("Read Board.tsx.  \n\nDEVITEM:   Filter state resets on refresh  \n\n")).toEqual({
      diagnosis: "Filter state resets on refresh",
      stripped: "Read Board.tsx.",
    });
  });

  it("only the FINAL line owns the marker when both DEVITEM and PROPOSAL appear", () => {
    const proposalLast = "body\nDEVITEM: diag\nPROPOSAL: Do the thing";
    expect(parseDevItemMarker(proposalLast)).toBeNull();
    expect(parseProposalMarker(proposalLast)?.title).toBe("Do the thing");

    const devItemLast = "body\nPROPOSAL: Do the thing\nDEVITEM: diag";
    expect(parseProposalMarker(devItemLast)).toBeNull();
    expect(parseDevItemMarker(devItemLast)?.diagnosis).toBe("diag");
  });
});

describe("threadContextRef", () => {
  it("maps supported thread targets to chat context refs", () => {
    expect(threadContextRef({ kind: "task", id: "t-1" })).toEqual({ kind: "task", id: "t-1" });
    expect(threadContextRef({ kind: "library", id: "lib-1" })).toEqual({ kind: "library", id: "lib-1" });
    expect(threadContextRef({ kind: "meeting", rel: "meetings/2026-07-08/standup.md" }))
      .toEqual({ kind: "meeting", path: "meetings/2026-07-08/standup.md" });
    expect(threadContextRef({ kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" }))
      .toEqual({ kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" });
    expect(threadContextRef({
      kind: "briefing-anchor",
      date: "2026-07-08",
      anchor: { section: "Meetings", text: "Follow up with Alex" },
    })).toEqual({ kind: "briefing-line", date: "2026-07-08", anchor: "Follow up with Alex" });
  });

  it("degrades unsupported briefing targets to none", () => {
    expect(threadContextRef({ kind: "briefing", date: "2026-07-08" })).toEqual({ kind: "none" });
    expect(threadContextRef({ kind: "briefing-section", date: "2026-07-08", section: "Meetings" }))
      .toEqual({ kind: "none" });
    expect(threadContextRef({ kind: "briefing-anchor", anchor: { text: "No date" } }))
      .toEqual({ kind: "none" });
  });
});

describe("deriveProcessorAuthor", () => {
  it("uses loop identities when the thread target maps to feedback", () => {
    expect(deriveProcessorAuthor({ kind: "loop-item", loop: "meeting-actions", itemId: "ma-1" }))
      .toBe("agent:meeting-actions");
    expect(deriveProcessorAuthor({ kind: "briefing-section", date: "2026-07-08", section: "Meetings" }))
      .toBe("agent:briefing");
  });

  it("uses the generic processor identity for non-feedback targets", () => {
    const targets: CommentTarget[] = [
      { kind: "task", id: "t-1" },
      { kind: "library", id: "lib-1" },
      { kind: "meeting", rel: "meetings/2026-07-08/standup.md" },
    ];
    expect(targets.map(deriveProcessorAuthor)).toEqual([
      "agent:processor",
      "agent:processor",
      "agent:processor",
    ]);
  });
});

describe("processThread", () => {
  it("plain reply processes the thread", async () => {
    const thread = createLoopItemThread();
    const events: ChatStreamEvent[] = [];

    const result = await processThread(thread.id, {
      runner: stubRunner({ text: "Done. Fixed the owner." }),
      vaultRoot: vaultRoot(),
      emit: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("processed");

    const reread = readThread(thread.id);
    expect(reread?.status).toBe("resolved");
    expect(reread?.messages.at(-1)?.author).toBe("agent:meeting-actions");
    expect(reread?.messages.at(-1)?.text).toBe("Done. Fixed the owner.");
    expect(reread?.resolution?.action).toBe("processed");
    expect(reread?.resolution?.by).toBe("agent:meeting-actions");

    if (!result.chatId) throw new Error("missing chatId");
    expect(readThread(thread.id)?.chat_ids).toEqual([result.chatId]);
    const chat = readChat(result.chatId);
    expect(chat?.messages).toHaveLength(2);
    expect(chat?.messages[0].role).toBe("user");
    expect(chat?.messages[0].content).toContain("fix the owner attribution");
    expect(chat?.messages[1]).toMatchObject({ role: "assistant", content: "Done. Fixed the owner." });
    expect(chat?.claudeSessionId).toBe("cli-session-1");
    expect(chat?.status).toBe("idle");
    expect(events.map((event) => event.type)).toEqual(["session", "message", "complete"]);
  });

  it("PROPOSAL marker mints and strips", async () => {
    const thread = createLoopItemThread();
    const result = await processThread(thread.id, {
      runner: stubRunner({
        text: "Justin, this needs a real refactor.\n\nPROPOSAL: Rework the owner attribution rules",
      }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("proposal-minted");
    expect(result.proposalTaskId).toMatch(/^t-/);
    if (!result.proposalTaskId) throw new Error("missing proposalTaskId");

    const proposalPath = path.join(vaultRoot(), "tasks", ".proposals", `${result.proposalTaskId}.md`);
    expect(fs.existsSync(proposalPath)).toBe(true);
    const proposal = parseTaskFile(fs.readFileSync(proposalPath, "utf-8"));
    expect(proposal.title).toBe("Rework the owner attribution rules");
    expect(proposal.origin?.thread).toBe(thread.id);

    const reread = readThread(thread.id);
    const reply = reread?.messages.at(-1)?.text ?? "";
    expect(reply).not.toContain("PROPOSAL:");
    expect(reply.endsWith(`Minted proposal ${result.proposalTaskId}.`)).toBe(true);
    expect(reread?.resolution?.action).toBe("proposal-minted");
  });

  it("DEVITEM marker diagnoses, stamps dev_item, and leaves the thread open", async () => {
    const thread = createLoopItemThread();
    const events: ChatStreamEvent[] = [];

    const result = await processThread(thread.id, {
      runner: stubRunner({
        text: "Looked at Board.tsx.\n\nDEVITEM: Filter state resets because Board remounts on refresh",
      }),
      vaultRoot: vaultRoot(),
      emit: (event) => events.push(event),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("dev-item");
    expect(result.proposalTaskId).toBeUndefined();

    const reread = readThread(thread.id);
    expect(reread?.status).toBe("open");
    expect(reread?.resolution).toBeUndefined();
    expect(reread?.dev_item?.diagnosed_at).toBeDefined();
    expect(reread?.processed).toBeDefined();
    expect(reread?.messages.at(-1)?.author).toBe("agent:meeting-actions");
    expect(reread?.messages.at(-1)?.text).toContain("Diagnosis: Filter state resets because Board remounts on refresh");
    expect(reread?.messages.at(-1)?.text).not.toContain("DEVITEM:");

    if (!result.chatId) throw new Error("missing chatId");
    const chat = readChat(result.chatId);
    const assistant = chat?.messages.at(-1);
    expect(assistant?.trace?.some((trace) => trace.label === "Dev item diagnosed")).toBe(true);
    expect(events.some((event) => event.type === "trace" && event.trace.label === "Dev item diagnosed")).toBe(true);
  });

  it("a dev-item reply cannot also mint: DEVITEM on the final line wins over a PROPOSAL line above it", async () => {
    const thread = createLoopItemThread();

    const result = await processThread(thread.id, {
      runner: stubRunner({ text: "Investigated.\nPROPOSAL: Rework the board filters\nDEVITEM: Board remounts on refresh" }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("dev-item");
    expect(result.proposalTaskId).toBeUndefined();
    expect(fs.existsSync(path.join(vaultRoot(), "tasks", ".proposals"))).toBe(false);

    const reread = readThread(thread.id);
    expect(reread?.status).toBe("open");
    expect(reread?.dev_item).toBeDefined();
    expect(reread?.messages.at(-1)?.text).not.toContain("Minted proposal");
  });

  it("DEVITEM spoof before the final line takes the normal processed path", async () => {
    const thread = createLoopItemThread();

    const result = await processThread(thread.id, {
      runner: stubRunner({ text: "Looked at Board.tsx.\nDEVITEM: fake\nmore prose" }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("processed");
    const reread = readThread(thread.id);
    expect(reread?.status).toBe("resolved");
    expect(reread?.dev_item).toBeUndefined();
  });

  it("runner failure leaves the thread open", async () => {
    const thread = createLoopItemThread();
    const result = await processThread(thread.id, {
      runner: stubRunner({ code: 1, stderr: "boom", text: "" }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("boom");

    const reread = readThread(thread.id);
    expect(reread?.status).toBe("open");
    expect(reread?.messages).toHaveLength(1);
    expect(reread?.messages.some((message) => message.author.startsWith("agent:"))).toBe(false);
    expect(reread?.resolution).toBeUndefined();
    if (!result.chatId) throw new Error("missing chatId");
    expect(reread?.chat_ids).toEqual([result.chatId]);
  });

  it("a cancelled run with partial text leaves the thread open (no truncated resolve)", async () => {
    const thread = createLoopItemThread();
    const controller = new AbortController();
    const result = await processThread(thread.id, {
      // SIGTERM'd child: close fires with a null code AND partial collected text.
      runner: async (options) => {
        controller.abort();
        options.onText?.("partial rep");
        return { collectedText: "partial rep", claudeSessionId: null, code: null, stderr: "" };
      },
      signal: controller.signal,
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("cancelled");

    const reread = readThread(thread.id);
    expect(reread?.status).toBe("open");
    expect(reread?.resolution).toBeUndefined();
    expect(reread?.processed).toBeUndefined();
    expect(reread?.messages.some((message) => message.author.startsWith("agent:"))).toBe(false);

    if (!result.chatId) throw new Error("missing chatId");
    expect(reread?.chat_ids).toEqual([result.chatId]);
    const chat = readChat(result.chatId);
    expect(chat?.status).toBe("idle");
    expect(chat?.messages.at(-1)?.content).toBe("partial rep");
  });

  it("mint failure is non-fatal: reply preserved, action stays processed (C3-3)", async () => {
    const thread = createLoopItemThread();
    // Plant a FILE where tasks/.proposals must be a directory → createProposalIn throws.
    const tasksDir = path.join(vaultRoot(), "tasks");
    fs.mkdirSync(tasksDir, { recursive: true });
    fs.writeFileSync(path.join(tasksDir, ".proposals"), "not a directory");

    const result = await processThread(thread.id, {
      runner: stubRunner({ text: "Justin, this needs a real refactor.\n\nPROPOSAL: Rework owners" }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(true);
    expect(result.action).toBe("processed");
    expect(result.proposalTaskId).toBeUndefined();
    const reread = readThread(thread.id);
    const reply = reread?.messages.at(-1)?.text ?? "";
    // The full reply INCLUDING the un-actioned marker line is preserved (nothing was minted).
    expect(reply).toContain("PROPOSAL: Rework owners");
    expect(reply).not.toContain("Minted proposal");
    expect(reread?.resolution?.action).toBe("processed");
  });

  it("processor-resolved loop thread is stamped processed so it leaves the guidance set (C3-2)", async () => {
    const thread = createLoopItemThread();
    const result = await processThread(thread.id, {
      runner: stubRunner({ text: "Reworded the ask." }),
      vaultRoot: vaultRoot(),
    });

    expect(result.ok).toBe(true);
    const reread = readThread(thread.id);
    expect(reread?.processed).toBeDefined();
    expect(reread?.status).toBe("resolved");
  });

  it("prompt carries context, thread messages, and instructions", async () => {
    const thread = createLoopItemThread();
    const capture: { prompt?: string } = {};

    await processThread(thread.id, {
      runner: stubRunner({ text: "Handled." }, capture),
      vaultRoot: vaultRoot(),
    });

    expect(capture.prompt).toContain('Context: item ma-1 from the "meeting-actions" loop in Hilt.');
    expect(capture.prompt).toContain("Thread messages:");
    expect(capture.prompt).toContain("- [justin] fix the owner attribution");
    expect(capture.prompt).toContain(PROCESSOR_INSTRUCTIONS);
  });
});

describe("POST /api/threads/[id]/process validation", () => {
  it("404s an unknown-but-valid thread id", async () => {
    const id = crypto.randomUUID();
    const response = await POST(
      new NextRequest("http://localhost/api/threads/x/process", { method: "POST" }),
      { params: Promise.resolve({ id }) },
    );
    expect(response.status).toBe(404);
  });

  it("409s a resolved thread", async () => {
    const thread = createLoopItemThread();
    resolveThread(thread.id, { action: "processed", by: "agent:meeting-actions" });

    const response = await POST(
      new NextRequest("http://localhost/api/threads/x/process", { method: "POST" }),
      { params: Promise.resolve({ id: thread.id }) },
    );
    expect(response.status).toBe(409);
  });

  it("400s a malformed thread id", async () => {
    const response = await POST(
      new NextRequest("http://localhost/api/threads/x/process", { method: "POST" }),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );
    expect(response.status).toBe(400);
  });
});
