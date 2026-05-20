import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { computeActivityHeat } from "../activity-heat";
import { classifyTrackingState } from "../ignore-rules";
import type { LocalSession, ProviderAdapterResult } from "../local-types";
import { readCodexWorkFootprint } from "../work-footprint";
import { inferWorkspace } from "../workspace-grouping";

const WORK_FOOTPRINT_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

export interface CodexThreadRow {
  id: string;
  rollout_path: string;
  created_at: number;
  updated_at: number;
  source: string;
  thread_source?: string;
  model_provider: string;
  cwd: string;
  title: string;
  archived: number;
  git_sha?: string;
  git_branch?: string;
  git_origin_url?: string;
  agent_role?: string;
  agent_path?: string;
  model?: string;
  tokens_used?: number;
  created_at_ms?: number;
  updated_at_ms?: number;
  has_user_event?: number;
  first_user_message?: string;
}

export interface CodexEdgeRow {
  parent_thread_id: string;
  child_thread_id: string;
  status: string;
}

export interface CodexSubagentSpawn {
  parentThreadId?: string;
  depth?: number;
  agentPath?: string | null;
  agentNickname?: string | null;
  agentRole?: string | null;
}

export interface ParsedCodexSource {
  kind: string;
  subagentSpawn?: CodexSubagentSpawn;
}

export function parseCodexSource(source?: string): ParsedCodexSource {
  const raw = source?.trim();
  if (!raw) return { kind: "unknown" };

  if (!raw.startsWith("{")) return { kind: raw };

  try {
    const parsed = JSON.parse(raw) as {
      subagent?: {
        thread_spawn?: {
          parent_thread_id?: string;
          depth?: number;
          agent_path?: string | null;
          agent_nickname?: string | null;
          agent_role?: string | null;
        };
      };
    };
    const spawn = parsed.subagent?.thread_spawn;
    if (spawn) {
      return {
        kind: "subagent",
        subagentSpawn: {
          parentThreadId: spawn.parent_thread_id,
          depth: spawn.depth,
          agentPath: spawn.agent_path,
          agentNickname: spawn.agent_nickname,
          agentRole: spawn.agent_role,
        },
      };
    }
  } catch {
    // Fall through to an opaque JSON source label.
  }

  return { kind: "json-source" };
}

function roleForThread(row: CodexThreadRow, parsedSource: ParsedCodexSource, parentIds: Set<string>, childIds: Set<string>) {
  const agentRole = row.agent_role ?? parsedSource.subagentSpawn?.agentRole;
  if (agentRole === "orchestrator" || parentIds.has(row.id)) return "orchestrator";
  if (agentRole === "worker" || childIds.has(row.id)) return "worker";
  if (agentRole === "peer") return "peer";
  return "peer";
}

function harnessForRow(row: CodexThreadRow, parsedSource: ParsedCodexSource): string {
  if (parsedSource.kind === "subagent") return "subagent";
  if (row.source === "cli") return "cli";
  if (row.source === "vscode") return row.thread_source === "user" ? "desktop-remote-or-ide" : "desktop-or-ide";
  return parsedSource.kind || "unknown";
}

export function hasCodexForegroundHumanSignal(row: {
  has_user_event?: number;
  thread_source?: string;
  source?: string;
  first_user_message?: string;
}): boolean {
  return Boolean(
    row.has_user_event ||
    row.thread_source === "user" ||
    row.source === "cli" ||
    row.first_user_message?.trim(),
  );
}

export function isCodexAutomationLike(row: { cwd?: string }): boolean {
  const normalized = row.cwd?.replaceAll("\\", "/").toLowerCase();
  if (!normalized) return false;
  const parts = normalized.split("/").filter(Boolean);
  return parts.includes(".openclaw") || parts.includes("clawd");
}

interface DerivedCodexRow {
  row: CodexThreadRow;
  parsedSource: ParsedCodexSource;
  createdAt: number;
  lastActivityAt: number;
  observedState: LocalSession["observedState"];
  workspace: ReturnType<typeof inferWorkspace>;
  harness: string;
  role: LocalSession["role"];
  hasHumanSignal: boolean;
  hasReadableTitle: boolean;
  isWorkerLike: boolean;
  parentExternalId?: string;
  childExternalIds?: string[];
  workFootprint?: LocalSession["workFootprint"];
  activity: LocalSession["activity"];
}

