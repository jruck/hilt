import { addActivityHeat, emptyActivityHeat, heatForWindow, sortSessionsByHeat } from "./activity-heat";
import type {
  ActivityWindow,
  LocalMapNode,
  LocalSession,
  LocalSessionTrackingState,
} from "./local-types";

export function makeMapNode(input: {
  id: string;
  title: string;
  kind: LocalMapNode["kind"];
  parentId?: string;
  path?: string;
  repoRemote?: string;
  branch?: string;
}): LocalMapNode {
  return {
    ...input,
    sessionIds: [],
    children: [],
    providerCounts: {},
    trackingCounts: { foreground: 0, background: 0 },
    sessionCount: 0,
    activeSessionCount: 0,
    activity: emptyActivityHeat(),
    signals: [],
  };
}

export function safeMapId(prefix: string, value: string | undefined): string {
  return `${prefix}:${encodeURIComponent(value || "unknown")}`;
}

function workItemForSession(session: LocalSession): { id: string; title: string; branch?: string } | undefined {
  const branch = session.gitBranch && !["main", "master", "trunk"].includes(session.gitBranch)
    ? session.gitBranch
    : undefined;
  if (branch) {
    return {
      id: safeMapId(`work:${session.workspaceRoot || session.workspaceLabel}`, branch),
      title: branch,
      branch,
    };
  }
  return undefined;
}

function attachSession(node: LocalMapNode, session: LocalSession) {
  node.sessionIds.push(session.id);
  node.sessionCount += 1;
  if (session.observedState === "active") node.activeSessionCount += 1;
  node.providerCounts[session.provider] = (node.providerCounts[session.provider] ?? 0) + 1;
  node.trackingCounts[session.trackingState] += 1;
  node.activity = addActivityHeat(node.activity, session.activity);
  for (const signal of session.signals) {
    if (!node.signals.includes(signal)) node.signals.push(signal);
  }
}

export function sortMapNode(node: LocalMapNode, window: ActivityWindow): LocalMapNode {
  return {
    ...node,
    children: node.children
      .map((child) => sortMapNode(child, window))
      .sort((a, b) => heatForWindow(b.activity, window) - heatForWindow(a.activity, window)),
  };
}

export function buildSessionTree(
  sessions: LocalSession[],
  activeWindow: ActivityWindow,
  options: { title?: string } = {},
): { root: LocalMapNode; workspaceCount: number; trackingCounts: Record<LocalSessionTrackingState, number>; sortedSessions: LocalSession[] } {
  const root = makeMapNode({ id: "root", title: options.title || "All matching work", kind: "root" });
  const nodes = new Map<string, LocalMapNode>([[root.id, root]]);
  const sortedSessions = sortSessionsByHeat(sessions, activeWindow);

  for (const session of sortedSessions) {
    attachSession(root, session);

    const spaceTitle = session.spaceLabel || "unmapped";
    const spaceId = safeMapId("space", spaceTitle);
    let space = nodes.get(spaceId);
    if (!space) {
      space = makeMapNode({ id: spaceId, title: spaceTitle, kind: "space", parentId: root.id });
      nodes.set(spaceId, space);
      root.children.push(space);
    }
    attachSession(space, session);

    const workspaceTitle = session.workspaceLabel || session.cwd || "Unmapped sessions";
    const workspaceId = safeMapId(`workspace:${spaceId}`, session.workspaceRoot || workspaceTitle);
    let workspace = nodes.get(workspaceId);
    if (!workspace) {
      workspace = makeMapNode({
        id: workspaceId,
        title: workspaceTitle,
        kind: "workspace",
        parentId: space.id,
        path: session.workspaceRoot || session.cwd,
        repoRemote: session.repoRemote,
      });
      nodes.set(workspaceId, workspace);
      space.children.push(workspace);
    }
    attachSession(workspace, session);

    const workItemInfo = workItemForSession(session);
    if (!workItemInfo) continue;
    let workItem = nodes.get(workItemInfo.id);
    if (!workItem) {
      workItem = makeMapNode({
        id: workItemInfo.id,
        title: workItemInfo.title,
        kind: "workItem",
        parentId: workspace.id,
        branch: workItemInfo.branch,
      });
      nodes.set(workItemInfo.id, workItem);
      workspace.children.push(workItem);
    }
    attachSession(workItem, session);
  }

  const trackingCounts = sessions.reduce<Record<LocalSessionTrackingState, number>>((acc, session) => {
    acc[session.trackingState] += 1;
    return acc;
  }, { foreground: 0, background: 0 });

  return {
    root: sortMapNode(root, activeWindow),
    workspaceCount: [...nodes.values()].filter((node) => node.kind === "workspace").length,
    trackingCounts,
    sortedSessions,
  };
}
