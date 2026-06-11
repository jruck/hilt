"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Loader2, Network } from "lucide-react";
import { SecondaryToolbar } from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScope } from "@/contexts/ScopeContext";
import { isGraphEnabled } from "@/lib/graph/config";
import type { GraphScope } from "@/lib/graph/types";
import { libraryItemScope } from "@/lib/library/url";
import { budgetForDevice, type GraphBudget } from "./device-budget";
import { filterDecodedByEdgeKinds, filterDecodedByTypes } from "./decode";
import { CosmosRenderer } from "./CosmosRenderer";
import { GraphInspector, type InspectorTarget } from "./GraphInspector";
import { GraphLegendPanel } from "./GraphLegendPanel";
import { GraphToolbar } from "./GraphToolbar";
import { NODE_TYPE_BY_ORDINAL, effectiveHiddenSet, effectiveHiddenTypes } from "./graph-labels";
import { buildGraphScope, parseGraphScope } from "./graph-deeplink";
import type { GraphEdgeKind, GraphNodeType } from "@/lib/graph/types";
import {
  buildColorBuffer,
  buildSizeBuffer,
  currentTheme,
  degreesFromLinks,
  labelLODForDevice,
  resolveLinkColor,
} from "./graph-style";
import { PHYSICS_DEFAULTS, type GraphRenderer, type NodeMeta, type PhysicsTuning } from "./renderer";
import { useGraphData } from "./useGraphData";
import { useGraphMeta } from "./useGraphMeta";
import { withBasePath } from "@/lib/base-path";

interface GraphViewProps {
  searchQuery?: string;
  modeSwitcher?: ReactNode;
  /** Path tail after "graph" (e.g. "focus/<enc>/local"). Parsed by graph-deeplink. */
  scopePath?: string;
}

/** Stale-focus banner cases (deleted/expired/not-yet-indexed nodes). */
type FocusFallback = { focusId: string; reason: "missing" } | null;

/** localStorage keys for the legend mixer's hide/solo state (node types + edge kinds). */
const HIDDEN_TYPES_KEY = "hilt-graph-hidden-types";
const SOLO_TYPES_KEY = "hilt-graph-solo-types";
const HIDDEN_EDGES_KEY = "hilt-graph-hidden-edge-kinds";
const SOLO_EDGES_KEY = "hilt-graph-solo-edge-kinds";
const PHYSICS_KEY = "hilt-graph-physics";

/** Persist any string set; tolerate storage failure. */
function persistStringSet(key: string, set: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** The synthetic topic-label fallback — placeholder-named topics get no label priority. */
const PLACEHOLDER_TOPIC_LABEL = /^Theme L\d+-\d+$/;

function loadTypeSet(key: string): Set<GraphNodeType> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(key);
    return new Set(raw ? (JSON.parse(raw) as GraphNodeType[]) : []);
  } catch {
    return new Set();
  }
}