function classifyCodexContext(context: DerivedCodexRow, foregroundIds: Set<string>) {
  const hasForegroundParent = Boolean(context.parentExternalId && foregroundIds.has(context.parentExternalId));
  return classifyTrackingState({
    observedState: context.observedState,
    lastActivityAt: context.lastActivityAt,
    workspaceRoot: context.workspace.root,
    cwd: context.row.cwd,
    eventCount: 1,
    role: context.role,
    hasHumanSignal: context.hasHumanSignal,
    hasReadableTitle: context.hasReadableTitle,
    isWorkerLike: context.isWorkerLike,
    hasForegroundParent,
  });
}

export function mapCodexRowsToLocalSessions(rows: CodexThreadRow[], edges: CodexEdgeRow[], now = Date.now()): LocalSession[] {
  const parsedById = new Map(rows.map((row) => [row.id, parseCodexSource(row.source)]));
  const parentByChild = new Map<string, string>();
  const childrenByParent = new Map<string, string[]>();

  function addParentChild(parentId: string, childId: string) {
    if (!parentId || !childId) return;
    parentByChild.set(childId, parentId);
    childrenByParent.set(parentId, [...(childrenByParent.get(parentId) ?? []), childId]);
  }

  for (const edge of edges) {
    addParentChild(edge.parent_thread_id, edge.child_thread_id);
  }

  for (const row of rows) {
    const parentId = parsedById.get(row.id)?.subagentSpawn?.parentThreadId;
    if (parentId && !parentByChild.has(row.id)) {
      addParentChild(parentId, row.id);
    }
  }

  const parentIds = new Set(childrenByParent.keys());
  const childIds = new Set(parentByChild.keys());

  const contexts: DerivedCodexRow[] = rows.map((row) => {
    const parsedSource = parsedById.get(row.id) ?? { kind: "unknown" };
    const createdAt = row.created_at_ms || row.created_at * 1000;
    const lastActivityAt = row.updated_at_ms || row.updated_at * 1000;
    const observedState = row.archived ? "archived" : now - lastActivityAt < 15 * 60 * 1000 ? "active" : "idle";
    const workspace = inferWorkspace(row.cwd, row.git_origin_url);
    const harness = harnessForRow(row, parsedSource);
    const role = roleForThread(row, parsedSource, parentIds, childIds);
    const hasHumanSignal = hasCodexForegroundHumanSignal(row);
    const hasReadableTitle = Boolean(row.title?.trim() || row.first_user_message?.trim());
    const isWorkerLike = isCodexAutomationLike(row);
    const workFootprint = now - lastActivityAt <= WORK_FOOTPRINT_LOOKBACK_MS
      ? readCodexWorkFootprint(row.rollout_path, workspace.root, row.cwd)
      : undefined;
    const activity = computeActivityHeat({
      lastActivityAt,
      eventCount: 1,
      tokenEstimate: row.tokens_used,
      isArchived: observedState === "archived",
      now,
    });

    return {
      row,
      parsedSource,
      createdAt,
      lastActivityAt,
      observedState,
      workspace,
      harness,
      role,
      hasHumanSignal,
      hasReadableTitle,
      isWorkerLike,
      parentExternalId: parentByChild.get(row.id),
      childExternalIds: childrenByParent.get(row.id),
      workFootprint,
      activity,
    };
  });

  const foregroundIds = new Set<string>();
  for (const context of contexts) {
    const classification = classifyCodexContext(context, foregroundIds);
    if (classification.trackingState === "foreground") foregroundIds.add(context.row.id);
  }

  let changed = true;
  while (changed) {
    changed = false;
    for (const context of contexts) {
      if (foregroundIds.has(context.row.id)) continue;
      const classification = classifyCodexContext(context, foregroundIds);
      if (classification.trackingState === "foreground") {
        foregroundIds.add(context.row.id);
        changed = true;
      }
    }
  }

  return contexts.map((context) => {
    const classification = classifyCodexContext(context, foregroundIds);
    const spawn = context.parsedSource.subagentSpawn;
    const hasForegroundParent = Boolean(context.parentExternalId && foregroundIds.has(context.parentExternalId));

    return {
      id: `codex:${context.row.id}`,
      provider: "codex",
      harness: context.harness,
      externalId: context.row.id,
      externalKey: `codex:${context.harness}:${context.row.id}`,
      title: context.row.title || undefined,
      cwd: context.row.cwd || undefined,
      workspaceRoot: context.workspace.root,
      workspaceLabel: context.workspace.label,
      spaceLabel: context.workspace.spaceLabel,
      repoRemote: context.row.git_origin_url || undefined,
      gitBranch: context.row.git_branch || undefined,
      modelProvider: context.row.model_provider || undefined,
      model: context.row.model || undefined,
      role: context.role,
      observedState: context.observedState,
      trackingState: classification.trackingState,
      sourcePath: context.row.rollout_path || undefined,
      createdAt: context.createdAt,
      lastSeenAt: context.lastActivityAt,
      lastActivityAt: context.lastActivityAt,
      eventCount: 1,
      tokenEstimate: context.row.tokens_used,
      parentExternalId: context.parentExternalId,
      childExternalIds: context.childExternalIds,
      workFootprint: context.workFootprint,
      activity: context.activity,
      signals: [
        `source:${context.parsedSource.kind}`,
        context.row.thread_source ? `thread:${context.row.thread_source}` : undefined,
        context.row.has_user_event ? "human event" : undefined,
        context.row.first_user_message?.trim() ? "first user message" : undefined,
        spawn ? "subagent spawn" : undefined,
        spawn?.agentNickname ? `agent:${spawn.agentNickname}` : undefined,
        spawn?.depth !== undefined ? `subagent depth:${spawn.depth}` : undefined,
        hasForegroundParent ? "human-led parent" : undefined,
        context.isWorkerLike ? "automation workspace" : undefined,
        ...context.workspace.signals,
      ].filter(Boolean) as string[],
      ignoreReasons: classification.reasons,
    };
  });
}

