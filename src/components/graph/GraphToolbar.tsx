"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Globe, RefreshCw, Tag } from "lucide-react";
import { SecondaryIconButton } from "@/components/layout/SecondaryToolbar";
import { isGraphTagsEnabled } from "@/lib/graph/config";
import type { GraphEdgeKind, GraphScope } from "@/lib/graph/types";
import { EDGE_KIND_DESCRIPTION, EDGE_KIND_LABEL } from "./graph-labels";

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

      <GraphLegend />

      <SecondaryIconButton onClick={onRefresh} title="Refresh graph" disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </SecondaryIconButton>
    </>
  );
}

// Type-mode hues for the semantic entities. Notes are colored by folder (rotating
// palette), not a single hue, so they're called out separately in the popover.
const LEGEND_ITEMS: Array<{ label: string; className: string }> = [
  { label: "Reference", className: "bg-blue-500" },
  { label: "Candidate", className: "bg-amber-500" },
  { label: "Person", className: "bg-emerald-500" },
  { label: "Project", className: "bg-violet-500" },
  { label: "North Star", className: "bg-rose-500" },
];

/** Edge kinds shown in the legend (tag is opt-in and excluded). */
const LEGEND_EDGE_KINDS: GraphEdgeKind[] = ["wikilink", "connection", "connected_project", "meeting"];

function GraphLegend() {
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

  return (
    <div className="relative shrink-0">
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-8 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
        title="Legend"
      >
        Legend
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
                <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">Nodes</div>
                {LEGEND_ITEMS.map((item) => (
                  <div key={item.label} className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-primary)]">
                    <span className={`h-2.5 w-2.5 rounded-full ${item.className}`} />
                    {item.label}
                  </div>
                ))}
                <div className="flex items-center gap-2 px-2 py-1 text-xs text-[var(--text-primary)]">
                  <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                  Note
                </div>
                <div className="mt-1.5 border-t border-[var(--border-default)] px-2 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                  Connections
                </div>
                {LEGEND_EDGE_KINDS.map((kind) => (
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
