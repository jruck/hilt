"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Check,
  CheckCircle2,
  ChevronLeft,
  Copy,
  Database,
  GitBranch,
  MessageSquare,
  RefreshCw,
  SlidersHorizontal,
  TerminalSquare,
  X,
} from "lucide-react";
import type {
  ActivityWindow,
  LocalMapNode,
  LocalSession,
  LocalSessionDetail,
  LocalSessionPage,
  LocalWorkGraphResponse,
  MapSourceFilter,
  MapStatusFilter,
} from "@/lib/map/local-types";
import { heatForWindow } from "@/lib/map/activity-heat";
import { SecondaryIconButton, SecondaryToolbar } from "@/components/layout/SecondaryToolbar";

const WINDOWS: ActivityWindow[] = ["24h", "7d", "30d", "all"];

const STATUS_OPTIONS: Array<{ id: MapStatusFilter; label: string; title: string }> = [
  { id: "all", label: "Total", title: "All sessions matching the current activity and source filters." },
  { id: "foreground", label: "Foreground", title: "Human-legible work: human-initiated sessions and meaningful top-level conversations." },
  { id: "background", label: "Background", title: "Disposable, worker, unmapped, or automation-like sessions kept available but out of the main picture." },
];

const SOURCE_OPTIONS: Array<{ id: MapSourceFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "codex", label: "Codex" },
  { id: "claude", label: "Claude" },
];

interface Rect {
  node: LocalMapNode;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface VisibleRect extends Rect {
  depth: number;
  hasVisibleChildren: boolean;
}

interface TreemapSize {
  width: number;
  height: number;
}

type TreemapViewport = Pick<Rect, "x" | "y" | "width" | "height">;

const MAX_INLINE_TREEMAP_DEPTH = 2;
const INLINE_CHILD_MIN_WIDTH = 190;
const INLINE_CHILD_MIN_HEIGHT = 132;
const INLINE_CHILD_MIN_AREA = 34_000;
const INLINE_CHILD_INSET = 6;
const INLINE_PARENT_HEADER_HEIGHT = 48;
const INLINE_CHILD_MIN_VIEWPORT_HEIGHT = 92;

function heat(node: LocalMapNode, window: ActivityWindow): number {
  return Math.max(heatForWindow(node.activity, window), 0.01);
}

function layoutTreemap(nodes: LocalMapNode[], window: ActivityWindow, x = 0, y = 0, width = 100, height = 100): Rect[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) return [{ node: nodes[0], x, y, width, height }];

  const sorted = [...nodes].sort((a, b) => heat(b, window) - heat(a, window));
  const total = sorted.reduce((sum, node) => sum + heat(node, window), 0);
  let running = 0;
  let splitIndex = 1;
  for (let index = 0; index < sorted.length - 1; index += 1) {
    running += heat(sorted[index], window);
    splitIndex = index + 1;
    if (running >= total / 2) break;
  }

  const first = sorted.slice(0, splitIndex);
  const second = sorted.slice(splitIndex);
  const firstTotal = first.reduce((sum, node) => sum + heat(node, window), 0);
  const ratio = firstTotal / total;

  if (width >= height) {
    const firstWidth = width * ratio;
    return [
      ...layoutTreemap(first, window, x, y, firstWidth, height),
      ...layoutTreemap(second, window, x + firstWidth, y, width - firstWidth, height),
    ];
  }

  const firstHeight = height * ratio;
  return [
    ...layoutTreemap(first, window, x, y, width, firstHeight),
    ...layoutTreemap(second, window, x, y + firstHeight, width, height - firstHeight),
  ];
}

function canShowInlineChildren(node: LocalMapNode, rect: Rect, depth: number): boolean {
  if (node.children.length === 0 || depth >= MAX_INLINE_TREEMAP_DEPTH) return false;
  if (rect.width < INLINE_CHILD_MIN_WIDTH || rect.height < INLINE_CHILD_MIN_HEIGHT) return false;

  const viewport = childViewport(rect);
  if (viewport.width < 120 || viewport.height < INLINE_CHILD_MIN_VIEWPORT_HEIGHT) return false;

  const childAreaBudget = Math.min(node.children.length, 6) * 7_500;
  return viewport.width * viewport.height >= Math.max(INLINE_CHILD_MIN_AREA, childAreaBudget);
}