export async function readCodexSessions(): Promise<ProviderAdapterResult> {
  const dbPath = join(homedir(), ".codex", "state_5.sqlite");
  const readAt = Date.now();

  if (!existsSync(dbPath)) {
    return {
      sessions: [],
      statuses: [{
        id: "codex-state",
        label: "Codex state.sqlite",
        kind: "codex",
        path: dbPath,
        ok: false,
        sessionCount: 0,
        lastReadAt: readAt,
        message: "Codex sqlite store not found",
      }],
    };
  }

  try {
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const rows = db.prepare(`
      SELECT id, rollout_path, created_at, updated_at, source, thread_source,
             model_provider, cwd, title, archived, git_sha, git_branch,
             git_origin_url, agent_role, agent_path, model, tokens_used,
             created_at_ms, updated_at_ms, has_user_event, first_user_message
      FROM threads
      ORDER BY updated_at_ms DESC
    `).all() as CodexThreadRow[];
    let edges: CodexEdgeRow[] = [];
    try {
      edges = db.prepare(`
        SELECT parent_thread_id, child_thread_id, status
        FROM thread_spawn_edges
      `).all() as CodexEdgeRow[];
    } catch {
      edges = [];
    } finally {
      db.close();
    }

    const sessions = mapCodexRowsToLocalSessions(rows, edges);

    return {
      sessions,
      statuses: [{
        id: "codex-state",
        label: "Codex sqlite metadata",
        kind: "codex",
        path: dbPath,
        ok: true,
        sessionCount: sessions.length,
        lastReadAt: readAt,
      }],
    };
  } catch (error) {
    return {
      sessions: [],
      statuses: [{
        id: "codex-state",
        label: "Codex sqlite metadata",
        kind: "codex",
        path: dbPath,
        ok: false,
        sessionCount: 0,
        lastReadAt: readAt,
        message: error instanceof Error ? error.message : "Failed to read Codex sqlite metadata",
      }],
    };
  }
}
