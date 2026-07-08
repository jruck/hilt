"use client";

import { ChevronRight, ExternalLink, FileText, List, Play } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { useLibrary } from "@/hooks/useLibrary";
import type { LibraryArtifact, LibraryArtifactDetail, LibrarySeriesMetadata } from "@/lib/library/types";
import { libraryItemScope } from "@/lib/library/url";
import { isSeriesParentArtifact, SeriesBadge } from "./SeriesBadge";

function childOrder(a: LibraryArtifact, b: LibraryArtifact): number {
  const ai = a.series?.index || Number.MAX_SAFE_INTEGER;
  const bi = b.series?.index || Number.MAX_SAFE_INTEGER;
  return ai - bi || a.title.localeCompare(b.title) || a.path.localeCompare(b.path);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function itemTitle(artifact: LibraryArtifact): string {
  const seriesTitle = artifact.series?.title?.trim();
  if (!seriesTitle) return artifact.title;
  return artifact.title
    .replace(new RegExp(`^${escapeRegExp(seriesTitle)}\\s*(?:[|:–-])\\s*`, "i"), "")
    .trim() || artifact.title;
}

function SeriesItemRow({
  artifact,
  currentId,
  kind,
  onOpen,
}: {
  artifact: LibraryArtifact;
  currentId: string;
  kind: "parent" | "child";
  onOpen: (artifact: LibraryArtifact) => void;
}) {
  const active = artifact.id === currentId;
  const index = artifact.series?.index;
  return (
    <button
      type="button"
      onClick={() => onOpen(artifact)}
      aria-current={active ? "true" : undefined}
      className={`grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 border-b border-[var(--border-default)] px-2.5 py-2 text-left text-xs last:border-b-0 transition-colors ${active ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-secondary)]"}`}
    >
      <span className={`mt-0.5 inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-md border px-1 text-[10px] tabular-nums ${kind === "parent" ? "border-[var(--border-default)] bg-[var(--content-surface)] text-[var(--text-secondary)]" : "border-transparent bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]"}`}>
        {kind === "parent" ? <FileText className="h-3 w-3" /> : index || <Play className="h-3 w-3" />}
      </span>
      <span className="min-w-0">
        <span className={`block truncate font-medium ${active ? "text-[var(--text-primary)]" : "text-[var(--text-secondary)]"}`}>
          {kind === "parent" ? "Series overview" : itemTitle(artifact)}
        </span>
        {artifact.summary && (
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--text-tertiary)]">{artifact.summary}</span>
        )}
      </span>
      <ChevronRight className={`mt-1 h-3.5 w-3.5 shrink-0 ${active ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`} />
    </button>
  );
}

function LibrarySeriesPanelInner({ artifact, series }: { artifact: LibraryArtifactDetail; series: LibrarySeriesMetadata }) {
  const { navigateTo } = useScope();
  const { artifacts, isLoading } = useLibrary({
    series: series.id,
    mode: "all",
    status: "all",
    limit: 200,
  });

  const currentIsParent = isSeriesParentArtifact(artifact) || artifact.raw_frontmatter.series_role === "parent";
  const parentArtifact = artifacts.find(isSeriesParentArtifact) || (currentIsParent ? artifact : null);
  const children = artifacts.filter((item) => !isSeriesParentArtifact(item)).sort(childOrder);
  const loadedChildren = children.length || (currentIsParent ? 0 : 1);
  const total = series.total || loadedChildren;
  const currentLabel = currentIsParent
    ? `Overview · ${total || "?"} items`
    : series.index && total
      ? `Part ${series.index} of ${total}`
      : series.index
        ? `Part ${series.index}`
        : "Series item";

  const openItem = (item: LibraryArtifact) => {
    navigateTo("library", libraryItemScope(item.id));
  };

  return (
    <section className="mt-4 rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="mb-1 flex min-w-0 flex-wrap items-center gap-1.5">
            <SeriesBadge artifact={artifact} />
            {series.url && (
              <a
                href={series.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-xs text-[var(--text-tertiary)] hover:bg-[var(--content-surface)] hover:text-[var(--text-primary)]"
                title="Open source playlist"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Playlist
              </a>
            )}
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <List className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-[var(--text-primary)]">{series.title}</div>
              <div className="text-xs text-[var(--text-tertiary)]">{currentLabel}</div>
            </div>
          </div>
        </div>
        {!currentIsParent && parentArtifact && (
          <button
            type="button"
            onClick={() => openItem(parentArtifact)}
            className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] px-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-primary)] hover:text-[var(--text-primary)]"
          >
            <FileText className="h-3.5 w-3.5" />
            Open overview
          </button>
        )}
      </div>

      {(parentArtifact || children.length > 0 || isLoading) && (
        <div className="mt-3 overflow-hidden rounded-md border border-[var(--border-default)] bg-[var(--content-surface)]">
          {isLoading && children.length === 0 && !parentArtifact ? (
            <div className="px-2.5 py-2 text-xs text-[var(--text-tertiary)]">Loading series…</div>
          ) : (
            <div className="max-h-72 overflow-y-auto">
              {parentArtifact && (
                <SeriesItemRow artifact={parentArtifact} currentId={artifact.id} kind="parent" onOpen={openItem} />
              )}
              {children.map((child) => (
                <SeriesItemRow key={child.id} artifact={child} currentId={artifact.id} kind="child" onOpen={openItem} />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function LibrarySeriesPanel({ artifact }: { artifact: LibraryArtifactDetail }) {
  if (!artifact.series) return null;
  return <LibrarySeriesPanelInner artifact={artifact} series={artifact.series} />;
}
