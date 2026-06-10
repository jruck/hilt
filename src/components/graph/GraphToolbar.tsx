"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Eye, EyeOff, Globe, RefreshCw, Tag } from "lucide-react";
import { SecondaryIconButton } from "@/components/layout/SecondaryToolbar";
import { isGraphTagsEnabled } from "@/lib/graph/config";
import type { GraphEdgeKind, GraphNodeType, GraphScope } from "@/lib/graph/types";
import { EDGE_KIND_DESCRIPTION, EDGE_KIND_LABEL, NODE_TYPE_DOT, NODE_TYPE_LABEL } from "./graph-labels";

interface GraphToolbarProps {
  /** Current scope. Local is a drill-in reached by focusing a node, not a manual toggle. */
  scope: GraphScope;
  /** Return to the whole-vault view (shown only while drilled into a node). */
  onShowGlobal: () => void;
  showTags: boolean;
  onShowTagsChange: (show: boolean) => void;
  tagsLoading: boolean;
  onRefresh: () => void;
  refreshing: boolean;
  /** "updated <relative> · N pending" chip text (null when no build yet). */
  stalenessLabel: string | null;
  /**
   * The semantic overlay has actually been built (from /meta — NOT the env flag, which a
   * client component can't read; that gate silently hid the Topic/Entity legend rows).
   */
  semanticBuilt: boolean;
  /** Node types currently hidden by the legend's visibility toggles. */
  hiddenTypes: Set<GraphNodeType>;
  onToggleType: (type: GraphNodeType) => void;
}

export function GraphToolbar({
  scope,
  onShowGlobal,
  showTags,
  onShowTagsChange,
  tagsLoading,
  onRefresh,
  refreshing,
  stalenessLabel,
  semanticBuilt,
  hiddenTypes,
  onToggleType,
}: GraphToolbarProps) {
  const tagsAllowed = isGraphTagsEnabled();
  return (
    <>
      {stalenessLabel ? (
        <span className="hidden shrink-0 text-xs text-[var(--text-tertiary)] sm:inline">{stalenessLabel}</span>
      ) : null}

      {/* Local is a drill-in (focus a node); this is the only scope affordance — a way back. */}
      {scope === "local" ? (
        <button
          type="button"
          onClick={onShowGlobal}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Back to the whole-vault graph"
        >
          <Globe className="h-4 w-4" />
          Whole graph
        </button>
      ) : null}

      {tagsAllowed ? (
        <SecondaryIconButton
          active={showTags}
          onClick={() => onShowTagsChange(!showTags)}
          title={tagsLoading ? "Loading tags…" : showTags ? "Hide tags" : "Show tags"}
          disabled={tagsLoading}
        >
          <Tag className={`h-4 w-4 ${tagsLoading ? "animate-pulse" : ""}`} />
        </SecondaryIconButton>
      ) : null}

      <GraphLegend semanticBuilt={semanticBuilt} hiddenTypes={hiddenTypes} onToggleType={onToggleType} />

      <SecondaryIconButton onClick={onRefresh} title="Refresh graph" disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </SecondaryIconButton>
    </>
  );
}

/** Vault node types, always offered as toggles. Notes are folder-colored, hence the note. */
const VAULT_TOGGLE_TYPES: GraphNodeType[] = ["note", "reference", "candidate", "person", "project", "north_star"];

/** Semantic-overlay node types — offered only when the overlay is actually built. */
const SEMANTIC_TOGGLE_TYPES: GraphNodeType[] = ["topic", "entity"];

/** Edge kinds shown in the legend (tag is opt-in and excluded). */
const LEGEND_EDGE_KINDS: GraphEdgeKind[] = ["wikilink", "connection", "connected_project", "meeting"];

/** Semantic-overlay edge kinds — shown only when the overlay is built. */
const SEMANTIC_LEGEND_EDGE_KINDS: GraphEdgeKind[] = [
  "item_topic",
  "topic_parent",
  "item_entity",
  "co_occurrence",
  "similar",
];

