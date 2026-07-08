"use client";

import { List } from "lucide-react";
import type { LibraryArtifact } from "@/lib/library/types";

export function isSeriesParentArtifact(artifact: Pick<LibraryArtifact, "path" | "series">): boolean {
  return Boolean(artifact.series?.parent_path && artifact.path === artifact.series.parent_path);
}

export function seriesPositionLabel(artifact: Pick<LibraryArtifact, "path" | "series">): string | null {
  const series = artifact.series;
  if (!series) return null;
  if (isSeriesParentArtifact(artifact)) return `Series overview${series.total ? ` · ${series.total} items` : ""}`;
  if (series.index && series.total) return `Part ${series.index} of ${series.total}`;
  if (series.index) return `Part ${series.index}`;
  if (series.total) return `${series.total} item series`;
  return "Series";
}

export function SeriesBadge({
  artifact,
  compact = false,
  className = "",
}: {
  artifact: Pick<LibraryArtifact, "path" | "series">;
  compact?: boolean;
  className?: string;
}) {
  const label = seriesPositionLabel(artifact);
  const title = artifact.series?.title;
  if (!label || !title) return null;
  return (
    <span
      className={`inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs leading-5 text-[var(--text-secondary)] ${className}`}
      title={`${title} · ${label}`}
    >
      <List className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
      <span className="shrink-0">{label}</span>
      {!compact && (
        <>
          <span className="text-[var(--text-tertiary)]">·</span>
          <span className="min-w-0 truncate">{title}</span>
        </>
      )}
    </span>
  );
}
