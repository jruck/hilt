"use client";

import { useEffect, useMemo, useState } from "react";
import type { LibraryArtifact } from "@/lib/library/types";
import { useLibrary, useLibraryArtifact, useLibrarySources } from "@/hooks/useLibrary";
import { Bookmark, FileText } from "lucide-react";

function SourceNav({ selectedSource, onSelect }: { selectedSource: string | null; onSelect: (source: string | null) => void }) {
  const { sources } = useLibrarySources();
  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-r border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
      <button
        onClick={() => onSelect(null)}
        className={`mb-2 flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${selectedSource === null ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
      >
        <span>All sources</span>
      </button>
      <div className="space-y-1">
        {sources.map((source) => (
          <button
            key={source.id}
            onClick={() => onSelect(source.id)}
            className={`flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm ${selectedSource === source.id ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]" : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"}`}
          >
            <span className="min-w-0 truncate">{source.name}</span>
            <span className="shrink-0 text-xs text-[var(--text-tertiary)]">{source.artifact_count + source.candidate_count}</span>
          </button>
        ))}
      </div>
    </aside>
  );
}

function ArtifactList({ artifacts, selected, onSelect }: { artifacts: LibraryArtifact[]; selected: string | null; onSelect: (artifact: LibraryArtifact) => void }) {
  return (
    <div className="w-[min(420px,42vw)] shrink-0 overflow-y-auto border-r border-[var(--border-default)] bg-[var(--bg-primary)]">
      {artifacts.map((artifact) => (
        <button
          key={artifact.id}
          onClick={() => onSelect(artifact)}
          className={`flex w-full gap-3 border-b border-[var(--border-default)] p-3 text-left transition-colors ${selected === artifact.id ? "bg-[var(--bg-secondary)]" : "hover:bg-[var(--bg-secondary)]"}`}
        >
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-[var(--content-surface)] text-[var(--text-tertiary)]">
            {artifact.lifecycle_status === "candidate" ? <Bookmark className="h-4 w-4" /> : <FileText className="h-4 w-4" />}
          </div>
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-sm font-medium leading-5 text-[var(--text-primary)]">{artifact.title}</div>
            <div className="mt-1 flex items-center gap-2 text-xs text-[var(--text-tertiary)]">
              <span className="truncate">{artifact.source_name || artifact.channel}</span>
              <span>{artifact.created_at?.slice(0, 10)}</span>
            </div>
          </div>
        </button>
      ))}
    </div>
  );
}

function ArtifactDetail({ id }: { id: string | null }) {
  const { artifact, isLoading } = useLibraryArtifact(id);
  if (!id) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)]">Select an artifact</div>;
  }
  if (isLoading || !artifact) {
    return <div className="flex flex-1 items-center justify-center text-sm text-[var(--text-tertiary)]">Loading...</div>;
  }
  return (
    <article className="min-w-0 flex-1 overflow-y-auto bg-[var(--content-surface)]">
      <div className="mx-auto max-w-3xl px-7 py-6">
        <div className="mb-3 text-xs text-[var(--text-tertiary)]">{artifact.source_name || artifact.channel} · {artifact.created_at?.slice(0, 10)}</div>
        <h1 className="text-2xl font-semibold leading-tight text-[var(--text-primary)]">{artifact.title}</h1>
        {artifact.summary && <p className="mt-4 text-sm leading-6 text-[var(--text-secondary)]">{artifact.summary}</p>}
        {artifact.key_points.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Key Points</h2>
            <ul className="mt-2 space-y-2 text-sm leading-6 text-[var(--text-secondary)]">
              {artifact.key_points.map((point) => <li key={point}>- {point}</li>)}
            </ul>
          </div>
        )}
        {artifact.connections.length > 0 && (
          <div className="mt-6">
            <h2 className="text-sm font-semibold text-[var(--text-primary)]">Connections</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              {artifact.connections.map((connection) => <span key={connection} className="rounded-full bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-secondary)]">{connection}</span>)}
            </div>
          </div>
        )}
        {artifact.url && <a href={artifact.url} target="_blank" rel="noreferrer" className="mt-6 inline-block text-sm font-medium text-[var(--text-primary)] hover:text-[var(--accent-primary)]">Open source</a>}
      </div>
    </article>
  );
}

export function BrowseView({ searchQuery, onOpen }: { searchQuery: string; onOpen?: (artifact: LibraryArtifact) => void }) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null);
  const { artifacts } = useLibrary({ source: selectedSource, q: searchQuery || null, limit: 200 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const firstId = useMemo(() => artifacts[0]?.id || null, [artifacts]);

  useEffect(() => {
    if (!selectedId || !artifacts.some((artifact) => artifact.id === selectedId)) {
      setSelectedId(firstId);
    }
  }, [artifacts, firstId, selectedId]);

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden border-t border-[var(--border-default)]">
      <SourceNav selectedSource={selectedSource} onSelect={setSelectedSource} />
      <ArtifactList artifacts={artifacts} selected={selectedId} onSelect={(artifact) => { setSelectedId(artifact.id); onOpen?.(artifact); }} />
      <ArtifactDetail id={selectedId} />
    </div>
  );
}

