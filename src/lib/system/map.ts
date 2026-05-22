import { graphResponseSchema, sessionsResponseSchema, type GraphQuery, type SessionsQuery } from "@/lib/map/local-contracts";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh, refreshMapIndex } from "@/lib/map/local-indexer";
import { buildIndexedWorkGraph, queryIndexedSessionPage } from "@/lib/map/local-query";
import { readLocalSessionDetail } from "@/lib/map/local-session-detail";
import type {
  ActivityHeat,
  LocalMapNode,
  LocalSession,
  LocalSessionDetail,
  LocalSessionPage,
  LocalWorkGraphResponse,
  MapSourceFilter,
  MapStatusFilter,
} from "@/lib/map/local-types";
import { discoverSystemMachines, fetchPeerJson, machineLabel } from "./peers";
import type { SystemMachine } from "./types";

const ID_SEPARATOR = "::";

interface MachineGraph {
  machine: SystemMachine;
  graph: LocalWorkGraphResponse;
}

interface MachineError {
  machine: SystemMachine;
  error: string;
}

export function systemMachineNodeId(machineId: string): string {
  return `machine:${machineId}`;
}

export function systemNodeId(machineId: string, nodeId: string): string {
  return `node:${machineId}${ID_SEPARATOR}${nodeId}`;
}

export function systemSessionId(machineId: string, sessionId: string): string {
  return `${machineId}${ID_SEPARATOR}${sessionId}`;
}

export function decodeSystemSessionId(id: string): { machineId: string; sessionId: string } | null {
  const index = id.indexOf(ID_SEPARATOR);
  if (index <= 0) return null;
  return {
    machineId: id.slice(0, index),
    sessionId: id.slice(index + ID_SEPARATOR.length),
  };
}

export function decodeSystemNodeId(nodeId: string): { machineId: string; nodeId: string } | null {
  if (nodeId.startsWith("machine:")) {
    return { machineId: nodeId.slice("machine:".length), nodeId: "root" };
  }
  if (!nodeId.startsWith("node:")) return null;
  const rest = nodeId.slice("node:".length);
  const index = rest.indexOf(ID_SEPARATOR);
  if (index <= 0) return null;
  return {
    machineId: rest.slice(0, index),
    nodeId: rest.slice(index + ID_SEPARATOR.length),
  };
}

export async function buildSystemSessionGraph(query: GraphQuery): Promise<LocalWorkGraphResponse> {
  const { graphs, errors } = await readMachineGraphs(query);
  const generatedAt = Date.now();
  const rootChildren = graphs.map(({ machine, graph }) => machineNode(machine, graph));

  const summary = {
    totalSessions: sum(graphs, ({ graph }) => graph.summary.totalSessions),
    foregroundSessions: sum(graphs, ({ graph }) => graph.summary.foregroundSessions),
    backgroundSessions: sum(graphs, ({ graph }) => graph.summary.backgroundSessions),
    activeSessions: sum(graphs, ({ graph }) => graph.summary.activeSessions),
    workspaceCount: sum(graphs, ({ graph }) => graph.summary.workspaceCount),
  };

  const root: LocalMapNode = {
    id: "root",
    title: "All machines",
    kind: "root",
    sessionIds: rootChildren.flatMap((child) => child.sessionIds),
    children: rootChildren,
    providerCounts: sumProviderCounts(graphs.map(({ graph }) => graph.root.providerCounts)),
    trackingCounts: {
      foreground: summary.foregroundSessions,
      background: summary.backgroundSessions,
    },
    sessionCount: summary.totalSessions,
    activeSessionCount: summary.activeSessions,
    activity: sumActivity(graphs.map(({ graph }) => graph.root.activity)),
    signals: ["system network"],
  };

  return graphResponseSchema.parse({
    generatedAt,
    indexedAt: maxDefined(graphs.map(({ graph }) => graph.indexedAt)),
    activeWindow: query.window,
    root,
    summary,
    statusCounts: {
      all: sum(graphs, ({ graph }) => graph.statusCounts.all),
      foreground: sum(graphs, ({ graph }) => graph.statusCounts.foreground),
      background: sum(graphs, ({ graph }) => graph.statusCounts.background),
    },
    sourceCounts: {
      all: sum(graphs, ({ graph }) => graph.sourceCounts.all),
      codex: sum(graphs, ({ graph }) => graph.sourceCounts.codex),
      claude: sum(graphs, ({ graph }) => graph.sourceCounts.claude),
    },
    diagnostics: {
      lastScanAt: maxDefined(graphs.map(({ graph }) => graph.diagnostics.lastScanAt)),
      durationMs: sum(graphs, ({ graph }) => graph.diagnostics.durationMs ?? 0),
      filesScanned: sum(graphs, ({ graph }) => graph.diagnostics.filesScanned),
      filesChanged: sum(graphs, ({ graph }) => graph.diagnostics.filesChanged),
      errors: [
        ...graphs.flatMap(({ machine, graph }) => graph.diagnostics.errors.map((error) => ({
          ...error,
          message: `${machineLabel(machine.machine)}: ${error.message}`,
        }))),
        ...errors.map(({ machine, error }) => ({
          provider: "system" as const,
          message: `${machineLabel(machine.machine)}: ${error}`,
        })),
      ],
      indexedSessionCount: sum(graphs, ({ graph }) => graph.diagnostics.indexedSessionCount),
      sourceStatuses: graphs.flatMap(({ machine, graph }) => graph.diagnostics.sourceStatuses.map((status) => ({
        ...status,
        id: `${machine.id}:${status.id}`,
        label: `${machineLabel(machine.machine)} · ${status.label}`,
      }))),
    },
  });
}

