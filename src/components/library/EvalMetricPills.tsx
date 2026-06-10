"use client";

import type { MouseEvent } from "react";
import { Archive, Ban, Clock, Layers, Network, Zap, type LucideIcon } from "lucide-react";
import type { LibraryEvalAttrs } from "@/lib/library/types";

export function formatEvalScore(value: number): string {
  if (!Number.isFinite(value)) return "0";
  return String(Math.round(Math.max(0, Math.min(1, value)) * 100));
}

export function evalMetricTitle(metric: "worth" | "relevance" | "substance" | "freshness"): string {
  if (metric === "worth") return "Worth: priority score = relevance × substance × freshness; displayed 0–100";
  if (metric === "relevance") return "Relevance: fit to active projects, tasks, areas, people, and recent saves; displayed 0–100";
  if (metric === "substance") return "Substance: source depth and idea density; displayed 0–100";
  return "Freshness: recency multiplier; displayed 0–100";
}

export function EvalMetricPill({
  icon: Icon,
  value,
  title,
  onClick,
}: {
  icon: LucideIcon;
  value: number;
  title: string;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  const className = "inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs tabular-nums text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]";
  const content = (
    <>
      <Icon className="h-3.5 w-3.5" />
      {formatEvalScore(value)}
    </>
  );
  if (onClick) {
    return (
      <button type="button" title={title} onClick={onClick} className={className}>
        {content}
      </button>
    );
  }
  return <span title={title} className={className}>{content}</span>;
}

export function EvalMetricPills({
  evalAttrs,
  breakdown = false,
  showArchiveFlag = false,
  onWorthClick,
}: {
  evalAttrs?: LibraryEvalAttrs | null;
  breakdown?: boolean;
  showArchiveFlag?: boolean;
  onWorthClick?: (event: MouseEvent<HTMLButtonElement>) => void;
}) {
  if (!evalAttrs) return null;
  // A failed capture has no honest scores — the grade would describe a stub, not the content. Show
  // the amber unfetched state IN PLACE of the worth pill (same amber convention as Library Health)
  // so a bad capture is visible on the card cover, never a surprise after clicking through.
  if (evalAttrs.lifecycle === "needs_refetch") {
    return (
      <span
        title="Source capture failed — held for re-fetch. No worth score until the real content is in."
        className="inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-amber-500"
      >
        <Ban className="h-3.5 w-3.5" />
        {breakdown ? "Unfetched" : null}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center justify-start gap-2">
      <EvalMetricPill icon={Zap} value={evalAttrs.worth} title={evalMetricTitle("worth")} onClick={onWorthClick} />
      {breakdown && (
        <>
          <EvalMetricPill icon={Network} value={evalAttrs.relevance} title={evalMetricTitle("relevance")} />
          <EvalMetricPill icon={Layers} value={evalAttrs.substance} title={evalMetricTitle("substance")} />
          <EvalMetricPill icon={Clock} value={evalAttrs.freshness} title={evalMetricTitle("freshness")} />
        </>
      )}
      {showArchiveFlag && evalAttrs.lifecycle === "to_archive" && (
        <span title="Eval lifecycle: review for archive" className="inline-flex min-h-7 items-center gap-1 rounded-md px-1 text-xs font-medium text-[var(--text-secondary)]">
          <Archive className="h-3.5 w-3.5" />
          Archive?
        </span>
      )}
    </span>
  );
}