function childViewport(rect: Rect): TreemapViewport {
  return {
    x: rect.x + INLINE_CHILD_INSET,
    y: rect.y + INLINE_PARENT_HEADER_HEIGHT,
    width: Math.max(0, rect.width - INLINE_CHILD_INSET * 2),
    height: Math.max(0, rect.height - INLINE_PARENT_HEADER_HEIGHT - INLINE_CHILD_INSET),
  };
}

function layoutVisibleTreemap(
  nodes: LocalMapNode[],
  window: ActivityWindow,
  viewport: TreemapViewport,
  depth = 0,
): VisibleRect[] {
  const directRects = layoutTreemap(nodes, window, viewport.x, viewport.y, viewport.width, viewport.height);
  const visible: VisibleRect[] = [];

  for (const rect of directRects) {
    const hasVisibleChildren = canShowInlineChildren(rect.node, rect, depth);
    visible.push({ ...rect, depth, hasVisibleChildren });

    if (hasVisibleChildren) {
      const viewport = childViewport(rect);
      visible.push(...layoutVisibleTreemap(rect.node.children, window, viewport, depth + 1));
    }
  }

  return visible;
}

function formatAge(timestamp?: number) {
  if (!timestamp) return "unknown";
  const diff = Date.now() - timestamp;
  const minutes = Math.max(0, Math.floor(diff / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function paramsFor(filters: {
  window: ActivityWindow;
  status: MapStatusFilter;
  source: MapSourceFilter;
  searchQuery?: string;
  nodeId?: string;
  cursor?: string | null;
  limit?: number;
}) {
  const params = new URLSearchParams({
    window: filters.window,
    status: filters.status,
    source: filters.source,
  });
  const q = filters.searchQuery?.trim();
  if (q) params.set("q", q);
  if (filters.nodeId) params.set("nodeId", filters.nodeId);
  if (filters.cursor) params.set("cursor", filters.cursor);
  if (filters.limit) params.set("limit", String(filters.limit));
  return params;
}

function walkNode(node: LocalMapNode, visit: (node: LocalMapNode) => void) {
  visit(node);
  node.children.forEach((child) => walkNode(child, visit));
}

function nodePath(node: LocalMapNode | undefined, nodeById: Map<string, LocalMapNode>): LocalMapNode[] {
  if (!node) return [];
  const path: LocalMapNode[] = [];
  const seen = new Set<string>();
  let current: LocalMapNode | undefined = node;
  while (current && !seen.has(current.id)) {
    path.unshift(current);
    seen.add(current.id);
    current = current.parentId ? nodeById.get(current.parentId) : undefined;
  }
  return path;
}

function statusIcon(status: LocalSession["trackingState"]) {
  if (status === "foreground") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />;
  return <span className="h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />;
}

function compactSessionId(id: string): string {
  if (id.length <= 34) return id;
  const parts = id.split(":");
  const tail = parts.pop() || id;
  const prefix = parts.length > 0 ? `${parts.join(":")}:` : "";
  if (tail.length <= 18) return `${prefix}${tail}`;
  return `${prefix}${tail.slice(0, 8)}...${tail.slice(-6)}`;
}

interface CachedMapViewState {
  window: ActivityWindow;
  statusFilter: MapStatusFilter;
  sourceFilter: MapSourceFilter;
  graph: LocalWorkGraphResponse | null;
  sessionPage: LocalSessionPage | null;
  sessions: Array<Omit<LocalSession, "sourcePath">>;
  selectedId: string;
  selectedSessionId: string | null;
  sessionDetail: LocalSessionDetail | null;
}

const mapViewStateCache = new Map<string, CachedMapViewState>();

function SessionIdCopy({
  sessionId,
  copied,
  onCopy,
  className = "",
}: {
  sessionId: string;
  copied: boolean;
  onCopy: () => void;
  className?: string;
}) {
  return (
    <div className={`flex min-w-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)] ${className}`}>
      <span className="shrink-0 uppercase">ID</span>
      <code className="min-w-0 flex-1 truncate rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 font-mono text-[11px] text-[var(--text-secondary)]" title={sessionId}>
        {compactSessionId(sessionId)}
      </code>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          onCopy();
        }}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
        title={copied ? "Copied session ID" : "Copy session ID"}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function SessionRow({
  session,
  selected,
  onSelect,
  copied,
  onCopyId,
}: {
  session: Omit<LocalSession, "sourcePath">;
  selected: boolean;
  onSelect: () => void;
  copied: boolean;
  onCopyId: () => void;
}) {
  return (
    <div
      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
        selected
          ? "border-blue-500 bg-blue-500/10"
          : "border-[var(--border-default)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)]"
      }`}
    >
      <button type="button" onClick={onSelect} className="block w-full text-left">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[var(--text-primary)]">
              {session.title || session.workspaceLabel || session.externalId}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-tertiary)]">
              <span>{session.provider}</span>
              <span>{session.harness}</span>
              {session.gitBranch && (
                <span className="inline-flex items-center gap-1">
                  <GitBranch className="h-3 w-3" />
                  {session.gitBranch}
                </span>
              )}
              <span>{formatAge(session.lastActivityAt)}</span>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1 rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">
            {statusIcon(session.trackingState)}
            {session.trackingState}
          </span>
        </div>
        {session.workspaceLabel && (
          <div className="mt-2 truncate text-xs text-[var(--text-secondary)]">{session.workspaceLabel}</div>
        )}
        {session.ignoreReasons.length > 0 && (
          <div className="mt-2 line-clamp-2 text-xs text-[var(--text-tertiary)]">{session.ignoreReasons.join(", ")}</div>
        )}
      </button>
      <SessionIdCopy sessionId={session.id} copied={copied} onCopy={onCopyId} className="mt-2 border-t border-[var(--border-default)] pt-2" />
    </div>
  );
}

function ActivityControl({
  value,
  onChange,
}: {
  value: ActivityWindow;
  onChange: (value: ActivityWindow) => void;
}) {
  const index = WINDOWS.indexOf(value);
  const positionForIndex = (itemIndex: number) => `${(itemIndex / (WINDOWS.length - 1)) * 100}%`;
  return (
    <div className="w-full min-w-[200px] translate-y-0.5 md:w-52">
      <div className="relative h-3 overflow-visible text-[10px] leading-3 text-[var(--text-tertiary)]">
        <div className="absolute inset-x-[7px] top-0 h-full">
          {WINDOWS.map((item, itemIndex) => (
            <button
              key={item}
              onClick={() => onChange(item)}
              style={{ left: positionForIndex(itemIndex) }}
              className={`absolute top-0 -translate-x-1/2 rounded px-1 text-center ${
                value === item ? "text-[var(--text-primary)]" : "hover:text-[var(--text-secondary)]"
              }`}
            >
              {item}
            </button>
          ))}
        </div>
      </div>
      <div className="relative h-4">
        <div className="pointer-events-none absolute inset-x-[7px] top-1 z-0 h-1.5">
          {WINDOWS.map((item, itemIndex) => (
            <span
              key={item}
              style={{ left: positionForIndex(itemIndex) }}
              className="absolute top-0 h-1.5 w-px -translate-x-1/2 bg-[var(--border-strong)]"
            />
          ))}
        </div>
        <input
          aria-label="Activity window"
          type="range"
          min={0}
          max={WINDOWS.length - 1}
          step={1}
          value={index}
          onChange={(event) => onChange(WINDOWS[Number(event.target.value)])}
          className="map-activity-range absolute inset-x-0 top-0 z-10 h-4 w-full"
        />
      </div>
    </div>
  );
}

function FilterControls({
  window,
  status,
  source,
  graph,
  onWindowChange,
  onStatusChange,
  onSourceChange,
}: {
  window: ActivityWindow;
  status: MapStatusFilter;
  source: MapSourceFilter;
  graph: LocalWorkGraphResponse | null;
  onWindowChange: (value: ActivityWindow) => void;
  onStatusChange: (value: MapStatusFilter) => void;
  onSourceChange: (value: MapSourceFilter) => void;
}) {
  return (
    <div className="flex flex-col gap-2 md:flex-row md:items-center">
      <ActivityControl value={window} onChange={onWindowChange} />
      <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        Status
        <select
          value={status}
          onChange={(event) => onStatusChange(event.target.value as MapStatusFilter)}
          className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)]"
          title={STATUS_OPTIONS.find((item) => item.id === status)?.title}
        >
          {STATUS_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} ({graph?.statusCounts[item.id] ?? 0})
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
        Source
        <select
          value={source}
          onChange={(event) => onSourceChange(event.target.value as MapSourceFilter)}
          className="h-7 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)]"
        >
          {SOURCE_OPTIONS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} ({graph?.sourceCounts[item.id] ?? 0})
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

export function MapView({
  searchQuery,
  apiBase,
  modeSwitcher,
}: {
  searchQuery?: string;
  apiBase?: string;
  modeSwitcher?: ReactNode;
}) {
  const treemapRef = useRef<HTMLDivElement | null>(null);
  const cacheKey = apiBase || "local";
  const cachedState = mapViewStateCache.get(cacheKey);
  const [window, setWindow] = useState<ActivityWindow>(() => cachedState?.window ?? "7d");
  const [statusFilter, setStatusFilter] = useState<MapStatusFilter>(() => cachedState?.statusFilter ?? "foreground");
  const [sourceFilter, setSourceFilter] = useState<MapSourceFilter>(() => cachedState?.sourceFilter ?? "all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [graph, setGraph] = useState<LocalWorkGraphResponse | null>(() => cachedState?.graph ?? null);
  const [sessionPage, setSessionPage] = useState<LocalSessionPage | null>(() => cachedState?.sessionPage ?? null);
  const [sessions, setSessions] = useState<Array<Omit<LocalSession, "sourcePath">>>(() => cachedState?.sessions ?? []);
  const [selectedId, setSelectedId] = useState(() => cachedState?.selectedId ?? "root");
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(() => cachedState?.selectedSessionId ?? null);
  const [sessionDetail, setSessionDetail] = useState<LocalSessionDetail | null>(() => cachedState?.sessionDetail ?? null);
  const [isGraphLoading, setIsGraphLoading] = useState(() => !cachedState?.graph);
  const [isSessionsLoading, setIsSessionsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isDetailLoading, setIsDetailLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null);
  const [treemapSize, setTreemapSize] = useState<TreemapSize>({ width: 0, height: 0 });

  const filterParams = useMemo(() => paramsFor({
    window,
    status: statusFilter,
    source: sourceFilter,
    searchQuery,
  }), [searchQuery, sourceFilter, statusFilter, window]);
  const graphEndpoint = apiBase ? `${apiBase}/graph` : "/api/map/local/work-graph";
  const sessionsEndpoint = apiBase || "/api/map/local/sessions";
  const detailEndpoint = apiBase ? `${apiBase}/detail` : "/api/map/local/session-detail";
  const refreshEndpoint = apiBase ? `${apiBase}/refresh` : "/api/map/local/refresh";
  const didApplyFilterReset = useRef(false);
  const lastSessionQueryKey = useRef<string | null>(null);

  const loadGraph = async () => {
    setIsGraphLoading(true);
    setError(null);
    try {
      const response = await fetch(`${graphEndpoint}?${filterParams.toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      setGraph(data as LocalWorkGraphResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load local map");
    } finally {
      setIsGraphLoading(false);
    }
  };

  const loadSessions = async (reset = true) => {
    if (!graph) return;
    const cursor = reset ? null : sessionPage?.nextCursor ?? null;
    if (!reset && !cursor) return;

    setIsSessionsLoading(true);
    try {
      const response = await fetch(`${sessionsEndpoint}?${paramsFor({
        window,
        status: statusFilter,
        source: sourceFilter,
        searchQuery,
        nodeId: selectedId,
        cursor,
        limit: 80,
      }).toString()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      const page = data as LocalSessionPage;
      setSessionPage(page);
      setSessions((current) => reset ? page.items : [...current, ...page.items]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load sessions");
    } finally {
      setIsSessionsLoading(false);
    }
  };

  useEffect(() => {
    mapViewStateCache.set(cacheKey, {
      window,
      statusFilter,
      sourceFilter,
      graph,
      sessionPage,
      sessions,
      selectedId,
      selectedSessionId,
      sessionDetail,
    });
  }, [cacheKey, graph, sessionDetail, sessionPage, selectedId, selectedSessionId, sessions, sourceFilter, statusFilter, window]);

  useEffect(() => {
    if (!didApplyFilterReset.current) {
      didApplyFilterReset.current = true;
      return;
    }
    setSelectedId("root");
    setSelectedSessionId(null);
    setSessionDetail(null);
  }, [filterParams]);

  useEffect(() => {
    void loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterParams]);

  useEffect(() => {
    const element = treemapRef.current;
    if (!element) return;

    const updateSize = () => {
      const rect = element.getBoundingClientRect();
      const next = {
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
      setTreemapSize((current) => (
        current.width === next.width && current.height === next.height ? current : next
      ));
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const nodeById = useMemo(() => {
    const map = new Map<string, LocalMapNode>();
    if (graph?.root) walkNode(graph.root, (node) => map.set(node.id, node));
    return map;
  }, [graph]);

  useEffect(() => {
    if (graph && !nodeById.has(selectedId)) {
      setSelectedId("root");
    }
  }, [graph, nodeById, selectedId]);

  useEffect(() => {
    const sessionQueryKey = `${selectedId}::${filterParams.toString()}`;
    const queryChanged = lastSessionQueryKey.current !== null && lastSessionQueryKey.current !== sessionQueryKey;
    lastSessionQueryKey.current = sessionQueryKey;
    if (queryChanged) {
      setSelectedSessionId(null);
      setSessionDetail(null);
    }
    void loadSessions(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph?.generatedAt, selectedId, filterParams]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setDetailError(null);
      setIsDetailLoading(false);
      return;
    }

    const controller = new AbortController();
    setIsDetailLoading(true);
    setDetailError(null);
    fetch(`${detailEndpoint}?id=${encodeURIComponent(selectedSessionId)}&limit=120`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
        return data as LocalSessionDetail;
      })
      .then((detail) => setSessionDetail(detail))
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setSessionDetail(null);
        setDetailError(err instanceof Error ? err.message : "Failed to load session history");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsDetailLoading(false);
      });

    return () => controller.abort();
  }, [detailEndpoint, selectedSessionId]);

  const selectedNode = nodeById.get(selectedId) ?? graph?.root;
  const selectedPath = useMemo(() => nodePath(selectedNode, nodeById), [nodeById, selectedNode]);
  const treemapParent = useMemo(() => {
    if (!graph?.root) return undefined;
    const current = nodeById.get(selectedId) ?? graph.root;
    if (current.children.length > 0) return current;
    return current.parentId ? nodeById.get(current.parentId) ?? graph.root : graph.root;
  }, [graph?.root, nodeById, selectedId]);
  const treemapRects = useMemo(() => {
    if (!treemapParent || treemapSize.width <= 0 || treemapSize.height <= 0) return [];
    return layoutVisibleTreemap(treemapParent.children, window, {
      x: 0,
      y: 0,
      width: treemapSize.width,
      height: treemapSize.height,
    });
  }, [treemapParent, treemapSize, window]);
  const selectedSessionCount = selectedNode?.sessionCount ?? graph?.summary.totalSessions ?? 0;
  const selectedTitle = selectedNode?.title ?? "All matching work";
  const hasSelectedSession = Boolean(selectedSessionId);
  const layoutColumns = hasSelectedSession
    ? "grid-cols-[minmax(220px,1fr)_minmax(270px,340px)_minmax(320px,420px)] max-lg:grid-cols-[minmax(190px,1fr)_minmax(240px,300px)_minmax(280px,360px)] max-md:grid-cols-1"
    : "grid-cols-[minmax(0,1fr)_360px] max-2xl:grid-cols-[minmax(0,1fr)_330px] max-md:grid-cols-1";

  const refresh = async () => {
    setIsRefreshing(true);
    setError(null);
    try {
      const response = await fetch(refreshEndpoint, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error || `Request failed: ${response.status}`);
      await loadGraph();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh local map");
    } finally {
      setIsRefreshing(false);
    }
  };

  const copySessionId = async (sessionId: string) => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopiedSessionId(sessionId);
      globalThis.setTimeout(() => {
        setCopiedSessionId((current) => current === sessionId ? null : current);
      }, 1600);
    } catch {
      setCopiedSessionId(null);
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <div>
        <SecondaryToolbar
          left={
            modeSwitcher ? (
              modeSwitcher
            ) : (
              <div className="flex min-w-0 items-center gap-3">
                <button
                  onClick={() => setFiltersOpen((open) => !open)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] lg:hidden"
                >
                  {filtersOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
                  Filters
                </button>
                <div className="hidden lg:block">
                  <FilterControls
                    graph={graph}
                    source={sourceFilter}
                    status={statusFilter}
                    window={window}
                    onSourceChange={setSourceFilter}
                    onStatusChange={setStatusFilter}
                    onWindowChange={setWindow}
                  />
                </div>
              </div>
            )
          }
          right={
            <>
              {modeSwitcher ? (
                <>
                  <button
                    onClick={() => setFiltersOpen((open) => !open)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] xl:hidden"
                  >
                    {filtersOpen ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
                    Filters
                  </button>
                  <div className="hidden xl:block">
                    <FilterControls
                      graph={graph}
                      source={sourceFilter}
                      status={statusFilter}
                      window={window}
                      onSourceChange={setSourceFilter}
                      onStatusChange={setStatusFilter}
                      onWindowChange={setWindow}
                    />
                  </div>
                </>
              ) : null}
              <div className="hidden min-w-0 max-w-[340px] items-center justify-end gap-2 text-right text-xs text-[var(--text-tertiary)] min-[1120px]:flex">
                <span className="truncate font-medium text-[var(--text-secondary)]">{selectedTitle}</span>
                <span>{selectedSessionCount} sessions</span>
                <span>/</span>
                <span>{graph?.summary.workspaceCount ?? 0} workspaces</span>
              </div>
              <SecondaryIconButton
                onClick={() => setDiagnosticsOpen((open) => !open)}
                active={diagnosticsOpen}
                title="Diagnostics"
              >
                <Database className="h-4 w-4" />
              </SecondaryIconButton>
              <SecondaryIconButton
                onClick={() => void refresh()}
                title="Refresh index"
              >
                <RefreshCw className={`h-4 w-4 ${isGraphLoading || isRefreshing ? "animate-spin" : ""}`} />
              </SecondaryIconButton>
            </>
          }
        />

        {filtersOpen && (
          <div className={`border-b border-[var(--border-default)] px-3 py-2 ${modeSwitcher ? "xl:hidden" : "lg:hidden"}`}>
            <FilterControls
              graph={graph}
              source={sourceFilter}
              status={statusFilter}
              window={window}
              onSourceChange={(value) => {
                setSourceFilter(value);
                setFiltersOpen(false);
              }}
              onStatusChange={(value) => {
                setStatusFilter(value);
                setFiltersOpen(false);
              }}
              onWindowChange={(value) => {
                setWindow(value);
                setFiltersOpen(false);
              }}
            />
          </div>
        )}

        {diagnosticsOpen && graph?.diagnostics && (
          <div className="border-b border-[var(--border-default)] bg-[var(--bg-primary)] p-2 text-xs text-[var(--text-secondary)]">
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              <span>{graph.diagnostics.indexedSessionCount} indexed</span>
              <span>{graph.diagnostics.filesScanned} files scanned</span>
              <span>{graph.diagnostics.filesChanged} changed</span>
              <span>{graph.diagnostics.durationMs ?? 0}ms</span>
              {graph.diagnostics.errors.length > 0 && <span className="text-red-600">{graph.diagnostics.errors.length} errors</span>}
            </div>
            <details className="mt-2">
              <summary className="cursor-pointer text-[var(--text-tertiary)]">Source diagnostics</summary>
              <div className="mt-2 space-y-1">
                {graph.diagnostics.sourceStatuses.map((status) => (
                  <div key={status.id} className="grid gap-1 rounded bg-[var(--bg-secondary)] p-2 md:grid-cols-[180px_1fr_auto]">
                    <span className="font-medium text-[var(--text-primary)]">{status.label}</span>
                    <span className="truncate">{status.path}</span>
                    <span>{status.sessionCount} sessions</span>
                    {status.message && <span className="md:col-span-3 text-amber-600">{status.message}</span>}
                  </div>
                ))}
                {graph.diagnostics.errors.map((item, index) => (
                  <div key={`${item.path}-${index}`} className="rounded bg-red-500/10 p-2 text-red-600">
                    {item.path ? `${item.path}: ` : ""}{item.message}
                  </div>
                ))}
              </div>
            </details>
          </div>
        )}
      </div>

      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-3 py-2 text-xs text-red-600">
          {graph ? "Could not refresh map: " : ""}{error}
        </div>
      ) : null}

      <div className={`grid min-h-0 flex-1 ${layoutColumns}`}>
          <main className="flex min-h-0 flex-col overflow-hidden">
            <div className="flex min-h-[420px] flex-1 flex-col overflow-hidden px-3 pb-3 pt-[13px]">
              {selectedId !== "root" && selectedPath.length > 0 && (
                <div className="mb-2 flex min-h-7 min-w-0 items-center gap-1 text-xs text-[var(--text-tertiary)]">
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId("root");
                      setSelectedSessionId(null);
                    }}
                    className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md border border-[var(--border-default)] px-2 font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  >
                    <ChevronLeft className="h-3.5 w-3.5" />
                    All
                  </button>
                  <div className="flex min-w-0 items-center gap-1 overflow-hidden">
                    {selectedPath.slice(1).map((node, index) => (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => {
                          setSelectedId(node.id);
                          setSelectedSessionId(null);
                        }}
                        className={`min-w-0 truncate rounded px-1.5 py-1 hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] ${
                          index === selectedPath.length - 2 ? "text-[var(--text-secondary)]" : ""
                        }`}
                        title={node.title}
                      >
                        {node.title}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <div ref={treemapRef} className="relative min-h-[360px] flex-1">
                {treemapRects.map((rect) => {
                  const selected = rect.node.id === selectedId;
                  const isNested = rect.depth > 0;
                  const isTiny = rect.width < 120 || rect.height < 74;
                  const showMeta = rect.height >= 74 && rect.width >= 120;
                  const showKind = rect.height >= 92 && rect.width >= 150;
                  return (
                    <button
                      key={rect.node.id}
                      onClick={() => {
                        setSelectedId((current) => current === rect.node.id ? "root" : rect.node.id);
                        setSelectedSessionId(null);
                      }}
                      className={`absolute overflow-hidden border text-left transition-colors ${
                        selected
                          ? "border-blue-500 bg-blue-500/15"
                          : isNested
                            ? "border-[var(--border-subtle)] bg-[var(--bg-primary)]/90 hover:bg-[var(--bg-tertiary)]"
                            : "border-[var(--border-default)] bg-[var(--bg-elevated)] hover:bg-[var(--bg-tertiary)]"
                      }`}
                      style={{
                        left: rect.x,
                        top: rect.y,
                        width: rect.width,
                        height: rect.height,
                        zIndex: rect.depth * 10 + (selected ? 3 : 1),
                      }}
                    >
                      <div className={`flex h-full flex-col ${rect.hasVisibleChildren ? "justify-start p-1.5" : "justify-between p-2"}`}>
                        <div className="min-w-0">
                          <div className={`truncate font-semibold ${isNested || isTiny ? "text-xs" : "text-sm"}`}>{rect.node.title}</div>
                          {showKind && (
                            <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">
                              {rect.hasVisibleChildren ? `${rect.node.children.length} areas` : rect.node.kind}
                            </div>
                          )}
                        </div>
                        {showMeta && !rect.hasVisibleChildren && (
                          <div className="flex items-center justify-between gap-2 text-xs text-[var(--text-secondary)]">
                            <span>{rect.node.sessionCount} sessions</span>
                            {rect.node.activeSessionCount > 0 && <span>{rect.node.activeSessionCount} active</span>}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
                {!isGraphLoading && graph?.summary.totalSessions === 0 && (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[var(--text-secondary)]">
                    No sessions match the current filters.
                  </div>
                )}
                {!isGraphLoading && !graph && (
                  <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-[var(--text-secondary)]">
                    No map data available.
                  </div>
                )}
                {isGraphLoading && !graph && (
                  <div className="absolute inset-0 grid place-items-center bg-[var(--bg-secondary)]/70 text-sm text-[var(--text-secondary)]">
                    Loading map...
                  </div>
                )}
              </div>
            </div>
          </main>

          <aside className={`${selectedId === "root" ? "max-md:hidden" : ""} min-h-0 overflow-auto bg-[var(--bg-primary)] px-3 pb-3 pt-[13px]`}>
            <button
              onClick={() => {
                setSelectedId("root");
                setSelectedSessionId(null);
              }}
              className="mb-3 inline-flex items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 py-1.5 text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] lg:hidden"
            >
              <ChevronLeft className="h-4 w-4" />
              Tree
            </button>

            <div className="mb-3 border-b border-[var(--border-default)] pb-3">
              <div className="text-sm font-semibold">{selectedNode?.title ?? "All matching work"}</div>
              <div className="mt-1 text-xs text-[var(--text-tertiary)]">
                {sessionPage?.total ?? 0} sessions
              </div>
              {selectedNode?.signals && selectedNode.signals.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {selectedNode.signals.slice(0, 8).map((signal) => (
                    <span key={signal} className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-xs text-[var(--text-secondary)]">{signal}</span>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              {sessions.map((session) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  selected={session.id === selectedSessionId}
                  onSelect={() => setSelectedSessionId((current) => current === session.id ? null : session.id)}
                  copied={copiedSessionId === session.id}
                  onCopyId={() => void copySessionId(session.id)}
                />
              ))}
              {!isSessionsLoading && sessions.length === 0 && (
                <div className="rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] p-4 text-sm text-[var(--text-secondary)]">
                  No sessions match this tree selection.
                </div>
              )}
              {sessionPage?.nextCursor && (
                <button
                  onClick={() => void loadSessions(false)}
                  className="w-full rounded-md border border-[var(--border-default)] px-3 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  disabled={isSessionsLoading}
                >
                  {isSessionsLoading ? "Loading..." : "Load more"}
                </button>
              )}
            </div>
          </aside>

          {selectedSessionId && (
            <aside className="min-h-0 overflow-auto bg-[var(--bg-primary)] px-3 pb-3 pt-[13px]">
              <div>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-2">
                    <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                      <MessageSquare className="h-4 w-4 text-[var(--text-tertiary)]" />
                      <span className="truncate">History preview</span>
                    </div>
                    <SessionIdCopy
                      sessionId={selectedSessionId}
                      copied={copiedSessionId === selectedSessionId}
                      onCopy={() => void copySessionId(selectedSessionId)}
                    />
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {sessionDetail && (
                      <span className="text-xs text-[var(--text-tertiary)]">
                        {sessionDetail.stats.entriesReturned}/{sessionDetail.stats.entriesRead}
                      </span>
                    )}
                    <button
                      onClick={() => setSelectedSessionId(null)}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[var(--border-default)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)]"
                      title="Close history preview"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                {isDetailLoading && (
                  <div className="mt-3 text-sm text-[var(--text-secondary)]">Loading session history...</div>
                )}

                {detailError && (
                  <div className="mt-3 rounded border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-600">{detailError}</div>
                )}

                {!isDetailLoading && !detailError && sessionDetail?.message && (
                  <div className="mt-3 rounded bg-[var(--bg-tertiary)] p-3 text-sm text-[var(--text-secondary)]">{sessionDetail.message}</div>
                )}

                {!isDetailLoading && !detailError && sessionDetail && (
                  <div className="mt-3 max-h-[calc(100vh-220px)] space-y-2 overflow-auto pr-1">
                    {sessionDetail.entries.map((entry) => (
                      <div key={entry.id} className="rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] p-2">
                        <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                          <span className="inline-flex items-center gap-1 font-medium text-[var(--text-secondary)]">
                            {entry.kind === "tool-call" || entry.kind === "tool-result"
                              ? <TerminalSquare className="h-3 w-3" />
                              : <MessageSquare className="h-3 w-3" />}
                            {entry.label || entry.role}
                          </span>
                          <span className="shrink-0 text-[var(--text-tertiary)]">
                            {entry.timestamp ? formatAge(entry.timestamp) : entry.kind}
                          </span>
                        </div>
                        <pre className="whitespace-pre-wrap break-words font-sans text-xs leading-relaxed text-[var(--text-primary)]">{entry.text}</pre>
                      </div>
                    ))}
                    {sessionDetail.entries.length === 0 && !sessionDetail.message && (
                      <div className="rounded bg-[var(--bg-tertiary)] p-3 text-sm text-[var(--text-secondary)]">
                        No readable message history found.
                      </div>
                    )}
                  </div>
                )}
              </div>
            </aside>
          )}
      </div>
    </div>
  );
}