export async function querySystemSessionPage(query: SessionsQuery): Promise<LocalSessionPage> {
  const machines = await discoverSystemMachines();
  const decodedNode = decodeSystemNodeId(query.nodeId);
  const targetMachines = decodedNode
    ? machines.filter((machine) => machine.id === decodedNode.machineId)
    : machines;

  if (decodedNode && targetMachines.length === 1) {
    const machine = targetMachines[0];
    const page = await readMachineSessions(machine, {
      ...query,
      nodeId: decodedNode.nodeId,
      cursor: decodeMachineCursor(machine.id, query.cursor),
    });
    return sessionsResponseSchema.parse(namespaceSessionPage(machine, page, query.cursor ?? null));
  }

  const pages = await Promise.all(targetMachines.map(async (machine) => {
    try {
      const page = await readMachineSessions(machine, { ...query, nodeId: "root", cursor: null, limit: 200 });
      return { machine, page };
    } catch {
      return null;
    }
  }));

  const offset = numericCursor(query.cursor);
  const items = pages
    .filter((item): item is { machine: SystemMachine; page: LocalSessionPage } => !!item)
    .flatMap(({ machine, page }) => page.items.map((session) => namespaceSession(machine, session)))
    .sort((a, b) => (b.lastActivityAt || b.lastSeenAt || 0) - (a.lastActivityAt || a.lastSeenAt || 0));
  const sliced = items.slice(offset, offset + query.limit);

  return sessionsResponseSchema.parse({
    generatedAt: Date.now(),
    items: sliced,
    total: pages.reduce((total, item) => total + (item?.page.total ?? 0), 0),
    cursor: query.cursor,
    nextCursor: offset + query.limit < items.length ? String(offset + query.limit) : null,
    limit: query.limit,
  });
}

export async function readSystemSessionDetail(id: string, limit: number): Promise<LocalSessionDetail | null> {
  const decoded = decodeSystemSessionId(id);
  if (!decoded) return null;
  const machines = await discoverSystemMachines();
  const machine = machines.find((item) => item.id === decoded.machineId);
  if (!machine) return null;

  const detail = machine.self
    ? await readLocalSessionDetail(decoded.sessionId, limit)
    : await fetchPeerJson<LocalSessionDetail>(
        machine,
        `/api/map/local/session-detail?id=${encodeURIComponent(decoded.sessionId)}&limit=${limit}`,
        { timeoutMs: 10_000 },
      );

  return detail ? namespaceSessionDetail(machine, detail) : null;
}

