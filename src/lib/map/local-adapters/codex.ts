import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import Database from "better-sqlite3";
import { computeActivityHeat } from "../activity-heat";
import { classifyTrackingState } from "../ignore-rules";
import type { LocalSession, ProviderAdapterResult } from "../local-types";
import { inferWorkspace } from "../workspace-grouping";

interface CodexThreadRow {
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

interface CodexEdgeRow {
  parent_thread_id: string;
  child_thread_id: string;
  status: string;
}

function roleForThread(row: CodexThreadRow, parentIds: Set<string>, childIds: Set<string>) {
  if (row.agent_role === "orchestrator" || parentIds.has(row.id)) return "orchestrator";
  if (row.agent_role === "worker" || childIds.has(row.id)) return "worker";
  if (row.agent_role === "peer") return "peer";
  return "peer";
}

function harnessForRow(row: CodexThreadRow): string {
  if (row.source === "cli") return "cli";
  if (row.source === "vscode") return row.thread_source === "user" ? "desktop-remote-or-ide" : "desktop-or-ide";
  return row.source || "unknown";
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

    const parentIds = new Set(edges.map((edge) => edge.parent_thread_id));
    const childIds = new Set(edges.map((edge) => edge.child_thread_id));
    const childrenByParent = new Map<string, string[]>();
    for (const edge of edges) {
      childrenByParent.set(edge.parent_thread_id, [...(childrenByParent.get(edge.parent_thread_id) ?? []), edge.child_thread_id]);
    }

    const sessions: LocalSession[] = rows.map((row) => {
      const createdAt = row.created_at_ms || row.created_at * 1000;
      const lastActivityAt = row.updated_at_ms || row.updated_at * 1000;
      const observedState = row.archived ? "archived" : Date.now() - lastActivityAt < 15 * 60 * 1000 ? "active" : "idle";
      const workspace = inferWorkspace(row.cwd, row.git_origin_url);
      const harness = harnessForRow(row);
      const role = roleForThread(row, parentIds, childIds);
      const hasHumanSignal = hasCodexForegroundHumanSignal(row);
      const hasReadableTitle = Boolean(row.title?.trim() || row.first_user_message?.trim());
      const isWorkerLike = isCodexAutomationLike(row);
      const activity = computeActivityHeat({
        lastActivityAt,
        eventCount: 1,
        tokenEstimate: row.tokens_used,
        isArchived: observedState === "archived",
      });
      const classification = classifyTrackingState({
        observedState,
        lastActivityAt,
        workspaceRoot: workspace.root,
        cwd: row.cwd,
        eventCount: 1,
        role,
        hasHumanSignal,
        hasReadableTitle,
        isWorkerLike,
      });

      return {
        id: `codex:${row.id}`,
        provider: "codex",
        harness,
        externalId: row.id,
        externalKey: `codex:${harness}:${row.id}`,
        title: row.title || undefined,
        cwd: row.cwd || undefined,
        workspaceRoot: workspace.root,
        workspaceLabel: workspace.label,
        spaceLabel: workspace.spaceLabel,
        repoRemote: row.git_origin_url || undefined,
        gitBranch: row.git_branch || undefined,
        modelProvider: row.model_provider || undefined,
        model: row.model || undefined,
        role,
        observedState,
        trackingState: classification.trackingState,
        sourcePath: row.rollout_path || undefined,
        createdAt,
        lastSeenAt: lastActivityAt,
        lastActivityAt,
        eventCount: 1,
        tokenEstimate: row.tokens_used,
        parentExternalId: edges.find((edge) => edge.child_thread_id === row.id)?.parent_thread_id,
        childExternalIds: childrenByParent.get(row.id),
        activity,
        signals: [
          `source:${row.source || "unknown"}`,
          row.thread_source ? `thread:${row.thread_source}` : undefined,
          row.has_user_event ? "human event" : undefined,
          row.first_user_message?.trim() ? "first user message" : undefined,
          isWorkerLike ? "automation workspace" : undefined,
          ...workspace.signals,
        ].filter(Boolean) as string[],
        ignoreReasons: classification.reasons,
      };
    });

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
