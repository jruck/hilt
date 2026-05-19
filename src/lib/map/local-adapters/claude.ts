import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { homedir } from "os";
import { basename, dirname, join } from "path";
import { computeActivityHeat } from "../activity-heat";
import { classifyTrackingState } from "../ignore-rules";
import type { LocalSession, ProviderAdapterResult } from "../local-types";
import { inferWorkspace } from "../workspace-grouping";

interface ClaudeJsonlRow {
  type?: string;
  sessionId?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  timestamp?: string;
  isSidechain?: boolean;
  uuid?: string;
  parentUuid?: string;
  title?: string;
  customTitle?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

interface ClaudeCodeSessionJson {
  sessionId?: string;
  cliSessionId?: string;
  cwd?: string;
  originCwd?: string;
  createdAt?: string | number;
  lastActivityAt?: string | number;
  model?: string;
  title?: string;
  permissionMode?: string;
  isArchived?: boolean;
}

export function walkFiles(root: string, predicate: (name: string) => boolean, limit = Number.POSITIVE_INFINITY): string[] {
  const results: string[] = [];
  if (!existsSync(root)) return results;

  const walk = (dir: string) => {
    if (results.length >= limit) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (results.length >= limit) return;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else if (entry.isFile() && predicate(entry.name)) {
        results.push(path);
      }
    }
  };

  walk(root);
  return results;
}

function toMs(value: string | number | undefined): number | undefined {
  if (typeof value === "number") return value > 10_000_000_000 ? value : value * 1000;
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function projectPathFromDir(dir: string): string | undefined {
  const name = basename(dir);
  if (!name.startsWith("-")) return undefined;
  return `/${name.slice(1).replaceAll("-", "/")}`;
}

function titleFromPath(path: string): string {
  return basename(dirname(path)).replace(/^-Users-jruck-?/, "").replaceAll("-", " / ") || basename(path);
}

function readableText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";

  return content.map((part) => {
    if (!part || typeof part !== "object") return "";
    const item = part as { type?: string; text?: unknown; content?: unknown };
    if (item.type === "tool_result" || item.type === "tool_use" || item.type === "thinking") return "";
    if (typeof item.text === "string") return item.text.trim();
    if (typeof item.content === "string") return item.content.trim();
    return "";
  }).filter(Boolean).join("\n").trim();
}

export function claudeAutomationReason(text: string | undefined): string | undefined {
  const value = text?.trim();
  if (!value) return undefined;
  if (/^\[cron:[^\]]+\]/i.test(value)) return "automation prompt";
  if (/^\[inter-session message\][\s\S]*\bisUser=false\b/i.test(value)) return "inter-session background message";
  if (/^read HEARTBEAT\.md if it exists\b/i.test(value)) return "heartbeat check";
  if (/^continue this conversation using the OpenClaw transcript below\b/i.test(value)) return "continued background transcript";
  if (/^\[[A-Z][a-z]{2}\s+\d{4}-\d{2}-\d{2}[^\]]+\]\s+OpenClaw update:/i.test(value)) return "OpenClaw update notice";
  if (/^Reply with exactly:\s*OK\b/i.test(value)) return "probe session";
  return undefined;
}

export function isClaudeAutomationPrompt(text: string | undefined): boolean {
  return Boolean(claudeAutomationReason(text));
}

export function isClaudeDirectUserPrompt(text: string | undefined): boolean {
  const value = text?.trim();
  if (!value || claudeAutomationReason(value)) return false;
  return /Slack DM from Justin Ruckman:/i.test(value) || !/^\s*(System(?:\s+\(untrusted\))?:|\[[^\]]+\]|Sender \(untrusted metadata\):)/i.test(value);
}

function titleFromUserText(text: string | undefined): string | undefined {
  const collapsed = text?.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;
  return collapsed.length > 90 ? `${collapsed.slice(0, 87)}...` : collapsed;
}