interface GraphLegendProps {
  semanticBuilt: boolean;
  hiddenTypes: Set<GraphNodeType>;
  onToggleType: (type: GraphNodeType) => void;
}

/**
 * Legend + per-type visibility toggles. Each node-type row is a button: the swatch/name
 * explain the color, the eye toggles that type in/out of the plot (state owned by
 * GraphView, persisted). This is the "sift" affordance — hide the entity dust to read the
 * themes, hide topics to see only first-party content, etc.
 */
function GraphLegend({ semanticBuilt, hiddenTypes, onToggleType }: GraphLegendProps) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);

  // The toolbar is `overflow-hidden` (for horizontal scroll), which would clip a
  // normally-positioned dropdown to the 44px bar. Portal to <body> with fixed
  // coordinates anchored to the button so the panel escapes all overflow clipping.
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) setPos({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const hiddenCount = hiddenTypes.size;
  const typeRow = (type: GraphNodeType) => {
    const hidden = hiddenTypes.has(type);
    return (
      <button
        key={type}
        type="button"
        onClick={() => onToggleType(type)}
        className={`flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs transition-colors hover:bg-[var(--bg-tertiary)] ${
          hidden ? "text-[var(--text-tertiary)]" : "text-[var(--text-primary)]"
        }`}
        title={hidden ? `Show ${NODE_TYPE_LABEL[type]} nodes` : `Hide ${NODE_TYPE_LABEL[type]} nodes`}
        data-testid={`graph-toggle-${type}`}
      >
        <span className={`h-2.5 w-2.5 rounded-full ${NODE_TYPE_DOT[type]} ${hidden ? "opacity-30" : ""}`} />
        <span className={`min-w-0 flex-1 ${hidden ? "line-through" : ""}`}>{NODE_TYPE_LABEL[type]}</span>
        {hidden ? <EyeOff className="h-3.5 w-3.5 shrink-0" /> : <Eye className="h-3.5 w-3.5 shrink-0 opacity-40" />}
      </button>
    );
  };

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        title="Legend & visibility"
      >
        Legend
        {hiddenCount > 0 ? (
          <span className="rounded bg-[var(--bg-tertiary)] px-1 text-[10px] text-[var(--text-tertiary)]">
            {hiddenCount} hidden
          </span>
        ) : null}
      </button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <>
              <div className="fixed inset-0 z-[999]" onClick={() => setOpen(false)} />
              <div
                style={{ position: "fixed", top: pos.top, right: pos.right }}
                className="z-[1000] max-h-[75vh] min-w-[230px] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] p-2 shadow-lg"
                data-testid="graph-legend-panel"
              >
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Nodes <span className="normal-case tracking-normal">(click to show/hide)</span>
                </div>
                {VAULT_TOGGLE_TYPES.map(typeRow)}
                {/* Semantic-overlay rows — only once the overlay has actually been built. */}
                {semanticBuilt ? SEMANTIC_TOGGLE_TYPES.map(typeRow) : null}
                <div className="mt-1.5 border-t border-[var(--border-default)] px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Connections
                </div>
                {(semanticBuilt ? [...LEGEND_EDGE_KINDS, ...SEMANTIC_LEGEND_EDGE_KINDS] : LEGEND_EDGE_KINDS).map((kind) => (
                  <div key={kind} className="flex items-start gap-2 px-2 py-1 text-xs text-[var(--text-primary)]">
                    <span className="mt-1.5 h-px w-3 shrink-0 bg-[var(--text-tertiary)]" />
                    <span className="min-w-0">
                      <span className="font-medium">{EDGE_KIND_LABEL[kind]}</span>
                      <span className="block text-[10px] leading-tight text-[var(--text-tertiary)]">{EDGE_KIND_DESCRIPTION[kind]}</span>
                    </span>
                  </div>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  );
}
