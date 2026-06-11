"use client";

import { useState } from "react";
import { Activity, Binoculars, ChevronDown, ChevronUp, Eye, EyeOff, Orbit, Undo2 } from "lucide-react";
import type { GraphEdgeKind, GraphNodeType } from "@/lib/graph/types";
import { EDGE_KIND_DESCRIPTION, EDGE_KIND_LABEL, NODE_TYPE_DOT, NODE_TYPE_LABEL } from "./graph-labels";

/** Vault node types, always offered. Semantic types appended when the overlay is built. */
const VAULT_TYPES: GraphNodeType[] = ["note", "reference", "candidate", "person", "project", "north_star"];
const SEMANTIC_TYPES: GraphNodeType[] = ["topic", "entity"];

const BASE_EDGE_KINDS: GraphEdgeKind[] = ["wikilink", "connection", "connected_project", "meeting"];
const SEMANTIC_EDGE_KINDS: GraphEdgeKind[] = ["item_topic", "topic_parent", "item_entity", "co_occurrence", "similar"];

interface GraphLegendPanelProps {
  semanticBuilt: boolean;
  /** Per-type node counts from the RAW payload (pre-filter) — honest totals while hidden. */
  counts: ReadonlyMap<GraphNodeType, number>;
  hiddenTypes: ReadonlySet<GraphNodeType>;
  soloTypes: ReadonlySet<GraphNodeType>;
  onToggleHide: (type: GraphNodeType) => void;
  onToggleSolo: (type: GraphNodeType) => void;
  /** Per-kind edge counts from the RAW payload. */
  edgeKindCounts: ReadonlyMap<GraphEdgeKind, number>;
  hiddenEdgeKinds: ReadonlySet<GraphEdgeKind>;
  soloEdgeKinds: ReadonlySet<GraphEdgeKind>;
  onToggleEdgeHide: (kind: GraphEdgeKind) => void;
  onToggleEdgeSolo: (kind: GraphEdgeKind) => void;
  onReset: () => void;
  /** Reflow (GPU settle over the visible subset) — explicit + ephemeral. */
  reflowing: boolean;
  reflowed: boolean;
  onReflow: () => void;
  onRestoreLayout: () => void;
  /** Continuous physics toggle (session-only). */
  liveSim: boolean;
  onToggleLiveSim: () => void;
  /** Start collapsed (mobile). The expanded/collapsed choice persists per session. */
  defaultCollapsed?: boolean;
}

/**
 * Always-on-canvas legend + visibility mixer (left-docked; the inspector owns the right).
 * Node types AND edge kinds are channel strips: swatch/dash + name + count, an eye
 * (mute/hide) and binoculars (solo — show only this channel). Solo is SINGLE-SELECT per
 * section: soloing replaces any prior solo in that section; clicking the soloed channel
 * clears it; solo suspends that section's hides until cleared. The footer holds Reflow
 * (re-settle the visible subset client-side) and Restore (back to canonical positions).
 */