export async function refreshSystemSessions(): Promise<{ machines: Array<{ id: string; ok: boolean; diagnostics?: unknown; error?: string }> }> {
  const machines = await discoverSystemMachines();
  const results = await Promise.all(machines.map(async (machine) => {
    try {
      if (machine.self) {
        const diagnostics = isLocalMapEnabled() ? await refreshMapIndex() : null;
        return { id: machine.id, ok: true, diagnostics };
      }
      const data = await fetchPeerJson<{ diagnostics: unknown }>(
        machine,
        "/api/map/local/refresh",
        { method: "POST", timeoutMs: 15_000 },
      );
      return { id: machine.id, ok: true, diagnostics: data.diagnostics };
    } catch (error) {
      return {
        id: machine.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  return { machines: results };
}

async function readMachineGraphs(query: GraphQuery): Promise<{ graphs: MachineGraph[]; errors: MachineError[] }> {
  const machines = await discoverSystemMachines();
  const results = await Promise.all(machines.map(async (machine) => {
    try {
      const graph = await readMachineGraph(machine, query);
      return { machine, graph };
    } catch (error) {
      return {
        machine,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }));

  return {
    graphs: results.filter((item): item is MachineGraph => "graph" in item),
    errors: results.filter((item): item is MachineError => "error" in item),
  };
}

async function readMachineGraph(machine: SystemMachine, query: GraphQuery): Promise<LocalWorkGraphResponse> {
  const params = queryParams(query);
  if (machine.self) {
    if (!isLocalMapEnabled()) throw new Error("local Map indexing is disabled");
    await ensureMapIndexFresh(15_000);
    return graphResponseSchema.parse(buildIndexedWorkGraph(query));
  }
  return graphResponseSchema.parse(await fetchPeerJson<LocalWorkGraphResponse>(
    machine,
    `/api/map/local/work-graph?${params}`,
    { timeoutMs: 8_000 },
  ));
}

async function readMachineSessions(machine: SystemMachine, query: SessionsQuery): Promise<LocalSessionPage> {
  const params = queryParams(query);
  if (machine.self) {
    if (!isLocalMapEnabled()) throw new Error("local Map indexing is disabled");
    await ensureMapIndexFresh(15_000);
    return sessionsResponseSchema.parse(queryIndexedSessionPage(query));
  }
  return sessionsResponseSchema.parse(await fetchPeerJson<LocalSessionPage>(
    machine,
    `/api/map/local/sessions?${params}`,
    { timeoutMs: 8_000 },
  ));
}

function machineNode(machine: SystemMachine, graph: LocalWorkGraphResponse): LocalMapNode {
  const id = systemMachineNodeId(machine.id);
  return {
    id,
    title: machineLabel(machine.machine),
    kind: "space",
    parentId: "root",
    path: machine.machine.tailscale_dns || machine.machine.tailscale_ip4 || machine.machine.hostname,
    sessionIds: graph.root.sessionIds.map((sessionId) => systemSessionId(machine.id, sessionId)),
    children: graph.root.children.map((child) => namespaceNode(machine.id, child, id)),
    providerCounts: graph.root.providerCounts,
    trackingCounts: graph.root.trackingCounts,
    sessionCount: graph.root.sessionCount,
    activeSessionCount: graph.root.activeSessionCount,
    activity: graph.root.activity,
    signals: [machine.self ? "this machine" : "remote hilt"],
  };
}

function namespaceNode(machineId: string, node: LocalMapNode, parentId?: string): LocalMapNode {
  const id = systemNodeId(machineId, node.id);
  return {
    ...node,
    id,
    parentId,
    sessionIds: node.sessionIds.map((sessionId) => systemSessionId(machineId, sessionId)),
    children: node.children.map((child) => namespaceNode(machineId, child, id)),
  };
}

function namespaceSessionPage(machine: SystemMachine, page: LocalSessionPage, incomingCursor: string | null): LocalSessionPage {
  return {
    ...page,
    items: page.items.map((session) => namespaceSession(machine, session)),
    cursor: incomingCursor,
    nextCursor: page.nextCursor ? encodeMachineCursor(machine.id, page.nextCursor) : null,
  };
}

function namespaceSession(
  machine: SystemMachine,
  session: Omit<LocalSession, "sourcePath">,
): Omit<LocalSession, "sourcePath"> {
  const label = machineLabel(machine.machine);
  return {
    ...session,
    id: systemSessionId(machine.id, session.id),
    signals: [...new Set([`machine:${label}`, ...session.signals])],
  };
}

function namespaceSessionDetail(machine: SystemMachine, detail: LocalSessionDetail): LocalSessionDetail {
  return {
    ...detail,
    session: {
      ...detail.session,
      id: systemSessionId(machine.id, detail.session.id),
      signals: [...new Set([`machine:${machineLabel(machine.machine)}`, ...detail.session.signals])],
    },
  };
}

function encodeMachineCursor(machineId: string, cursor: string): string {
  return `${machineId}${ID_SEPARATOR}${cursor}`;
}

function decodeMachineCursor(machineId: string, cursor?: string | null): string | null {
  if (!cursor) return null;
  const decoded = decodeSystemSessionId(cursor);
  return decoded?.machineId === machineId ? decoded.sessionId : cursor;
}

function numericCursor(cursor?: string | null): number {
  if (!cursor) return 0;
  const parsed = Number.parseInt(cursor, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function queryParams(params: Record<string, string | number | null | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "") continue;
    search.set(key, String(value));
  }
  return search.toString();
}

function sum<T>(items: T[], value: (item: T) => number): number {
  return items.reduce((total, item) => total + value(item), 0);
}

function maxDefined(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => typeof value === "number");
  return defined.length ? Math.max(...defined) : undefined;
}

function sumProviderCounts(counts: Array<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const item of counts) {
    for (const [key, value] of Object.entries(item)) {
      result[key] = (result[key] || 0) + value;
    }
  }
  return result;
}

function sumActivity(items: ActivityHeat[]): ActivityHeat {
  return {
    heat24h: items.reduce((sum, item) => sum + item.heat24h, 0),
    heat7d: items.reduce((sum, item) => sum + item.heat7d, 0),
    heat30d: items.reduce((sum, item) => sum + item.heat30d, 0),
    heatAll: items.reduce((sum, item) => sum + item.heatAll, 0),
  };
}

export function emptySystemCounts(): {
  statusCounts: Record<MapStatusFilter, number>;
  sourceCounts: Record<MapSourceFilter, number>;
} {
  return {
    statusCounts: { all: 0, foreground: 0, background: 0 },
    sourceCounts: { all: 0, codex: 0, claude: 0 },
  };
}
