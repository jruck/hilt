import { getMapDb, listIndexedSessions } from "./local-index-db";
import { ensureMapIndexFresh, readMapScanDiagnostics } from "./local-indexer";
import { buildSessionTree } from "./work-graph-builder";
import type {
  ActivityWindow,
  LocalSession,
  LocalSourceStatus,
  LocalWorkGraph,
} from "./local-types";

export async function readLocalMapSessions(): Promise<{ sessions: LocalSession[]; sourceStatuses: LocalSourceStatus[] }> {
  await ensureMapIndexFresh(15_000);
  const sessions = listIndexedSessions(getMapDb(), { window: "all" });
  return {
    sessions,
    sourceStatuses: readMapScanDiagnostics().sourceStatuses,
  };
}

export async function buildLocalWorkGraph(activeWindow: ActivityWindow = "7d"): Promise<LocalWorkGraph> {
  const { sessions, sourceStatuses } = await readLocalMapSessions();
  const { root, trackingCounts, sortedSessions, workspaceCount } = buildSessionTree(sessions, activeWindow, {
    title: "All active work",
  });

  return {
    generatedAt: Date.now(),
    activeWindow,
    root,
    sessions: sortedSessions,
    sourceStatuses,
    summary: {
      totalSessions: sessions.length,
      foregroundSessions: trackingCounts.foreground,
      backgroundSessions: trackingCounts.background,
      activeSessions: sessions.filter((session) => session.observedState === "active").length,
      workspaceCount,
    },
  };
}
