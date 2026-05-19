import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { computeActivityHeat } from "./activity-heat";
import { classifyTrackingState } from "./ignore-rules";
import { claudeAutomationReason, isClaudeAutomationPrompt, isClaudeDirectUserPrompt, readClaudeProjectSession } from "./local-adapters/claude";
import { hasCodexForegroundHumanSignal, isCodexAutomationLike } from "./local-adapters/codex";
import { extractClaudeProjectHistoryEntries, extractCodexHistoryEntries } from "./local-session-detail";
import type { LocalSession } from "./local-types";
import { buildSessionTree } from "./work-graph-builder";
import { inferWorkspace } from "./workspace-grouping";

function sampleSession(id: string, overrides: Partial<LocalSession> = {}): LocalSession {
  return {
    id,
    provider: "codex",
    harness: "cli",
    externalId: id,
    externalKey: id,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    workspaceLabel: "project",
    spaceLabel: "tmp",
    role: "peer",
    observedState: "idle",
    trackingState: "foreground",
    lastSeenAt: Date.now(),
    lastActivityAt: Date.now(),
    eventCount: 3,
    activity: { heat24h: 2, heat7d: 2, heat30d: 2, heatAll: 2 },
    signals: [],
    ignoreReasons: [],
    ...overrides,
  };
}

test("activity heat favors recent active work and discounts archived sessions", () => {
  const now = Date.UTC(2026, 4, 19);
  const recent = computeActivityHeat({ lastActivityAt: now - 60_000, eventCount: 20, tokenEstimate: 12_000, now });
  const old = computeActivityHeat({ lastActivityAt: now - 10 * 24 * 60 * 60 * 1000, eventCount: 20, tokenEstimate: 12_000, now });
  const archived = computeActivityHeat({ lastActivityAt: now - 60_000, eventCount: 20, tokenEstimate: 12_000, now, isArchived: true });

  assert.ok(recent.heat24h > old.heat24h);
  assert.ok(recent.heat7d > old.heat7d);
  assert.ok(archived.heat7d < recent.heat7d);
});

test("workspace inference groups known local folder patterns into spaces", () => {
  const root = join(homedir(), "work", "quality", "magnet");
  const workspace = inferWorkspace(join(root, "plans", "phase-one"));

  assert.equal(workspace.root, root);
  assert.equal(workspace.label, "magnet");
  assert.equal(workspace.spaceLabel, "work/quality");
  assert.deepEqual(workspace.signals, ["path pattern"]);
});

test("visibility rules separate foreground from background sessions", () => {
  const now = Date.now();
  assert.equal(classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    workspaceRoot: "/tmp/project",
    cwd: "/tmp/project",
    eventCount: 3,
    role: "peer",
    hasHumanSignal: true,
    hasReadableTitle: true,
  }).trackingState, "foreground");

  assert.equal(classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    cwd: undefined,
    workspaceRoot: undefined,
    eventCount: 3,
    role: "peer",
    hasHumanSignal: true,
    hasReadableTitle: true,
  }).trackingState, "background");

  const automation = classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    eventCount: 30,
    role: "peer",
    hasHumanSignal: true,
    hasReadableTitle: true,
    isWorkerLike: true,
  });

  assert.equal(automation.trackingState, "background");
  assert.deepEqual(automation.reasons, ["automation-like workspace"]);

  assert.equal(classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    eventCount: 30,
    role: "worker",
    hasHumanSignal: true,
    hasReadableTitle: true,
  }).trackingState, "background");

  assert.equal(classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    eventCount: 30,
    role: "peer",
    hasHumanSignal: true,
    hasReadableTitle: false,
  }).trackingState, "foreground");

  assert.equal(classifyTrackingState({
    observedState: "idle",
    lastActivityAt: now,
    cwd: "/tmp/project",
    workspaceRoot: "/tmp/project",
    eventCount: 30,
    role: "peer",
    hasHumanSignal: false,
    hasReadableTitle: true,
  }).trackingState, "background");

  assert.equal(classifyTrackingState({
    observedState: "archived",
    lastActivityAt: now - 30 * 24 * 60 * 60 * 1000,
    workspaceRoot: "/tmp/project",
    cwd: "/tmp/project",
    eventCount: 3,
    role: "peer",
    hasHumanSignal: true,
    hasReadableTitle: true,
  }).trackingState, "background");
});

