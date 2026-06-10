"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Eye, EyeOff } from "lucide-react";
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
  onReset: () => void;
  /** Start collapsed (mobile). The expanded/collapsed choice persists per session. */
  defaultCollapsed?: boolean;
}

/**
 * Always-on-canvas legend + visibility mixer (left-docked; the inspector owns the right).
 * Each node type is a channel strip: swatch + name + count, an eye (mute/hide) and an "S"
 * (solo — show ONLY the soloed types; multi-solo unions, exactly like an audio console).
 * Solo overrides hide until cleared. Edge kinds stay informational below, collapsed by
 * default to keep the strip compact on a vertical screen.
 */
export function GraphLegendPanel({
  semanticBuilt,
  counts,
  hiddenTypes,
  soloTypes,
  onToggleHide,
  onToggleSolo,
  onReset,
  defaultCollapsed = false,
}: GraphLegendPanelProps) {
  const [collapsed, setCollapsed] = useState(defaultCollapsed);
  const [showEdges, setShowEdges] = useState(false);
  const types = semanticBuilt ? [...VAULT_TYPES, ...SEMANTIC_TYPES] : VAULT_TYPES;
  const anyOverride = hiddenTypes.size > 0 || soloTypes.size > 0;
  const soloActive = soloTypes.size > 0;

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

  return (
    <div
      className="absolute left-3 top-3 z-20 flex max-h-[calc(100%-1.5rem)] w-60 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]/95 shadow-lg backdrop-blur"
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
            title="Show everything (clear hide + solo)"
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
        {types.map((type) => {
          const soloed = soloTypes.has(type);
          // What's actually visible right now: solo wins; otherwise the hide flag.
          const visible = soloActive ? soloed : !hiddenTypes.has(type);
          const count = counts.get(type) ?? 0;
          return (
            <div
              key={type}
              className={`group flex items-center gap-2 rounded px-1.5 py-1 text-xs transition-colors hover:bg-[var(--bg-tertiary)] ${
                visible ? "text-[var(--text-primary)]" : "text-[var(--text-tertiary)]"
              }`}
              data-testid={`graph-legend-row-${type}`}
            >
              <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${NODE_TYPE_DOT[type]} ${visible ? "" : "opacity-30"}`} />
              <span className={`min-w-0 flex-1 truncate ${visible ? "" : "line-through"}`}>{NODE_TYPE_LABEL[type]}</span>
              <span className="shrink-0 tabular-nums text-[10px] text-[var(--text-tertiary)]">{count.toLocaleString()}</span>
              <button
                type="button"
                onClick={() => onToggleSolo(type)}
                className={`h-5 w-5 shrink-0 rounded text-[10px] font-bold leading-none transition-colors ${
                  soloed
                    ? "bg-amber-500/20 text-amber-600 dark:text-amber-400"
                    : "text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--bg-elevated)] hover:text-[var(--text-primary)] group-hover:opacity-100"
                } ${soloActive ? "opacity-100" : ""}`}
                title={soloed ? "Unsolo" : `Solo ${NODE_TYPE_LABEL[type]} (show only)`}
                data-testid={`graph-solo-${type}`}
              >
                S
              </button>
              <button
                type="button"
                onClick={() => onToggleHide(type)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors hover:bg-[var(--bg-elevated)] ${
                  hiddenTypes.has(type) ? "text-[var(--text-tertiary)]" : "text-[var(--text-tertiary)] opacity-40 hover:opacity-100"
                } ${soloActive ? "pointer-events-none opacity-20" : ""}`}
                title={hiddenTypes.has(type) ? `Show ${NODE_TYPE_LABEL[type]}` : `Hide ${NODE_TYPE_LABEL[type]}`}
                data-testid={`graph-hide-${type}`}
              >
                {hiddenTypes.has(type) ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              </button>
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => setShowEdges((v) => !v)}
          className="mt-1.5 flex w-full items-center gap-1 border-t border-[var(--border-default)] px-1.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
        >
          Connections
          {showEdges ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
        {showEdges
          ? (semanticBuilt ? [...BASE_EDGE_KINDS, ...SEMANTIC_EDGE_KINDS] : BASE_EDGE_KINDS).map((kind) => (
              <div key={kind} className="flex items-start gap-2 px-1.5 py-1 text-xs text-[var(--text-primary)]">
                <span className="mt-1.5 h-px w-3 shrink-0 bg-[var(--text-tertiary)]" />
                <span className="min-w-0">
                  <span className="font-medium">{EDGE_KIND_LABEL[kind]}</span>
                  <span className="block text-[10px] leading-tight text-[var(--text-tertiary)]">{EDGE_KIND_DESCRIPTION[kind]}</span>
                </span>
              </div>
            ))
          : null}
      </div>
    </div>
  );
}
