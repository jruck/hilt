import { buildSessionTree } from "./work-graph-builder";
import {
  countIndexedSessions,
  getMapDb,
  listIndexedSessions,
} from "./local-index-db";
import { readMapScanDiagnostics } from "./local-indexer";
import type {
  LocalMapNode,
  LocalSession,
  LocalSessionPage,
  LocalWorkGraphResponse,
} from "./local-types";
import type { GraphQuery, SessionsQuery } from "./local-contracts";

function countWorkspaces(sessions: LocalSession[]): number {
  return new Set(sessions.map((session) => session.workspaceRoot).filter(Boolean)).size;
}

function findNode(node: LocalMapNode, nodeId: string): LocalMapNode | undefined {
  if (node.id === nodeId) return node;
  for (const child of node.children) {
    const found = findNode(child, nodeId);
    if (found) return found;
  }
  return undefined;
}

function publicGraphNode(node: LocalMapNode): LocalMapNode {
  const children = node.kind === "workspace"
    ? node.children.filter((child) => child.kind === "folder")
    : node.kind === "folder" || node.kind === "workItem"
      ? []
      : node.children;

  return {
    ...node,
    path: undefined,
    repoRemote: undefined,
    sessionIds: [],
    signals: node.signals.slice(0, 5),
    children: children.map(publicGraphNode),
  };
}

export function toPublicSession(session: LocalSession): Omit<LocalSession, "sourcePath"> {
  const publicSession: Partial<LocalSession> = { ...session };
  delete publicSession.sourcePath;
  return publicSession as Omit<LocalSession, "sourcePath">;
}

export function buildIndexedWorkGraph(query: GraphQuery): LocalWorkGraphResponse {
  const db = getMapDb();
  const sessions = listIndexedSessions(db, {
    window: query.window,
    status: query.status,
    source: query.source,
    q: query.q,
  });

  const { root, trackingCounts, workspaceCount } = buildSessionTree(sessions, query.window, {
    title: "All matching work",
  });

  return {
    generatedAt: Date.now(),
    indexedAt: readMapScanDiagnostics().lastScanAt,
    activeWindow: query.window,
    root: publicGraphNode(root),
    summary: {
      totalSessions: sessions.length,
      foregroundSessions: trackingCounts.foreground,
      backgroundSessions: trackingCounts.background,
      activeSessions: sessions.filter((session) => session.observedState === "active").length,
      workspaceCount,
    },
    statusCounts: {
      all: countIndexedSessions(db, { window: query.window, source: query.source, q: query.q }),
      foreground: countIndexedSessions(db, { window: query.window, source: query.source, status: "foreground", q: query.q }),
      background: countIndexedSessions(db, { window: query.window, source: query.source, status: "background", q: query.q }),
    },
    sourceCounts: {
      all: countIndexedSessions(db, { window: query.window, status: query.status, q: query.q }),
      codex: countIndexedSessions(db, { window: query.window, source: "codex", status: query.status, q: query.q }),
      claude: countIndexedSessions(db, { window: query.window, source: "claude", status: query.status, q: query.q }),
    },
    diagnostics: readMapScanDiagnostics(),
  };
}

export function queryIndexedSessionPage(query: SessionsQuery): LocalSessionPage {
  const db = getMapDb();
  const filters = {
    window: query.window,
    status: query.status,
    source: query.source,
    q: query.q,
  };

  const offset = Math.max(0, Number.parseInt(query.cursor || "0", 10) || 0);
  const limit = query.limit;

  if (!query.nodeId || query.nodeId === "root") {
    const total = countIndexedSessions(db, filters);
    const items = listIndexedSessions(db, {
      ...filters,
      limit,
      offset,
    }).map(toPublicSession);
    const nextOffset = offset + items.length;

    return {
      generatedAt: Date.now(),
      items,
      total,
      cursor: query.cursor,
      nextCursor: nextOffset < total ? String(nextOffset) : null,
      limit,
    };
  }

  const sessions = listIndexedSessions(db, filters);
  let narrowed = sessions;
  if (query.nodeId && query.nodeId !== "root") {
    const { root } = buildSessionTree(sessions, query.window, {
      title: "All matching work",
    });
    const node = findNode(root, query.nodeId);
    const ids = new Set(node?.sessionIds ?? []);
    narrowed = sessions.filter((session) => ids.has(session.id));
  }

  const items = narrowed.slice(offset, offset + limit).map(toPublicSession);
  const nextOffset = offset + items.length;

  return {
    generatedAt: Date.now(),
    items,
    total: narrowed.length,
    cursor: query.cursor,
    nextCursor: nextOffset < narrowed.length ? String(nextOffset) : null,
    limit,
  };
}

export function countIndexedMapSessions(): number {
  return countIndexedSessions(getMapDb());
}

export function workspaceCountForQuery(query: GraphQuery): number {
  const sessions = listIndexedSessions(getMapDb(), {
    window: query.window,
    status: query.status,
    source: query.source,
    q: query.q,
  });
  return countWorkspaces(sessions);
}