test("Claude automation prompts stay background even when they have generated titles", () => {
  assert.equal(isClaudeAutomationPrompt("[cron:abc OpenClaw Update Check] Check for updates"), true);
  assert.equal(claudeAutomationReason("[Inter-session message] sourceSession=agent:health:main sourceTool=sessions_send isUser=false\nRouted content"), "inter-session background message");
  assert.equal(claudeAutomationReason("Read HEARTBEAT.md if it exists (workspace context). Follow it strictly."), "heartbeat check");
  assert.equal(claudeAutomationReason("Continue this conversation using the OpenClaw transcript below as prior session history."), "continued background transcript");
  assert.equal(claudeAutomationReason("[Thu 2026-05-14 10:01 EDT] OpenClaw update: 2026.5.6 -> 2026.5.7 available."), "OpenClaw update notice");
  assert.equal(claudeAutomationReason("Reply with exactly: OK"), "probe session");
  assert.equal(isClaudeAutomationPrompt("openclaw is not talking through slack correctly"), false);
  assert.equal(isClaudeDirectUserPrompt("System: [2026-04-25 10:36:34 EDT] Slack DM from Justin Ruckman: how's my garden looking"), true);
  assert.equal(isClaudeDirectUserPrompt("[Inter-session message] sourceSession=agent:health:main sourceTool=sessions_send isUser=false\nRouted content"), false);
  assert.equal(isClaudeDirectUserPrompt("openclaw is not talking through slack correctly"), true);

  const dir = mkdtempSync(join(tmpdir(), "hilt-claude-cron-"));
  const path = join(dir, "cron-session.jsonl");
  const now = new Date().toISOString();
  writeFileSync(path, [
    JSON.stringify({
      type: "user",
      sessionId: "cron-session",
      cwd: join(homedir(), ".openclaw", "workspace-home"),
      timestamp: now,
      message: { role: "user", content: "[cron:abc OpenClaw Update Check] Check for updates" },
    }),
    JSON.stringify({
      type: "ai-title",
      sessionId: "cron-session",
      aiTitle: "Check OpenClaw version updates",
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "cron-session",
      cwd: join(homedir(), ".openclaw", "workspace-home"),
      timestamp: now,
      message: { role: "assistant", content: "No update is available." },
    }),
    "",
  ].join("\n"));

  try {
    const session = readClaudeProjectSession(path);
    assert.ok(session);
    assert.equal(session.title, "Check OpenClaw version updates");
    assert.equal(session.trackingState, "background");
    assert.deepEqual(session.ignoreReasons, ["automation prompt"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Claude inter-session background messages are not promoted by user-turn rows", () => {
  const dir = mkdtempSync(join(tmpdir(), "hilt-claude-routed-"));
  const path = join(dir, "routed-session.jsonl");
  const now = new Date().toISOString();
  writeFileSync(path, [
    JSON.stringify({
      type: "user",
      sessionId: "routed-session",
      cwd: join(homedir(), ".openclaw", "workspace-health"),
      timestamp: now,
      message: {
        role: "user",
        content: "[Inter-session message] sourceSession=agent:health:main sourceChannel=heartbeat sourceTool=sessions_send isUser=false\nThis content was routed by OpenClaw from another session.",
      },
    }),
    JSON.stringify({
      type: "ai-title",
      sessionId: "routed-session",
      aiTitle: "Workspace health check-in",
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "routed-session",
      cwd: join(homedir(), ".openclaw", "workspace-health"),
      timestamp: now,
      message: { role: "assistant", content: "Logged." },
    }),
    "",
  ].join("\n"));

  try {
    const session = readClaudeProjectSession(path);
    assert.ok(session);
    assert.equal(session.trackingState, "background");
    assert.deepEqual(session.ignoreReasons, ["inter-session background message"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("Codex foreground signal handles Mac app rows while automation workspaces stay background candidates", () => {
  assert.equal(hasCodexForegroundHumanSignal({
    source: "vscode",
    thread_source: undefined,
    has_user_event: 0,
    first_user_message: "do we have sonarr and radarr installed",
  }), true);
  assert.equal(hasCodexForegroundHumanSignal({
    source: "vscode",
    thread_source: undefined,
    has_user_event: 0,
    first_user_message: "",
  }), false);
  assert.equal(isCodexAutomationLike({ cwd: "/Users/jruck/.openclaw/workspace-home" }), true);
  assert.equal(isCodexAutomationLike({ cwd: "/Users/jruck/clawd" }), true);
  assert.equal(isCodexAutomationLike({ cwd: "/Users/jruck/Documents/Codex/2026-05-19/session" }), false);
});

test("session tree includes foreground and background sessions", () => {
  const foreground = sampleSession("foreground");
  const background = sampleSession("background", {
    trackingState: "background",
    observedState: "archived",
    ignoreReasons: ["archived older than 14 days"],
  });

  const tree = buildSessionTree([foreground, background], "7d");

  assert.equal(tree.root.sessionCount, 2);
  assert.equal(tree.root.trackingCounts.foreground, 1);
  assert.equal(tree.root.trackingCounts.background, 1);
  assert.equal(tree.root.children[0].sessionCount, 2);
});

test("Codex history extraction returns user, assistant, and tool preview entries", () => {
  const entries = extractCodexHistoryEntries([
    {
      lineNo: 1,
      row: {
        timestamp: "2026-05-19T01:00:00.000Z",
        type: "event_msg",
        payload: { type: "user_message", message: "Build the local map." },
      },
    },
    {
      lineNo: 2,
      row: {
        timestamp: "2026-05-19T01:01:00.000Z",
        type: "event_msg",
        payload: { type: "agent_message", message: "I will inspect the map source." },
      },
    },
    {
      lineNo: 3,
      row: {
        timestamp: "2026-05-19T01:02:00.000Z",
        type: "response_item",
        payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"ls\"}" },
      },
    },
  ]);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].role, "user");
  assert.equal(entries[1].role, "assistant");
  assert.equal(entries[2].kind, "tool-call");
});

test("Claude project history extraction skips thinking and keeps readable text/tool entries", () => {
  const entries = extractClaudeProjectHistoryEntries([
    {
      lineNo: 1,
      row: {
        type: "user",
        timestamp: "2026-05-19T01:00:00.000Z",
        message: { role: "user", content: "Please fix the data importer." },
      },
    },
    {
      lineNo: 2,
      row: {
        type: "assistant",
        timestamp: "2026-05-19T01:01:00.000Z",
        message: {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "private chain" },
            { type: "text", text: "I found the failing parser branch." },
            { type: "tool_use", name: "Read", input: { file_path: "/tmp/importer.ts" } },
          ],
        },
      },
    },
  ]);

  assert.equal(entries.length, 3);
  assert.equal(entries[0].text, "Please fix the data importer.");
  assert.equal(entries[1].text, "I found the failing parser branch.");
  assert.equal(entries[2].kind, "tool-call");
  assert.equal(entries.some((entry) => entry.text.includes("private chain")), false);
});

test("Claude project adapter treats aiTitle as a human-readable title", () => {
  const dir = mkdtempSync(join(tmpdir(), "hilt-claude-project-"));
  const path = join(dir, "session-with-title.jsonl");
  const now = new Date().toISOString();
  writeFileSync(path, [
    JSON.stringify({
      type: "user",
      sessionId: "session-with-title",
      cwd: join(homedir(), "work", "quality", "magnet"),
      timestamp: now,
      message: { role: "user", content: "check the homebridge server status" },
    }),
    JSON.stringify({
      type: "ai-title",
      sessionId: "session-with-title",
      aiTitle: "Check Homebridge server status",
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: "session-with-title",
      cwd: join(homedir(), "work", "quality", "magnet"),
      timestamp: now,
      message: { role: "assistant", content: "The server is running." },
    }),
    "",
  ].join("\n"));

  try {
    const session = readClaudeProjectSession(path);
    assert.ok(session);
    assert.equal(session.title, "Check Homebridge server status");
    assert.equal(session.trackingState, "foreground");
    assert.deepEqual(session.ignoreReasons, []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
