"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Session, TreeNode, TreeMetrics } from "@/lib/types";
import * as tauri from "@/lib/tauri";

/**
 * Hook for fetching sessions in tree mode.
 * Returns sessions with child rollup and tree structure for treemap visualization.
 */
export function useTreeSessions(scopePath: string) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [counts, setCounts] = useState({ inbox: 0, active: 0, recent: 0, running: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const fetchSessions = useCallback(async () => {
    try {
      const response = await tauri.getSessions(scopePath);

      // Map Tauri response to frontend Session type
      const mappedSessions: Session[] = response.sessions.map(s => ({
        id: s.id,
        title: s.title,
        project: s.project,
        projectPath: s.projectPath || "",
        lastActivity: new Date(s.updatedAt),
        messageCount: s.messageCount,
        gitBranch: s.gitBranch || null,
        firstPrompt: s.firstPrompt || null,
        lastPrompt: s.lastPrompt || null,
        slug: s.slug || null,
        slugs: s.slugs,
        status: s.status,
        sortOrder: s.sortOrder,
        starred: s.starred,
        isRunning: s.isRunning,
        planSlugs: s.planSlugs,
        terminalId: s.terminalId,
      }));

      // Build tree structure from flat sessions
      const treeNode = buildTree(mappedSessions, scopePath);

      setSessions(mappedSessions);
      setTree(treeNode);
      setCounts(response.counts);
      setError(null);
    } catch (e) {
      setError(e as Error);
    } finally {
      setIsLoading(false);
    }
  }, [scopePath]);

  // Initial fetch and polling
  useEffect(() => {
    fetchSessions();

    intervalRef.current = setInterval(fetchSessions, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [fetchSessions]);

  // Listen for file change events from Tauri
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    tauri.onFileChanged((event) => {
      if (event.fileType === "session") {
        fetchSessions();
      }
    }).then(fn => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [fetchSessions]);

  return {
    tree,
    sessions,
    total: sessions.length,
    counts,
    isLoading,
    isError: error,
    refresh: fetchSessions,
  };
}

/**
 * Build a tree structure from a flat list of sessions
 */
function buildTree(sessions: Session[], rootPath: string): TreeNode {
  // Group sessions by their projectPath
  const pathMap = new Map<string, Session[]>();

  for (const session of sessions) {
    const path = session.projectPath || rootPath;
    if (!pathMap.has(path)) {
      pathMap.set(path, []);
    }
    pathMap.get(path)!.push(session);
  }

  // Create tree nodes
  const nodeMap = new Map<string, TreeNode>();

  // Ensure root exists
  const rootNode = createNode(rootPath, rootPath, 0);
  nodeMap.set(rootPath, rootNode);

  // Create nodes for all paths
  for (const [path, pathSessions] of pathMap) {
    if (path === rootPath) {
      rootNode.sessions = pathSessions;
      continue;
    }

    // Create intermediate nodes as needed
    let currentPath = rootPath;
    const relativePath = path.startsWith(rootPath)
      ? path.slice(rootPath.length).replace(/^\//, "")
      : path;
    const parts = relativePath.split("/").filter(Boolean);

    for (let i = 0; i < parts.length; i++) {
      const nextPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i];
      const depth = i + 1;

      if (!nodeMap.has(nextPath)) {
        const node = createNode(nextPath, parts[i], depth);
        nodeMap.set(nextPath, node);

        // Add as child of parent
        const parent = nodeMap.get(currentPath);
        if (parent) {
          parent.children.push(node);
        }
      }

      currentPath = nextPath;
    }

    // Add sessions to the leaf node
    const leafNode = nodeMap.get(path);
    if (leafNode) {
      leafNode.sessions = pathSessions;
    }
  }

  // Calculate metrics bottom-up
  calculateMetrics(rootNode);

  return rootNode;
}

function createNode(path: string, name: string, depth: number): TreeNode {
  return {
    path,
    name,
    depth,
    sessions: [],
    children: [],
    metrics: {
      totalSessions: 0,
      directSessions: 0,
      activeCount: 0,
      inboxCount: 0,
      recentCount: 0,
      runningCount: 0,
      lastActivity: 0,
      heatScore: 0,
    },
  };
}

function calculateMetrics(node: TreeNode): TreeMetrics {
  // Start with direct sessions
  const metrics: TreeMetrics = {
    totalSessions: node.sessions.length,
    directSessions: node.sessions.length,
    activeCount: node.sessions.filter(s => s.status === "active").length,
    inboxCount: node.sessions.filter(s => s.status === "inbox").length,
    recentCount: node.sessions.filter(s => s.status === "recent").length,
    runningCount: node.sessions.filter(s => s.isRunning).length,
    lastActivity: Math.max(0, ...node.sessions.map(s => s.lastActivity.getTime())),
    heatScore: 0,
  };

  // Add children's metrics
  for (const child of node.children) {
    const childMetrics = calculateMetrics(child);
    metrics.totalSessions += childMetrics.totalSessions;
    metrics.activeCount += childMetrics.activeCount;
    metrics.inboxCount += childMetrics.inboxCount;
    metrics.recentCount += childMetrics.recentCount;
    metrics.runningCount += childMetrics.runningCount;
    metrics.lastActivity = Math.max(metrics.lastActivity, childMetrics.lastActivity);
  }

  // Calculate heat score based on activity and recency
  const now = Date.now();
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  const recencyFactor = metrics.lastActivity > 0
    ? Math.exp(-(now - metrics.lastActivity) / dayMs)
    : 0;

  metrics.heatScore =
    metrics.runningCount * 10 +
    metrics.activeCount * 5 +
    metrics.inboxCount * 3 +
    metrics.recentCount * 1 +
    recencyFactor * 2;

  node.metrics = metrics;
  return metrics;
}
