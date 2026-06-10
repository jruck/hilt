"use client";

import { Globe, RefreshCw, Tag } from "lucide-react";
import { SecondaryIconButton } from "@/components/layout/SecondaryToolbar";
import { isGraphTagsEnabled } from "@/lib/graph/config";
import type { GraphScope } from "@/lib/graph/types";

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

/**
 * Secondary-toolbar actions for the graph. The legend (with its hide/solo visibility
 * mixer) lives ON the canvas as the always-docked GraphLegendPanel — vertical screens
 * have the real estate, and the toggles want to be one click away while exploring.
 */
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

      <SecondaryIconButton onClick={onRefresh} title="Refresh graph" disabled={refreshing}>
        <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
      </SecondaryIconButton>
    </>
  );
}