export function readClaudeProjectSession(path: string): LocalSession | undefined {
  let text: string;
  try {
    text = readFileSync(path, "utf-8");
  } catch {
    return undefined;
  }

  const lines = text.split("\n").filter(Boolean);
  if (lines.length === 0) return undefined;

  let sessionId = basename(path, ".jsonl");
  let cwd = projectPathFromDir(dirname(path));
  let gitBranch: string | undefined;
  let version: string | undefined;
  let title: string | undefined;
  let createdAt: number | undefined;
  let lastActivityAt: number | undefined;
  let isSidechain = false;
  let parentUuid: string | undefined;
  let eventCount = 0;
  let humanTurnCount = 0;
  let assistantTextTurnCount = 0;
  let firstHumanText: string | undefined;

  for (const line of lines) {
    let row: ClaudeJsonlRow;
    try {
      row = JSON.parse(line) as ClaudeJsonlRow;
    } catch {
      continue;
    }

    eventCount += 1;
    if (row.sessionId) sessionId = row.sessionId;
    if (row.cwd) cwd = row.cwd;
    if (row.gitBranch) gitBranch = row.gitBranch;
    if (row.version) version = row.version;
    if (row.isSidechain) isSidechain = true;
    if (row.parentUuid) parentUuid = row.parentUuid;
    if ((row.type === "custom-title" || row.type === "ai-title") && (row.title || row.customTitle || row.aiTitle)) {
      title = row.title || row.customTitle || row.aiTitle;
    }
    const messageText = readableText(row.message?.content);
    if ((row.type === "user" || row.message?.role === "user") && messageText) {
      humanTurnCount += 1;
      firstHumanText = firstHumanText ?? messageText;
    }
    if ((row.type === "assistant" || row.message?.role === "assistant") && messageText) {
      assistantTextTurnCount += 1;
    }

    const timestamp = toMs(row.timestamp);
    if (timestamp) {
      createdAt = createdAt ? Math.min(createdAt, timestamp) : timestamp;
      lastActivityAt = lastActivityAt ? Math.max(lastActivityAt, timestamp) : timestamp;
    }
  }

  const stat = statSync(path);
  lastActivityAt = lastActivityAt ?? stat.mtimeMs;
  createdAt = createdAt ?? stat.birthtimeMs;
  const workspace = inferWorkspace(cwd);
  const observedState = Date.now() - lastActivityAt < 15 * 60 * 1000 ? "active" : "idle";
  const activity = computeActivityHeat({ lastActivityAt, eventCount });
  const hasHumanSignal = humanTurnCount > 0;
  const inferredTitle = title || titleFromUserText(firstHumanText);
  const hasReadableTitle = Boolean(inferredTitle?.trim());
  const automationReason = claudeAutomationReason(firstHumanText);
  const hasAutomationPrompt = Boolean(automationReason);
  const hasDirectUserPrompt = isClaudeDirectUserPrompt(firstHumanText);
  const classification = classifyTrackingState({
    observedState,
    lastActivityAt,
    workspaceRoot: workspace.root,
    cwd,
    eventCount,
    role: isSidechain ? "worker" : "peer",
    hasHumanSignal: hasHumanSignal && hasDirectUserPrompt,
    hasReadableTitle,
    isWorkerLike: isSidechain || hasAutomationPrompt,
    automationReason,
  });

  return {
    id: `claude:project:${sessionId}`,
    provider: "claude",
    harness: "project-jsonl",
    externalId: sessionId,
    externalKey: `claude:project-jsonl:${sessionId}`,
    title: inferredTitle || titleFromPath(path),
    cwd,
    workspaceRoot: workspace.root,
    workspaceLabel: workspace.label,
    spaceLabel: workspace.spaceLabel,
    gitBranch,
    modelProvider: "anthropic",
    model: version,
    role: isSidechain ? "worker" : "peer",
    observedState,
    trackingState: classification.trackingState,
    sourcePath: path,
    createdAt,
    lastSeenAt: lastActivityAt,
    lastActivityAt,
    eventCount,
    parentExternalId: parentUuid,
    activity,
    signals: [
      "project jsonl",
      isSidechain ? "sidechain" : undefined,
      automationReason,
      hasDirectUserPrompt ? "direct user prompt" : undefined,
      humanTurnCount > 0 ? "human turns" : undefined,
      assistantTextTurnCount > 0 ? "assistant turns" : undefined,
      ...workspace.signals,
    ].filter(Boolean) as string[],
    ignoreReasons: classification.reasons,
  };
}

