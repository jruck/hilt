"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Locate, X } from "lucide-react";
import { LoadingState } from "@/components/ui/LoadingState";
import type { GraphEdgeKind, GraphNode, GraphNodeType } from "@/lib/graph/types";
import {
  EDGE_KIND_LABEL,
  EDGE_KIND_ORDER,
  NODE_TYPE_DOT,
  NODE_TYPE_LABEL,
  nodeTypeDot,
  nodeTypeLabel,
} from "./graph-labels";

/** One neighbor + how it connects (mirrors the /node/:id route's Connection shape). */
interface Connection {
  id: string;
  type: GraphNodeType;
  label: string;
  refPath: string | null;
  kind: GraphEdgeKind;
  weight: number;
  direction: "out" | "in";
}

interface NodeDetail {
  node: GraphNode;
  connections: Connection[];
}

/** The minimal node identity GraphView hands the inspector for an instant header. */
export interface InspectorTarget {
  id: string;
  label: string;
  typeOrdinal: number;
}

interface GraphInspectorProps {
  target: InspectorTarget;
  onClose: () => void;
  /** Open the node in its canonical Hilt view (Library/People/Docs). */
  onOpen: (node: { id: string; type: GraphNodeType; refPath: string | null }) => void;
  /** Select a neighbor in-graph (re-points the inspector + recenters the canvas). */
  onSelectNeighbor: (neighbor: { id: string; label: string; type: GraphNodeType }) => void;
  /** Re-root the local-scope graph on this node ("explore from here"). */
  onFocus: (id: string) => void;
}

/** library_cluster / tag are synthetic — no canonical view to open. */
function isNavigable(node: { type: GraphNodeType; refPath: string | null }): boolean {
  if (node.type === "library_cluster" || node.type === "tag") return false;
  if (node.type === "reference" || node.type === "candidate") return true; // by artifact id
  return !!node.refPath;
}

/**
 * Right-docked inspector for the selected graph node. A click selects (rather than
 * navigating away), so the graph stays explorable: the panel shows the node's real
 * connections grouped by relationship kind — the surface that makes the graph
 * trustworthy ("what actually links to what"). Open/Focus are secondary actions.
 *
 * Fetches `/api/system/graph/node/:id` per selection (cheap JSON; the bulk payload
 * drops refPath + neighbor labels). Header renders instantly from `target` while
 * the detail loads.
 */
export function GraphInspector({ target, onClose, onOpen, onSelectNeighbor, onFocus }: GraphInspectorProps) {
  const [detail, setDetail] = useState<NodeDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Guard against a stale fetch resolving after the user picked another node.
  const targetIdRef = useRef(target.id);
  targetIdRef.current = target.id;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setDetail(null);
    fetch(`/api/system/graph/node/${encodeURIComponent(target.id)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status));
        return (await res.json()) as NodeDetail;
      })
      .then((data) => {
        if (cancelled || targetIdRef.current !== target.id) return;
        setDetail(data);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [target.id]);

  const node = detail?.node;
  const connections = detail?.connections ?? [];
  const groups = EDGE_KIND_ORDER.map((kind) => ({
    kind,
    items: connections.filter((c) => c.kind === kind),
  })).filter((g) => g.items.length > 0);
  const canOpen = !!node && isNavigable(node);

  return (
    <div
      className="absolute right-3 top-3 bottom-3 z-20 flex w-72 flex-col overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]/95 shadow-lg backdrop-blur"
      data-testid="graph-inspector"
    >
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-[var(--border-default)] px-3 py-2.5">
        <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${nodeTypeDot(target.typeOrdinal)}`} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-[var(--text-primary)]" title={target.label}>
            {target.label}
          </div>
          <div className="text-[11px] text-[var(--text-tertiary)]">
            {nodeTypeLabel(target.typeOrdinal)}
            {node ? ` · ${node.degree} connection${node.degree === 1 ? "" : "s"}` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded p-1 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 border-b border-[var(--border-default)] px-3 py-2">
        <button
          type="button"
          disabled={!canOpen}
          onClick={() => node && onOpen({ id: node.id, type: node.type, refPath: node.refPath })}
          className="inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--bg-tertiary)] px-2.5 text-xs font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-elevated)] disabled:opacity-40"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          Open
        </button>
        <button
          type="button"
          onClick={() => onFocus(target.id)}
          className="inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
          title="Re-center the graph on this node's neighborhood"
        >
          <Locate className="h-3.5 w-3.5" />
          Focus
        </button>
      </div>

      {/* Connections */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <LoadingState label="Loading connections" size="sm" className="min-h-16 justify-start py-4 text-xs" />
        ) : error ? (
          <div className="py-4 text-xs text-[var(--text-tertiary)]">Couldn&apos;t load connections.</div>
        ) : groups.length === 0 ? (
          <div className="py-4 text-xs text-[var(--text-tertiary)]">No connections yet.</div>
        ) : (
          groups.map((group) => (
            <div key={group.kind} className="mb-3 last:mb-0">
              <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
                {EDGE_KIND_LABEL[group.kind]}
                <span className="text-[var(--text-tertiary)]/70">{group.items.length}</span>
              </div>
              <div className="flex flex-col">
                {group.items.map((c, i) => (
                  <button
                    type="button"
                    key={`${c.id}-${c.kind}-${i}`}
                    onClick={() => onSelectNeighbor({ id: c.id, label: c.label, type: c.type })}
                    className="flex items-center gap-2 rounded-md px-1.5 py-1 text-left text-xs text-[var(--text-secondary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                    title={`${NODE_TYPE_LABEL[c.type]} · ${c.label}`}
                  >
                    <span className={`h-2 w-2 shrink-0 rounded-full ${NODE_TYPE_DOT[c.type]}`} />
                    <span className="truncate">{c.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
