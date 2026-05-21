export type LocalSessionProvider = "codex" | "claude";

export type LocalSessionRole = "orchestrator" | "worker" | "peer" | "unknown";

export type LocalSessionState = "active" | "idle" | "archived" | "unknown";

export type LocalSessionTrackingState = "foreground" | "background";

export type ActivityWindow = "24h" | "7d" | "30d" | "all";

export type MapStatusFilter = "all" | LocalSessionTrackingState;

export type MapSourceFilter = "all" | LocalSessionProvider;

export interface ActivityHeat {
  heat24h: number;
  heat7d: number;
  heat30d: number;
  heatAll: number;
}

export type WorkFootprintKind = "read" | "write" | "shell" | "search";

export interface WorkFootprintEntry {
  path: string;
  label: string;
  weight: number;
  eventCount: number;
  kinds: WorkFootprintKind[];
}

export interface LocalSession {
  id: string;
  provider: LocalSessionProvider;
  harness: string;
  externalId: string;
  externalKey: string;
  title?: string;
  cwd?: string;
  workspaceRoot?: string;
  workspaceLabel?: string;
  spaceLabel?: string;
  repoRemote?: string;
  gitBranch?: string;
  modelProvider?: string;
  model?: string;
  role: LocalSessionRole;
  observedState: LocalSessionState;
  trackingState: LocalSessionTrackingState;
  sourcePath?: string;
  createdAt?: number;
  lastSeenAt: number;
  lastActivityAt?: number;
  eventCount: number;
  tokenEstimate?: number;
  parentExternalId?: string;
  childExternalIds?: string[];
  workFootprint?: WorkFootprintEntry[];
  activity: ActivityHeat;
  signals: string[];
  ignoreReasons: string[];
}

export interface LocalSourceStatus {
  id: string;
  label: string;
  kind: "codex" | "claude" | "system";
  harness?: string;
  path: string;
  ok: boolean;
  sessionCount: number;
  lastReadAt: number;
  filesScanned?: number;
  filesChanged?: number;
  durationMs?: number;
  message?: string;
}

export interface LocalMapNode {
  id: string;
  title: string;
  kind: "root" | "space" | "workspace" | "folder" | "workItem";
  parentId?: string;
  path?: string;
  repoRemote?: string;
  branch?: string;
  sessionIds: string[];
  children: LocalMapNode[];
  providerCounts: Record<string, number>;
  trackingCounts: Record<LocalSessionTrackingState, number>;
  sessionCount: number;
  activeSessionCount: number;
  activity: ActivityHeat;
  signals: string[];
}

export interface LocalWorkGraph {
  generatedAt: number;
  activeWindow: ActivityWindow;
  root: LocalMapNode;
  sessions: LocalSession[];
  sourceStatuses: LocalSourceStatus[];
  summary: {
    totalSessions: number;
    foregroundSessions: number;
    backgroundSessions: number;
    activeSessions: number;
    workspaceCount: number;
  };
}

export interface LocalMapScanError {
  provider?: LocalSessionProvider | "system";
  path?: string;
  message: string;
}

export interface LocalMapScanDiagnostics {
  lastScanAt?: number;
  durationMs?: number;
  filesScanned: number;
  filesChanged: number;
  errors: LocalMapScanError[];
  indexedSessionCount: number;
  sourceStatuses: LocalSourceStatus[];
}

export interface LocalWorkGraphResponse {
  generatedAt: number;
  indexedAt?: number;
  activeWindow: ActivityWindow;
  root: LocalMapNode;
  summary: {
    totalSessions: number;
    foregroundSessions: number;
    backgroundSessions: number;
    activeSessions: number;
    workspaceCount: number;
  };
  statusCounts: Record<MapStatusFilter, number>;
  sourceCounts: Record<MapSourceFilter, number>;
  diagnostics: LocalMapScanDiagnostics;
}

export interface LocalSessionPage {
  generatedAt: number;
  items: Array<Omit<LocalSession, "sourcePath">>;
  total: number;
  cursor: string | null;
  nextCursor: string | null;
  limit: number;
}

export type LocalSessionHistoryRole = "user" | "assistant" | "tool" | "system" | "event";

export type LocalSessionHistoryKind = "message" | "tool-call" | "tool-result" | "event";

export interface LocalSessionHistoryEntry {
  id: string;
  role: LocalSessionHistoryRole;
  kind: LocalSessionHistoryKind;
  text: string;
  timestamp?: number;
  label?: string;
  sourceLine?: number;
  truncated?: boolean;
}

export interface LocalSessionDetail {
  session: LocalSession;
  sourcePath?: string;
  canReadHistory: boolean;
  message?: string;
  entries: LocalSessionHistoryEntry[];
  stats: {
    entriesRead: number;
    entriesReturned: number;
    omittedEntries: number;
    maxEntries: number;
    truncatedEntries: number;
  };
}

export interface ProviderAdapterResult {
  sessions: LocalSession[];
  statuses: LocalSourceStatus[];
}