export function readClaudeCodeSession(path: string): LocalSession | undefined {
  let raw: ClaudeCodeSessionJson;
  try {
    raw = JSON.parse(readFileSync(path, "utf-8")) as ClaudeCodeSessionJson;
  } catch {
    return undefined;
  }

  const sessionId = raw.sessionId || raw.cliSessionId || basename(path, ".json");
  const cwd = raw.cwd || raw.originCwd;
  const createdAt = toMs(raw.createdAt);
  const lastActivityAt = toMs(raw.lastActivityAt) ?? statSync(path).mtimeMs;
  const workspace = inferWorkspace(cwd);
  const observedState = raw.isArchived ? "archived" : Date.now() - lastActivityAt < 15 * 60 * 1000 ? "active" : "idle";
  const activity = computeActivityHeat({ lastActivityAt, eventCount: 1, isArchived: raw.isArchived });
  const hasHumanSignal = Boolean(raw.title || raw.sessionId || raw.cliSessionId);
  const hasReadableTitle = Boolean(raw.title || workspace.label);
  const classification = classifyTrackingState({
    observedState,
    lastActivityAt,
    workspaceRoot: workspace.root,
    cwd,
    eventCount: 1,
    role: "peer",
    hasHumanSignal,
    hasReadableTitle,
  });

  return {
    id: `claude:code:${sessionId}`,
    provider: "claude",
    harness: "code-session-json",
    externalId: sessionId,
    externalKey: `claude:code-session-json:${sessionId}`,
    title: raw.title || workspace.label || "Claude session",
    cwd,
    workspaceRoot: workspace.root,
    workspaceLabel: workspace.label,
    spaceLabel: workspace.spaceLabel,
    modelProvider: "anthropic",
    model: raw.model,
    role: "peer",
    observedState,
    trackingState: classification.trackingState,
    sourcePath: path,
    createdAt,
    lastSeenAt: lastActivityAt,
    lastActivityAt,
    eventCount: 1,
    activity,
    signals: ["code session json", raw.permissionMode ? `permission:${raw.permissionMode}` : undefined, ...workspace.signals].filter(Boolean) as string[],
    ignoreReasons: classification.reasons,
  };
}

export async function readClaudeSessions(): Promise<ProviderAdapterResult> {
  const readAt = Date.now();
  const projectRoot = join(homedir(), ".claude", "projects");
  const appRoot = join(homedir(), "Library", "Application Support", "Claude");
  const projectFiles = walkFiles(projectRoot, (name) => name.endsWith(".jsonl"));
  const appFiles = walkFiles(appRoot, (name) => name.endsWith(".json") && name !== "config.json")
    .filter((path) => path.includes("claude-code-sessions"));

  const projectSessions = projectFiles
    .filter((path) => !path.endsWith("skill-injections.jsonl"))
    .map(readClaudeProjectSession)
    .filter((session): session is LocalSession => Boolean(session));

  const appSessions = appFiles
    .map(readClaudeCodeSession)
    .filter((session): session is LocalSession => Boolean(session));

  const statuses = [
    {
      id: "claude-projects",
      label: "Claude project JSONL",
      kind: "claude" as const,
      path: projectRoot,
      ok: existsSync(projectRoot),
      sessionCount: projectSessions.length,
      lastReadAt: readAt,
      message: existsSync(projectRoot) ? undefined : "Claude project store not found",
    },
    {
      id: "claude-code-sessions",
      label: "Claude Mac app sessions",
      kind: "claude" as const,
      path: appRoot,
      ok: existsSync(appRoot),
      sessionCount: appSessions.length,
      lastReadAt: readAt,
      message: appSessions.length > 0 ? undefined : "No claude-code-sessions JSON files found",
    },
  ];

  return {
    sessions: [...projectSessions, ...appSessions],
    statuses,
  };
}