/** Persist a type set; tolerate storage failure (private mode etc. — session still works). */
function persistTypeSet(key: string, set: Set<GraphNodeType>): void {
  try {
    window.localStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

/** Toggle `type` in a copy of `prev` (null = clear) and persist; returns the new set. */
function toggleInPersistedSet(prev: Set<GraphNodeType>, type: GraphNodeType | null, key: string): Set<GraphNodeType> {
  const next = type === null ? new Set<GraphNodeType>() : new Set(prev);
  if (type !== null) {
    if (next.has(type)) next.delete(type);
    else next.add(type);
  }
  persistTypeSet(key, next);
  return next;
}

/**
 * Knowledge graph (System -> Graph), desktop-first cosmos.gl (WebGL2) renderer.
 *
 * Rendered only when isGraphEnabled() is true (the render branch in SystemView is
 * flag-gated). cosmos.gl/luma.gl touch window/document at import time, so this is
 * loaded via dynamic(..., { ssr: false }) and stays client-only.
 *
 * First-run state machine (gates the canvas on real layout — never seeds a hairball):
 *  - enabled === false           -> disabled empty state, no WebGL context.
 *  - builtAt === null & building  -> "Building graph index…" progress panel.
 *  - layoutDisabled               -> render hash positions + "layout disabled" badge.
 *  - builtAt != null              -> fetch binary, mount canvas, freeze.
 */
export function GraphView({ modeSwitcher, scopePath = "" }: GraphViewProps) {
  const enabled = isGraphEnabled();
  const isMobile = useIsMobile();
  const { navigateTo } = useScope();

  // Device budget (default scope, DPR, LOD).
  const budget = useMemo<GraphBudget>(() => {
    const isElectron =
      typeof window !== "undefined" &&
      (window as unknown as { electronAPI?: { isElectron?: boolean } }).electronAPI?.isElectron === true;
    return budgetForDevice({
      isElectron,
      isMobile,
      viewportWidth: typeof window !== "undefined" ? window.innerWidth : 1440,
      devicePixelRatio: typeof window !== "undefined" ? window.devicePixelRatio : 1,
    });
  }, [isMobile]);

  // Deep-link parse (focus id + optional forced scope).
  const parsed = useMemo(() => parseGraphScope(scopePath), [scopePath]);

  // Jetsam guardrail: coerce a forced/default "global" scope to "local" on any
  // device that may not hold the whole-vault buffer (mobile). This protects the
  // deep-link path (e.g. /system/graph/global tapped on a phone) AND the device
  // default. allowGlobal is true on desktop/tablet so they are unaffected.
  const coerceScope = useCallback(
    (next: GraphScope): GraphScope => (next === "global" && !budget.allowGlobal ? "local" : next),
    [budget.allowGlobal],
  );

  const [scope, setScope] = useState<GraphScope>(() => coerceScope(parsed.scope ?? budget.defaultScope));
  const [showTags, setShowTags] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // Per-type visibility mixer (legend panel): hide + SOLO, audio-console semantics —
  // any solo shows ONLY the soloed types (multi-solo unions) and suspends hides.
  // Both persisted so a curated view survives reloads.
  const [hiddenTypes, setHiddenTypes] = useState<Set<GraphNodeType>>(() => loadTypeSet(HIDDEN_TYPES_KEY));
  const [soloTypes, setSoloTypes] = useState<Set<GraphNodeType>>(() => loadTypeSet(SOLO_TYPES_KEY));
  const toggleType = useCallback((type: GraphNodeType) => {
    setHiddenTypes((prev) => toggleInPersistedSet(prev, type, HIDDEN_TYPES_KEY));
  }, []);
  // Solo is single-select: clicking a type solos exactly it (replacing any prior solo);
  // clicking the soloed type again clears. (effectiveHiddenTypes handles any set shape,
  // but the UI only ever produces 0 or 1.)
  const toggleSolo = useCallback((type: GraphNodeType) => {
    setSoloTypes((prev) => {
      const next = prev.has(type) ? new Set<GraphNodeType>() : new Set<GraphNodeType>([type]);
      persistTypeSet(SOLO_TYPES_KEY, next);
      return next;
    });
  }, []);
  // Edge-kind mixer (same hide/solo semantics; soloing an edge kind shows ONLY that
  // connection family — the node set is untouched).
  const [hiddenEdgeKinds, setHiddenEdgeKinds] = useState<Set<GraphEdgeKind>>(
    () => loadTypeSet(HIDDEN_EDGES_KEY) as unknown as Set<GraphEdgeKind>,
  );
  const [soloEdgeKinds, setSoloEdgeKinds] = useState<Set<GraphEdgeKind>>(
    () => loadTypeSet(SOLO_EDGES_KEY) as unknown as Set<GraphEdgeKind>,
  );
  const toggleEdgeKind = useCallback((kind: GraphEdgeKind) => {
    setHiddenEdgeKinds((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      persistStringSet(HIDDEN_EDGES_KEY, next);
      return next;
    });
  }, []);
  const toggleEdgeSolo = useCallback((kind: GraphEdgeKind) => {
    setSoloEdgeKinds((prev) => {
      const next = prev.has(kind) ? new Set<GraphEdgeKind>() : new Set<GraphEdgeKind>([kind]);
      persistStringSet(SOLO_EDGES_KEY, next);
      return next;
    });
  }, []);
  const resetTypeFilters = useCallback(() => {
    setHiddenTypes(() => toggleInPersistedSet(new Set(), null, HIDDEN_TYPES_KEY));
    setSoloTypes(() => toggleInPersistedSet(new Set(), null, SOLO_TYPES_KEY));
    setHiddenEdgeKinds(() => {
      const next = new Set<GraphEdgeKind>();
      persistStringSet(HIDDEN_EDGES_KEY, next);
      return next;
    });
    setSoloEdgeKinds(() => {
      const next = new Set<GraphEdgeKind>();
      persistStringSet(SOLO_EDGES_KEY, next);
      return next;
    });
  }, []);
  // Reflow (explicit + ephemeral): client-side GPU settle over the CURRENT visible
  // subset. Any data/filter change supersedes it and restores canonical positions.
  const [reflowing, setReflowing] = useState(false);
  const [reflowed, setReflowed] = useState(false);
  // Live simulation toggle: continuous physics until switched off. Deliberately
  // session-only (never persisted) — a standing GPU load shouldn't survive a reload.
  const [liveSim, setLiveSim] = useState(false);
  const liveSimRef = useRef(false);
  liveSimRef.current = liveSim;
  // Physics dials (persisted): feed reflow + live; live-applies while the sim runs.
  const [physics, setPhysics] = useState<PhysicsTuning>(() => {
    if (typeof window === "undefined") return { ...PHYSICS_DEFAULTS };
    try {
      const raw = window.localStorage.getItem(PHYSICS_KEY);
      return raw ? { ...PHYSICS_DEFAULTS, ...(JSON.parse(raw) as Partial<PhysicsTuning>) } : { ...PHYSICS_DEFAULTS };
    } catch {
      return { ...PHYSICS_DEFAULTS };
    }
  });
  const physicsRef = useRef(physics);
  physicsRef.current = physics;
  const handlePhysicsChange = useCallback((next: PhysicsTuning) => {
    setPhysics(next);
    rendererRef.current?.setPhysicsTuning(next);
    try {
      window.localStorage.setItem(PHYSICS_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);
  const [focusFallback, setFocusFallback] = useState<FocusFallback>(null);
  // Inspector selection: a click selects (opens the inspector) rather than navigating
  // away, so the graph stays explorable. selectedIndexRef keeps the canvas highlight
  // "sticky" under hover; selectedNodeRef survives data refetches for re-highlight.
  const [selectedNode, setSelectedNode] = useState<InspectorTarget | null>(null);
  const selectedNodeRef = useRef<InspectorTarget | null>(null);
  selectedNodeRef.current = selectedNode;
  const selectedIndexRef = useRef<number | null>(null);

  // Keep scope in sync when the URL forces one or device default changes.
  useEffect(() => {
    setScope(coerceScope(parsed.scope ?? budget.defaultScope));
  }, [parsed.scope, budget.defaultScope, coerceScope]);

  const meta = useGraphMeta(enabled);
  const ready = enabled && !!meta.meta && meta.meta.builtAt != null;
  const layoutDisabled = meta.meta?.layoutState === "stale" && meta.meta?.lastError != null;

  // For a local-scope deep-link, the focus id is the anchor. Local is a drill-in reached by
  // focusing a node; depth is a fixed 2-hop neighborhood (no user-facing hop control).
  const anchorId = scope === "local" ? parsed.focusId : null;
  const graphData = useGraphData(
    enabled,
    ready,
    { scope, nodeId: anchorId, hops: 2, includeTags: showTags },
    meta.payloadToken,
  );

  // Renderer instance (one Graph, managed across data refetches via setData).
  // The canvas container only renders in the "ready" body branch, and refs populate
  // AFTER the render that mounts it — which can land on a later tick than the one
  // where `ready` first flips true (e.g. while the payload is still loading). So we
  // track the element via a callback ref + state and key the mount effect off that,
  // rather than [enabled, ready] (which would miss the late container attach).
  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);
  const rendererRef = useRef<GraphRenderer | null>(null);
  const metaArrRef = useRef<NodeMeta[]>([]);
  const idToIndexRef = useRef<Map<string, number>>(new Map());
  const zoomRef = useRef(1);
  const [hoverLabel, setHoverLabel] = useState<string | null>(null);
  // The label SET (the top-K hubs) changes rarely (on data load); it's rendered through
  // React once. Their on-screen POSITIONS change every pan/zoom and are applied
  // imperatively to the DOM nodes — never via setState — to avoid per-frame React churn
  // (the prior per-frame setLabels was the main source of pan jank).
  const [labelSet, setLabelSet] = useState<{ id: string; label: string; index: number }[]>([]);
  const labelSetRef = useRef<{ id: string; label: string; index: number }[]>([]);
  const labelElsRef = useRef<Map<string, HTMLDivElement | null>>(new Map());
  const repositionRafRef = useRef<number | null>(null);

  const reposition = useCallback(() => {
    const renderer = rendererRef.current;
    const el = containerEl;
    if (!renderer || !el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    const posByIndex = new Map<number, { x: number; y: number; radius: number }>();
    for (const p of renderer.getLabelScreenPositions()) posByIndex.set(p.index, p);
    // Highest-degree first; greedily hide any label colliding with a more-important one.
    const placed: { x: number; y: number }[] = [];
    const MIN_DX = 70;
    const MIN_DY = 13;
    for (const lbl of labelSetRef.current) {
      const node = labelElsRef.current.get(lbl.id);
      if (!node) continue;
      const p = posByIndex.get(lbl.index);
      if (!p || p.x < 0 || p.y < 0 || p.x > w || p.y > h) { node.style.visibility = "hidden"; continue; }
      const ly = p.y - p.radius - 5;
      if (placed.some((k) => Math.abs(k.x - p.x) < MIN_DX && Math.abs(k.y - ly) < MIN_DY)) { node.style.visibility = "hidden"; continue; }
      placed.push({ x: p.x, y: ly });
      node.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(ly)}px) translate(-50%, -100%)`;
      node.style.visibility = "visible";
    }
  }, [containerEl]);

  const scheduleReposition = useCallback(() => {
    if (repositionRafRef.current != null) return;
    repositionRafRef.current = requestAnimationFrame(() => {
      repositionRafRef.current = null;
      reposition();
    });
  }, [reposition]);

  // Reposition after the label set (re)renders so the new refs are populated.
  useEffect(() => {
    scheduleReposition();
  }, [labelSet, scheduleReposition]);

  // Visibility mixers (legend): resolve hide+solo into effective hidden sets for node
  // TYPES and edge KINDS, then filter the decoded payload BEFORE the renderer sees it,
  // so positions/colors/labels/click-through all agree. Positions are preserved —
  // toggling never moves anything (the layout stays the whole-graph equilibrium; the
  // explicit Reflow action is the only thing that moves points).
  const effectiveHidden = useMemo(() => effectiveHiddenTypes(hiddenTypes, soloTypes), [hiddenTypes, soloTypes]);
  const payloadEdgeKinds = useMemo(
    () => (graphData.data?.sidecar.edgeKindTable ?? []) as GraphEdgeKind[],
    [graphData.data],
  );
  const effectiveHiddenEdges = useMemo(
    () => effectiveHiddenSet(hiddenEdgeKinds, soloEdgeKinds, payloadEdgeKinds),
    [hiddenEdgeKinds, soloEdgeKinds, payloadEdgeKinds],
  );
  const decoded = useMemo(() => {
    let view = graphData.data;
    if (!view) return view;
    if (effectiveHidden.size > 0) {
      const hiddenOrdinals = new Set<number>();
      NODE_TYPE_BY_ORDINAL.forEach((t, ord) => {
        if (effectiveHidden.has(t)) hiddenOrdinals.add(ord);
      });
      view = filterDecodedByTypes(view, hiddenOrdinals);
    }
    if (effectiveHiddenEdges.size > 0) {
      const hiddenKindOrdinals = new Set<number>();
      view.sidecar.edgeKindTable.forEach((k, ord) => {
        if (effectiveHiddenEdges.has(k as GraphEdgeKind)) hiddenKindOrdinals.add(ord);
      });
      view = filterDecodedByEdgeKinds(view, hiddenKindOrdinals);
    }
    return view;
  }, [graphData.data, effectiveHidden, effectiveHiddenEdges]);
  const nodeCount = decoded?.nodeCount ?? 0;

  // Honest per-type/per-kind totals for the legend (from the RAW payload, so a hidden
  // channel still shows what it would contribute).
  const typeCounts = useMemo(() => {
    const counts = new Map<GraphNodeType, number>();
    const raw = graphData.data;
    if (!raw) return counts;
    for (const ord of raw.sidecar.types) {
      const t = NODE_TYPE_BY_ORDINAL[ord] ?? "note";
      counts.set(t, (counts.get(t) ?? 0) + 1);
    }
    return counts;
  }, [graphData.data]);
  const edgeKindCounts = useMemo(() => {
    const counts = new Map<GraphEdgeKind, number>();
    const raw = graphData.data;
    if (!raw) return counts;
    for (let e = 0; e < raw.edgeKinds.length; e++) {
      const kind = (raw.sidecar.edgeKindTable[raw.edgeKinds[e]] ?? "wikilink") as GraphEdgeKind;
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return counts;
  }, [graphData.data]);

  // Single coloring: by node type (what each entity IS). Notes get a neutral hue so the
  // people/projects/references pop.

  // Isolated-focus hint: a focused local node that resolved to a single node with
  // no edges (e.g. an un-promoted candidate, which carries no connection edges by
  // design). Show "No connections yet" rather than an empty-feeling canvas.
  const isolatedFocus =
    !!parsed.focusId &&
    !!decoded &&
    nodeCount === 1 &&
    decoded.edgeCount === 0 &&
    decoded.sidecar.ids[0] === parsed.focusId;

  // Navigate a node to its canonical Hilt view. The inspector hands us the type +
  // refPath it already loaded (refPath is dropped from the bulk sidecar), so this is
  // synchronous — no lazy /node/:id round-trip at Open time.
  const navigateToNode = useCallback(
    (node: { id: string; type: GraphNodeType; refPath: string | null }) => {
      switch (node.type) {
        case "reference":
        case "candidate":
          navigateTo("library", libraryItemScope(node.id));
          break;
        case "person":
          if (node.refPath) navigateTo("people", `/${node.refPath}`);
          break;
        case "note":
        case "project":
        case "north_star":
          if (node.refPath) navigateTo("docs", node.refPath);
          break;
        default:
          break; // library_cluster / tag: no canonical view
      }
    },
    [navigateTo],
  );

  // Select a node by point index → open the inspector + highlight its neighborhood.
  const selectNodeByIndex = useCallback((index: number) => {
    const node = metaArrRef.current[index];
    if (!node) return;
    selectedIndexRef.current = index;
    setSelectedNode({ id: node.id, label: node.label, typeOrdinal: node.typeOrdinal });
    rendererRef.current?.highlightNeighbors(index);
  }, []);

  // Click SELECTS (opens the inspector) instead of navigating away, so the graph stays
  // explorable. Modifier-click re-roots local scope; background click clears selection.
  const handleClick = useCallback(
    (index: number | null, modifier: boolean) => {
      if (index == null || index < 0 || index >= metaArrRef.current.length) {
        selectedIndexRef.current = null;
        setSelectedNode(null);
        rendererRef.current?.highlightNeighbors(null);
        return;
      }
      if (modifier) {
        navigateTo("system", buildGraphScope({ focus: metaArrRef.current[index].id, scope: "local" }));
        return;
      }
      selectNodeByIndex(index);
    },
    [navigateTo, selectNodeByIndex],
  );

  // Inspector neighbor click → re-point the inspector and, when the neighbor is in the
  // current payload, recenter + highlight it. Outside the payload (e.g. a 2-hop neighbor
  // not loaded), the panel still loads its detail by id; the canvas just can't show it.
  const handleSelectNeighbor = useCallback((neighbor: { id: string; label: string; type: GraphNodeType }) => {
    const ord = Math.max(0, NODE_TYPE_BY_ORDINAL.indexOf(neighbor.type));
    setSelectedNode({ id: neighbor.id, label: neighbor.label, typeOrdinal: ord });
    const idx = idToIndexRef.current.get(neighbor.id);
    const renderer = rendererRef.current;
    if (idx != null && renderer) {
      selectedIndexRef.current = idx;
      renderer.highlightNeighbors(idx);
      renderer.focusNode(idx, 4);
    } else {
      selectedIndexRef.current = null;
      renderer?.highlightNeighbors(null);
    }
  }, []);

  // "Focus" / "explore from here" → re-root the local-scope graph on the node.
  const handleFocus = useCallback(
    (id: string) => navigateTo("system", buildGraphScope({ focus: id, scope: "local" })),
    [navigateTo],
  );

  const handleCloseInspector = useCallback(() => {
    selectedIndexRef.current = null;
    setSelectedNode(null);
    rendererRef.current?.highlightNeighbors(null);
  }, []);

  // Mount the renderer once the canvas container element is actually attached.
  useEffect(() => {
    if (!enabled || !ready || !containerEl) return;
    if (rendererRef.current) return;
    const renderer = new CosmosRenderer();
    const bg = readBackgroundColor();
    renderer.mount(containerEl, { budget, backgroundColor: bg, linkColor: resolveLinkColor(currentTheme()) });
    renderer.onPointClick((index, modifier) => void handleClick(index, modifier));
    renderer.onPointHover((index) => {
      if (index != null) {
        renderer.highlightNeighbors(index);
        if (index < metaArrRef.current.length) setHoverLabel(metaArrRef.current[index].label);
      } else {
        // Hover-out restores the sticky selection highlight (never clears a selection).
        const sel = selectedIndexRef.current;
        renderer.highlightNeighbors(sel != null ? sel : null);
        setHoverLabel(null);
      }
    });
    // Track zoom to drive label LOD (mobile uses higher thresholds — text soup).
    // cosmos.gl 2.6.4 does not draw text natively, so v1 only records the zoom
    // level into the e2e stats surface; an HTML label overlay is a later add.
    renderer.onZoomChange((zoom) => {
      zoomRef.current = zoom;
    });
    // Reposition the HTML label overlay on every pan/zoom (undebounced, rAF-coalesced).
    renderer.onViewChange(() => scheduleReposition());
    renderer.setPhysicsTuning(physicsRef.current);
    rendererRef.current = renderer;
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
    // budget/handleClick captured at mount; data flows via setData below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ready, containerEl]);

  // Push decoded data into the renderer whenever it changes.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !decoded || nodeCount === 0) return;
    const theme = currentTheme();
    const degrees = degreesFromLinks(decoded.links, nodeCount);
    const colors = buildColorBuffer(decoded.colorKeys, decoded.sidecar.colorKeyTable, theme);
    const sizes = buildSizeBuffer(degrees, decoded.sidecar.types);
    const metaArr: NodeMeta[] = decoded.sidecar.ids.map((id, i) => ({
      id,
      typeOrdinal: decoded.sidecar.types[i] ?? 0,
      label: decoded.sidecar.labels[i] ?? id,
    }));
    metaArrRef.current = metaArr;
    const idToIndex = new Map<string, number>();
    metaArr.forEach((m, i) => idToIndex.set(m.id, i));
    idToIndexRef.current = idToIndex;
    // Re-apply the sticky selection highlight across a refetch (scope/refresh/poll): if
    // the selected node survives into the new payload, re-highlight it; otherwise drop
    // the canvas highlight (the inspector panel still works by id).
    const sel = selectedNodeRef.current;
    if (sel) {
      const selIdx = idToIndex.get(sel.id);
      selectedIndexRef.current = selIdx ?? null;
    }
    // Positions come from the server (global = contracted layout; local = BFS layout);
    // the Type/Folder toggle only changes color, never the layout.
    renderer.setData(decoded.positions, decoded.links, colors, sizes, metaArr);
    if (selectedIndexRef.current != null) renderer.highlightNeighbors(selectedIndexRef.current);

    // Label the top-K hubs — landmarks readable at any zoom without text soup. Named
    // TOPICS get up to half the slots (highest-degree first): the themes are the legible
    // layer the user actually wants, but raw degree alone hands every slot to mega-hub
    // entities/items. Placeholder-labeled topics ("Theme L0-8") earn no priority. The
    // remaining slots go to the highest-degree nodes of any type, as before.
    const K = Math.min(budget.aggressiveLOD ? 10 : 24, nodeCount);
    const topicOrdinal = NODE_TYPE_BY_ORDINAL.indexOf("topic");
    const byDegree = Array.from({ length: nodeCount }, (_, i) => i).sort((a, b) => degrees[b] - degrees[a]);
    const namedTopics = byDegree
      .filter((i) => metaArr[i].typeOrdinal === topicOrdinal && !PLACEHOLDER_TOPIC_LABEL.test(metaArr[i].label))
      .slice(0, Math.floor(K / 2));
    const reserved = new Set(namedTopics);
    const rest = byDegree.filter((i) => !reserved.has(i)).slice(0, K - namedTopics.length);
    const topIdx = [...namedTopics, ...rest];
    renderer.trackLabels(topIdx);
    const set = topIdx.map((index) => ({ id: metaArr[index].id, label: metaArr[index].label, index }));
    labelSetRef.current = set;
    setLabelSet(set);
    // A data swap (filter toggle, refetch) supersedes any reflow — back to canonical.
    setReflowing(false);
    setReflowed(false);
    // Re-assert live mode over the fresh data (setData's trailing pause stopped it).
    if (liveSimRef.current) renderer.setLiveSimulation(true);

    // AUTO-REFLOW on mixer changes: when the RAW payload is unchanged but the filter state
    // moved AND something is filtered, re-settle the visible subset automatically (fast
    // profile). Clearing back to "nothing filtered" keeps the canonical map untouched —
    // home base stays stable. Live mode handles its own re-settling.
    const filterKey = JSON.stringify([[...effectiveHidden].sort(), [...effectiveHiddenEdges].sort()]);
    const rawUnchanged = prevRawDataRef.current === graphData.data;
    const filtersMoved = prevFilterKeyRef.current !== filterKey;
    prevRawDataRef.current = graphData.data;
    prevFilterKeyRef.current = filterKey;
    const anyFiltered = effectiveHidden.size > 0 || effectiveHiddenEdges.size > 0;
    if (rawUnchanged && filtersMoved && anyFiltered && !liveSimRef.current) {
      setReflowing(true);
      renderer.reflow(
        () => {
          setReflowing(false);
          setReflowed(true);
        },
        { fast: true },
      );
    }
    // budget captured at mount; degrees recomputed here from the fresh payload.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, nodeCount, scheduleReposition]);

  // Reflow: GPU settle over the current visible subset (explicit + ephemeral). Restore
  // re-pushes the canonical server positions without touching pan/zoom.
  const handleReflow = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || reflowing) return;
    setReflowing(true);
    renderer.reflow(() => {
      setReflowing(false);
      setReflowed(true);
    });
  }, [reflowing]);
  const handleRestoreLayout = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer || !decoded) return;
    // refit=true: the camera was framed for the relaxed (usually more compact) layout —
    // snap the frame back along with the positions.
    renderer.setPositions(decoded.positions, true);
    setReflowed(false);
  }, [decoded]);
  const handleToggleLiveSim = useCallback(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    setLiveSim((prev) => {
      const next = !prev;
      renderer.setLiveSimulation(next);
      if (next) setReflowing(false); // live supersedes any pending reflow UI state
      else setReflowed(true); // points have drifted — offer Restore
      return next;
    });
  }, []);

  // Auto-reflow change detection: raw-payload identity + last-applied filter key.
  const prevRawDataRef = useRef<unknown>(null);
  const prevFilterKeyRef = useRef("");

  // External refs (library artifact id, Docs file path, person slug) aren't graph node ids — on a
  // focus miss, resolve server-side ONCE and re-enter via the canonical focus URL. The attempted
  // set prevents resolve→navigate→miss loops when the resolved node is LOD-filtered out anyway.
  const resolveAttemptedRef = useRef<Set<string>>(new Set());

  // Deep-link focus: once data arrives, zoom to the focused node (two-phase, like
  // calendar). If absent from the payload, show the stale-focus banner — never throw.
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer || !decoded || !parsed.focusId) {
      if (!parsed.focusId) setFocusFallback(null);
      return;
    }
    const focusId = parsed.focusId;
    const idx = idToIndexRef.current.get(focusId);
    if (idx == null) {
      if (!resolveAttemptedRef.current.has(focusId)) {
        resolveAttemptedRef.current.add(focusId);
        let cancelled = false;
        fetch(withBasePath(`/api/system/graph/resolve?ref=${encodeURIComponent(focusId)}`))
          .then((response) => (response.ok ? response.json() : null))
          .then((json: { node_id?: string } | null) => {
            if (cancelled) return;
            if (typeof json?.node_id === "string" && json.node_id && json.node_id !== focusId) {
              navigateTo("system", buildGraphScope({ focus: json.node_id, scope: parsed.scope ?? undefined }));
            } else {
              setFocusFallback({ focusId, reason: "missing" });
            }
          })
          .catch(() => {
            if (!cancelled) setFocusFallback({ focusId, reason: "missing" });
          });
        return () => { cancelled = true; };
      }
      setFocusFallback({ focusId, reason: "missing" });
      return;
    }
    setFocusFallback(null);
    renderer.focusNode(idx, scope === "local" ? 6 : 4);
  }, [decoded, parsed.focusId, scope]);

  // Re-resolve colors on theme change (never per-frame).
  useEffect(() => {
    if (typeof MutationObserver === "undefined" || typeof document === "undefined") return;
    const observer = new MutationObserver(() => {
      const renderer = rendererRef.current;
      const d = decoded;
      if (!renderer || !d || d.nodeCount === 0) return;
      const theme = currentTheme();
      const colors = buildColorBuffer(d.colorKeys, d.sidecar.colorKeyTable, theme);
      renderer.setColors(colors);
      renderer.setLinkColor(resolveLinkColor(theme));
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [decoded]);

  // Apply budget changes (DPR) live.
  useEffect(() => {
    rendererRef.current?.applyBudget(budget);
  }, [budget]);

  // Keep labels glued to the canvas on viewport resize.
  useEffect(() => {
    function onResize() {
      rendererRef.current?.resize();
      scheduleReposition();
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [scheduleReposition]);

  // Hard-refresh on a format mismatch (stale buffer) rather than rendering garbage.
  useEffect(() => {
    if (graphData.formatError && typeof window !== "undefined") {
      window.location.reload();
    }
  }, [graphData.formatError]);

  // Dev/test stats surface (single source for e2e assertions). The headless mobile
  // e2e asserts server-side caps here: deviceClass, scope (never "global" on
  // mobile), devicePixelRatio (1.0 on mobile), maxHops, simulate (false on mobile),
  // and truncated — NOT memory (real jetsam is an on-device gate per the plan).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const lod = labelLODForDevice(budget.aggressiveLOD);
    (window as unknown as { __hiltGraphStats?: unknown }).__hiltGraphStats = {
      scope,
      focusedNodeId: parsed.focusId,
      nodeCount,
      edgeCount: decoded?.edgeCount ?? 0,
      devicePixelRatio: budget.pixelRatio,
      isSimulationRunning: rendererRef.current?.isSimulationRunning() ?? false,
      deviceClass: budget.deviceClass,
      allowGlobal: budget.allowGlobal,
      maxHops: budget.maxHops,
      simulate: budget.simulate,
      truncated: decoded?.truncated ?? false,
      isolatedFocus,
      labelLOD: lod,
      zoom: zoomRef.current,
      socketConnected: meta.socketConnected,
      webgpu: false,
    };
  }, [scope, parsed.focusId, nodeCount, decoded, budget, isolatedFocus, meta.socketConnected]);

  const handleScopeChange = useCallback(
    (next: GraphScope) => {
      const safe = coerceScope(next);
      setScope(safe);
      navigateTo("system", buildGraphScope({ focus: parsed.focusId ?? undefined, scope: safe }));
    },
    [navigateTo, parsed.focusId, coerceScope],
  );

  const handleRefresh = useCallback(() => {
    setRefreshing(true);
    meta.refresh();
    window.setTimeout(() => setRefreshing(false), 600);
  }, [meta]);

  const stalenessLabel = useMemo(() => {
    if (!meta.meta || meta.meta.builtAt == null) return null;
    const rel = relativeTime(meta.meta.builtAt);
    const pending = meta.meta.dirty ? " · updating" : "";
    // Offline: the WS socket is down and we are on the 10s /meta poll fallback.
    const offline = !meta.socketConnected ? " · offline" : "";
    return `updated ${rel}${pending}${offline}`;
  }, [meta.meta, meta.socketConnected]);

  const toolbar = (
    <SecondaryToolbar
      left={modeSwitcher}
      right={
        enabled ? (
          <GraphToolbar
            scope={scope}
            onShowGlobal={() => handleScopeChange("global")}
            showTags={showTags}
            onShowTagsChange={setShowTags}
            tagsLoading={graphData.loading && showTags}
            onRefresh={handleRefresh}
            refreshing={refreshing}
            stalenessLabel={stalenessLabel}
          />
        ) : null
      }
    />
  );

  // ---- First-run state machine ----
  let body: ReactNode;
  if (!enabled) {
    body = (
      <CenteredPanel>
        <Network className="h-6 w-6 text-[var(--text-tertiary)]" />
        <div className="text-sm font-medium text-[var(--text-primary)]">Knowledge graph</div>
        <div className="max-w-sm text-xs text-[var(--text-tertiary)]">
          Set <code className="rounded bg-[var(--bg-tertiary)] px-1 py-0.5 font-mono text-[10px]">HILT_GRAPH_ENABLED=true</code> to build and view the vault graph.
        </div>
      </CenteredPanel>
    );
  } else if (meta.loading && !meta.meta) {
    body = (
      <CenteredPanel>
        <LoadingState label="Loading graph" className="min-h-0 flex-none" />
      </CenteredPanel>
    );
  } else if (meta.meta && meta.meta.builtAt == null) {
    const state = meta.meta.layoutState;
    if (state === "building" || state === "running") {
      const total = meta.meta.totalNodes ?? 0;
      const placed = meta.meta.nodesPlaced ?? 0;
      const pct = total > 0 ? Math.min(99, Math.round((placed / total) * 100)) : null;
      body = (
        <CenteredPanel>
          <LoadingState label="Building graph index" className="min-h-0 flex-none text-[var(--text-primary)]" />
          <div className="text-xs text-[var(--text-tertiary)]">
            {meta.meta.layoutPhase ?? "Laying out"}
            {pct != null ? ` · ${pct}%` : ""}
          </div>
        </CenteredPanel>
      );
    } else {
      body = (
        <CenteredPanel>
          <Network className="h-6 w-6 text-[var(--text-tertiary)]" />
          <div className="text-sm font-medium text-[var(--text-primary)]">No graph yet</div>
          <div className="max-w-sm text-xs text-[var(--text-tertiary)]">
            Add notes, references, or people to your vault, then refresh.
          </div>
        </CenteredPanel>
      );
    }
  } else if (graphData.error && !graphData.data) {
    body = (
      <CenteredPanel>
        <Network className="h-6 w-6 text-[var(--text-tertiary)]" />
        <div className="text-sm text-[var(--text-secondary)]">{graphData.error}</div>
      </CenteredPanel>
    );
  } else if (ready && nodeCount === 0 && !graphData.loading) {
    body = (
      <CenteredPanel>
        <Network className="h-6 w-6 text-[var(--text-tertiary)]" />
        <div className="text-sm font-medium text-[var(--text-primary)]">No graph yet</div>
        <div className="max-w-sm text-xs text-[var(--text-tertiary)]">
          No connected nodes to show — add notes, references, or people to your vault.
        </div>
      </CenteredPanel>
    );
  } else {
    body = (
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div ref={setContainerEl} className="absolute inset-0" data-testid="graph-canvas" />
        {labelSet.length > 0 ? (
          <div className="pointer-events-none absolute inset-0 z-[5] overflow-hidden" data-testid="graph-labels">
            {labelSet.map((l) => (
              <div
                key={l.id}
                ref={(node) => { labelElsRef.current.set(l.id, node); }}
                className="absolute left-0 top-0 max-w-[150px] truncate rounded bg-[var(--bg-primary)]/75 px-1 text-[10px] font-medium leading-tight text-[var(--text-primary)]"
                style={{ visibility: "hidden", willChange: "transform" }}
              >
                {l.label}
              </div>
            ))}
          </div>
        ) : null}
        <GraphLegendPanel
          semanticBuilt={meta.meta?.semanticBuilt ?? false}
          counts={typeCounts}
          hiddenTypes={hiddenTypes}
          soloTypes={soloTypes}
          onToggleHide={toggleType}
          onToggleSolo={toggleSolo}
          edgeKindCounts={edgeKindCounts}
          hiddenEdgeKinds={hiddenEdgeKinds}
          soloEdgeKinds={soloEdgeKinds}
          onToggleEdgeHide={toggleEdgeKind}
          onToggleEdgeSolo={toggleEdgeSolo}
          onReset={resetTypeFilters}
          reflowing={reflowing}
          reflowed={reflowed}
          onReflow={handleReflow}
          onRestoreLayout={handleRestoreLayout}
          liveSim={liveSim}
          onToggleLiveSim={handleToggleLiveSim}
          physics={physics}
          onPhysicsChange={handlePhysicsChange}
          defaultCollapsed={isMobile}
        />
        {layoutDisabled ? (
          <div className="pointer-events-none absolute right-10 top-3 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]">
            layout disabled
          </div>
        ) : null}
        {focusFallback ? (
          <FocusFallbackBanner onDismiss={() => setFocusFallback(null)} />
        ) : null}
        {isolatedFocus ? (
          <div className="pointer-events-none absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)]/95 px-3 py-1.5 text-xs text-[var(--text-secondary)] shadow-sm">
            No connections yet
          </div>
        ) : null}
        {decoded?.truncated ? (
          <div className="pointer-events-none absolute right-3 bottom-3 rounded-md bg-[var(--bg-tertiary)] px-2 py-1 text-[10px] font-medium text-[var(--text-secondary)]">
            large neighborhood — some nodes hidden
          </div>
        ) : null}
        {hoverLabel ? (
          <div className="pointer-events-none absolute bottom-3 left-3 max-w-[60%] truncate rounded-md bg-[var(--bg-primary)]/90 px-2 py-1 text-xs text-[var(--text-primary)] shadow-sm">
            {hoverLabel}
          </div>
        ) : null}
        {selectedNode ? (
          <GraphInspector
            target={selectedNode}
            onClose={handleCloseInspector}
            onOpen={navigateToNode}
            onSelectNeighbor={handleSelectNeighbor}
            onFocus={handleFocus}
          />
        ) : null}
        {graphData.loading ? (
          <div className="pointer-events-none absolute right-3 top-3">
            <Loader2 className="h-4 w-4 animate-spin text-[var(--text-tertiary)]" />
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="graph-view">
      {toolbar}
      <div className="flex min-h-0 flex-1 flex-col border-t border-[var(--border-default)]">{body}</div>
    </div>
  );
}

function CenteredPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">{children}</div>
  );
}

function FocusFallbackBanner({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="absolute left-1/2 top-3 z-10 flex max-w-md -translate-x-1/2 items-center gap-3 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-secondary)] shadow-md">
      <span>That item isn&apos;t in the graph yet (not-yet-indexed, expired, or deleted). Showing the full graph.</span>
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 rounded px-1.5 py-0.5 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
      >
        Dismiss
      </button>
    </div>
  );
}

function readBackgroundColor(): string {
  if (typeof window === "undefined" || typeof document === "undefined") return "#faf9f7";
  const value = getComputedStyle(document.documentElement).getPropertyValue("--bg-primary").trim();
  return value || "#faf9f7";
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}