export function GraphLegendPanel({
  semanticBuilt,
  counts,
  hiddenTypes,
  soloTypes,
  onToggleHide,
  onToggleSolo,
  edgeKindCounts,
  hiddenEdgeKinds,
  soloEdgeKinds,
  onToggleEdgeHide,
  onToggleEdgeSolo,
  onReset,
  reflowing,
  reflowed,
  onReflow,
  onRestoreLayout,
  liveSim,
  onToggleLiveSim,
  defaultCollapsed = false,
}: GraphLegendPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showEdges, setShowEdges] = useState(true);
  const types = semanticBuilt ? [...VAULT_TYPES, ...SEMANTIC_TYPES] : VAULT_TYPES;
  const edgeKinds = semanticBuilt ? [...BASE_EDGE_KINDS, ...SEMANTIC_EDGE_KINDS] : BASE_EDGE_KINDS;
  const anyOverride =
    hiddenTypes.size > 0 || soloTypes.size > 0 || hiddenEdgeKinds.size > 0 || soloEdgeKinds.size > 0;
  const typeSoloActive = soloTypes.size > 0;
  const edgeSoloActive = soloEdgeKinds.size > 0;

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        className="absolute left-3 top-3 z-20 inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)]/95 px-2.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm backdrop-blur transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        title="Show legend"
        data-testid="graph-legend-collapsed"
      >
        Legend
        {anyOverride ? <span className="rounded bg-[var(--bg-tertiary)] px-1 text-[10px] text-[var(--text-tertiary)]">filtered</span> : null}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    );
  }

  /** One mixer channel strip (shared by node-type and edge-kind rows). */
  const channelRow = (opts: {
    key: string;
    swatch: React.ReactNode;
    label: string;
    titleHint?: string;
    count: number;
    visible: boolean;
    hidden: boolean;
    soloed: boolean;
    soloActive: boolean;
    onHide: () => void;
    onSolo: () => void;
    testPrefix: string;
  }) => (
    <div
      key={opts.key}
      className={`group flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-[var(--bg-tertiary)] ${
        opts.visible ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
      }`}
      title={opts.titleHint}
      data-testid={`${opts.testPrefix}-row-${opts.key}`}
    >
      {opts.swatch}
      <span className={`min-w-0 flex-1 truncate ${opts.visible ? "" : "line-through"}`}>{opts.label}</span>
      <span className="shrink-0 tabular-nums text-[10px] text-[var(--text-tertiary)]">{opts.count.toLocaleString()}</span>
      <button
        type="button"
        onClick={opts.onSolo}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
          opts.soloed
            ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
            : "text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] group-hover:opacity-100"
        } ${opts.soloActive ? "opacity-100" : ""}`}
        title={opts.soloed ? "Unsolo" : `Solo ${opts.label} (show only this)`}
        data-testid={`${opts.testPrefix}-solo-${opts.key}`}
      >
        <Binoculars className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={opts.onHide}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-elevated)] ${
          opts.hidden ? "text-[var(--text-tertiary)]" : "text-[var(--text-tertiary)] opacity-40 hover:opacity-100"
        } ${opts.soloActive ? "pointer-events-none opacity-20" : ""}`}
        title={opts.hidden ? `Show ${opts.label}` : `Hide ${opts.label}`}
        data-testid={`${opts.testPrefix}-hide-${opts.key}`}
      >
        {opts.hidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      </button>
    </div>
  );

  return (
    <div
      className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-64 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]/95 shadow-lg backdrop-blur"
      data-testid="graph-legend-panel"
    >
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
          Nodes
        </span>
        {anyOverride ? (
          <button
            type="button"
            onClick={onReset}
            className="rounded px-1.5 py-0.5 text-[10px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title="Show everything (clear all hide + solo)"
          >
            reset
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          className="rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Collapse legend"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {types.map((type) =>
          channelRow({
            key: type,
            swatch: (
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${NODE_TYPE_DOT[type]} ${
                  (typeSoloActive ? soloTypes.has(type) : !hiddenTypes.has(type)) ? "" : "opacity-30"
                }`}
              />
            ),
            label: NODE_TYPE_LABEL[type],
            count: counts.get(type) ?? 0,
            visible: typeSoloActive ? soloTypes.has(type) : !hiddenTypes.has(type),
            hidden: hiddenTypes.has(type),
            soloed: soloTypes.has(type),
            soloActive: typeSoloActive,
            onHide: () => onToggleHide(type),
            onSolo: () => onToggleSolo(type),
            testPrefix: "graph-type",
          }),
        )}

        <button
          type="button"
          onClick={() => setShowEdges((v) => !v)}
          className="mt-1.5 flex w-full items-center gap-1 border-t border-[var(--border-default)] px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          Connections
          {showEdges ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showEdges
          ? edgeKinds.map((kind) =>
              channelRow({
                key: kind,
                swatch: <span className="h-px w-3 shrink-0 bg-[var(--text-tertiary)]" />,
                label: EDGE_KIND_LABEL[kind],
                titleHint: EDGE_KIND_DESCRIPTION[kind],
                count: edgeKindCounts.get(kind) ?? 0,
                visible: edgeSoloActive ? soloEdgeKinds.has(kind) : !hiddenEdgeKinds.has(kind),
                hidden: hiddenEdgeKinds.has(kind),
                soloed: soloEdgeKinds.has(kind),
                soloActive: edgeSoloActive,
                onHide: () => onToggleEdgeHide(kind),
                onSolo: () => onToggleEdgeSolo(kind),
                testPrefix: "graph-edge",
              }),
            )
          : null}
      </div>

      {/* Physics footer — one-shot Reflow, continuous Live toggle, Restore to canonical. */}
      <div className="flex items-center gap-1.5 border-t border-[var(--border-default)] px-2 py-1.5">
        <button
          type="button"
          onClick={onReflow}
          disabled={reflowing || liveSim}
          className="inline-flex h-6 flex-1 items-center justify-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-[11px] font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50"
          title={liveSim ? "Live simulation is running" : "Re-settle the layout over what's currently visible (temporary — any filter change restores the canonical map)"}
          data-testid="graph-reflow"
        >
          <Orbit className={`h-3.5 w-3.5 ${reflowing ? "animate-spin" : ""}`} />
          {reflowing ? "Settling…" : "Reflow"}
        </button>
        <button
          type="button"
          onClick={onToggleLiveSim}
          className={`inline-flex h-6 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors ${
            liveSim
              ? "border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400"
              : "border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          }`}
          title={liveSim ? "Stop the live simulation (freeze in place)" : "Run the physics continuously until switched off (session-only)"}
          data-testid="graph-live-sim"
        >
          <Activity className={`h-3.5 w-3.5 ${liveSim ? "animate-pulse" : ""}`} />
          Live
        </button>
        {reflowed && !liveSim ? (
          <button
            type="button"
            onClick={onRestoreLayout}
            className="inline-flex h-6 items-center gap-1 rounded-md px-2 text-[11px] font-medium text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
            title="Back to the canonical whole-graph layout"
            data-testid="graph-restore-layout"
          >
            <Undo2 className="h-3.5 w-3.5" />
            Restore
          </button>
        ) : null}
      </div>
    </div>
  );
}
