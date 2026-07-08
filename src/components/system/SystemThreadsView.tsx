"use client";

import { useMemo, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  BookMarked,
  MessageSquare,
  Newspaper,
  Play,
  RefreshCw,
  Repeat,
  Sparkles,
  SquareCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  SECONDARY_CHROME_BODY_GUTTER_CLASS,
  SecondaryIconButton,
  SecondarySegmentedButton,
  SecondarySegmentedControl,
  SecondaryToolbar,
} from "@/components/layout/SecondaryToolbar";
import { LoadingState } from "@/components/ui/LoadingState";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";
import type { CommentTarget } from "@/lib/comments/types";
import { libraryItemScope } from "@/lib/library/url";
import { requestTaskOpen } from "@/lib/tasks/deeplink";
import { runProcessAll, runThreadProcess, type ProcessAllProgress } from "@/lib/threads/process-client";
import type { ThreadSummary } from "@/lib/threads/types";

interface SystemThreadsViewProps {
  modeSwitcher: ReactNode;
}

type ThreadFilter = "open" | "resolved" | "all";

async function fetchThreads(url: string): Promise<{ threads: ThreadSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ threads: ThreadSummary[] }>;
}

export function SystemThreadsView({ modeSwitcher }: SystemThreadsViewProps) {
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ProcessAllProgress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ threads: ThreadSummary[] }, Error>(
    "/api/threads",
    fetchThreads,
    { keepPreviousData: true, refreshInterval: 15_000 },
  );

  const threads = data?.threads ?? [];
  const counts = useMemo(() => {
    let open = 0;
    let resolved = 0;
    for (const thread of threads) {
      if (thread.status === "open") open += 1;
      else if (thread.status === "resolved") resolved += 1;
    }
    return { open, resolved };
  }, [threads]);

  const filteredThreads = useMemo(() => {
    if (filter === "all") return threads;
    return threads.filter((thread) => thread.status === filter);
  }, [filter, threads]);

  async function processAllOpenThreads() {
    if (batchRunning) return;
    const controller = new AbortController();
    setBatchRunning(true);
    setBatchProgress({ index: 0, total: counts.open });
    setBatchError(null);
    try {
      await runProcessAll(setBatchProgress, controller.signal);
      await mutate();
    } catch (err) {
      setBatchError(err instanceof Error ? err.message : "Thread batch processing failed");
    } finally {
      setBatchRunning(false);
      setBatchProgress(null);
    }
  }

  async function processThread(threadId: string) {
    if (processingId) return;
    setProcessingId(threadId);
    setErrorById((current) => {
      const next = { ...current };
      delete next[threadId];
      return next;
    });
    try {
      await runThreadProcess(threadId);
      await mutate();
    } catch (err) {
      setErrorById((current) => ({
        ...current,
        [threadId]: err instanceof Error ? err.message : "Thread processing failed",
      }));
    } finally {
      setProcessingId(null);
    }
  }

  const toolbar = (
    <ThreadsToolbar
      modeSwitcher={modeSwitcher}
      filter={filter}
      onFilterChange={setFilter}
      counts={counts}
      batchRunning={batchRunning}
      batchProgress={batchProgress}
      batchError={batchError}
      validating={isValidating}
      onProcessAll={() => void processAllOpenThreads()}
      onRefresh={() => void mutate()}
    />
  );

  if (isLoading && !data) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        {toolbar}
        <LoadingState label="Loading threads" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
        {toolbar}
        <div className="flex flex-1 items-center justify-center p-6">
          <div className="rounded-md border border-red-500/20 bg-red-500/5 px-4 py-3 text-sm text-red-600">
            {error.message}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      {toolbar}
      {batchError ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {batchError}
        </div>
      ) : null}
      {error ? (
        <div className="border-b border-red-500/20 bg-red-500/5 px-4 py-2 text-xs text-red-600">
          {error.message}
        </div>
      ) : null}
      <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 flex-1 overflow-auto px-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
        {filteredThreads.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
            {filter === "all" ? "No threads" : `No ${filter} threads`}
          </div>
        ) : (
          <div className="divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
            {filteredThreads.map((thread) => (
              <ThreadRow
                key={thread.id}
                thread={thread}
                processing={processingId === thread.id}
                processDisabled={Boolean(processingId) || batchRunning}
                error={errorById[thread.id] ?? null}
                onProcess={() => void processThread(thread.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadsToolbar({
  modeSwitcher,
  filter,
  onFilterChange,
  counts,
  batchRunning,
  batchProgress,
  batchError,
  validating,
  onProcessAll,
  onRefresh,
}: {
  modeSwitcher: ReactNode;
  filter: ThreadFilter;
  onFilterChange: (filter: ThreadFilter) => void;
  counts: { open: number; resolved: number };
  batchRunning: boolean;
  batchProgress: ProcessAllProgress | null;
  batchError: string | null;
  validating: boolean;
  onProcessAll: () => void;
  onRefresh: () => void;
}) {
  return (
    <SecondaryToolbar
      left={modeSwitcher}
      right={
        <>
          <SecondarySegmentedControl>
            {(["open", "resolved", "all"] as const).map((value) => (
              <SecondarySegmentedButton
                key={value}
                active={filter === value}
                onClick={() => onFilterChange(value)}
                className="capitalize"
              >
                {value}
              </SecondarySegmentedButton>
            ))}
          </SecondarySegmentedControl>
          <div className="hidden items-center gap-1.5 text-xs text-[var(--text-tertiary)] md:flex">
            <span>{counts.open} open</span>
            <span className="text-[var(--text-quaternary)]">·</span>
            <span>{counts.resolved} resolved</span>
          </div>
          {counts.open > 0 ? (
            <button
              type="button"
              onClick={onProcessAll}
              disabled={batchRunning}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-[var(--bg-tertiary)] disabled:cursor-default disabled:opacity-60 ${
                batchRunning
                  ? "text-emerald-600"
                  : batchError
                    ? "text-red-500"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Sparkles className={`h-3.5 w-3.5 ${batchRunning ? "animate-pulse" : ""}`} />
              <span>{batchRunning ? `Processing ${batchProgress?.index ?? 0}/${batchProgress?.total ?? counts.open}` : "Process all"}</span>
            </button>
          ) : null}
          <SecondaryIconButton
            onClick={onRefresh}
            disabled={validating}
            title="Refresh threads"
            aria-label="Refresh threads"
          >
            <RefreshCw className={`h-4 w-4 ${validating ? "animate-spin" : ""}`} />
          </SecondaryIconButton>
        </>
      }
    />
  );
}

function ThreadRow({
  thread,
  processing,
  processDisabled,
  error,
  onProcess,
}: {
  thread: ThreadSummary;
  processing: boolean;
  processDisabled: boolean;
  error: string | null;
  onProcess: () => void;
}) {
  const { navigateTo } = useScope();
  const Icon = targetIcon(thread.target);
  const openTarget = targetOpenHandler(thread.target, navigateTo);
  const middle = (
    <>
      <div className="truncate text-sm text-[var(--text-primary)]">{targetLabel(thread.target)}</div>
      {thread.last_message_snippet ? (
        <div className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]">{thread.last_message_snippet}</div>
      ) : null}
    </>
  );

  return (
    <div>
      <div className="group flex items-center gap-3 px-2 py-2 transition-colors hover:bg-[var(--bg-secondary)]">
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        {openTarget ? (
          <button
            type="button"
            onClick={openTarget}
            className="min-w-0 flex-1 cursor-pointer text-left"
          >
            {middle}
          </button>
        ) : (
          <div className="min-w-0 flex-1">{middle}</div>
        )}
        <ThreadStatus thread={thread} />
        <div className="flex shrink-0 items-center gap-1 text-xs text-[var(--text-quaternary)]">
          <MessageSquare className="h-3.5 w-3.5" />
          <span>{thread.message_count}</span>
        </div>
        <time
          className="hidden shrink-0 text-xs text-[var(--text-quaternary)] sm:inline"
          dateTime={thread.updated_at}
          title={thread.updated_at}
        >
          {relativeTime(thread.updated_at)}
        </time>
        {thread.status === "open" ? (
          <button
            type="button"
            onClick={onProcess}
            disabled={processDisabled}
            className={`inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium transition-opacity disabled:cursor-default ${
              processing
                ? "opacity-100 text-emerald-600"
                : "opacity-0 text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-within:opacity-100 group-hover:opacity-100 disabled:opacity-0"
            }`}
          >
            <Play className={`h-3.5 w-3.5 ${processing ? "animate-pulse" : ""}`} />
            <span className="hidden md:inline">{processing ? "Processing" : "Process"}</span>
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="pb-2 pl-9 pr-2 text-xs text-red-500">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ThreadStatus({ thread }: { thread: ThreadSummary }) {
  return (
    <div className="hidden shrink-0 items-center gap-1 text-xs text-[var(--text-tertiary)] md:flex">
      {thread.status === "open" ? (
        <span>Open</span>
      ) : (
        <>
          <span className="text-[var(--text-quaternary)]">Resolved</span>
          {thread.resolution ? <span className="text-[var(--text-quaternary)]">· {thread.resolution.action}</span> : null}
        </>
      )}
      {thread.processed ? (
        <span className="rounded bg-[var(--bg-tertiary)] px-1.5 py-0.5 text-[10px] text-[var(--text-quaternary)]">
          processed
        </span>
      ) : null}
    </div>
  );
}

function targetIcon(target: CommentTarget): LucideIcon {
  switch (target.kind) {
    case "task":
      return SquareCheck;
    case "loop-item":
      return Repeat;
    case "briefing":
    case "briefing-section":
    case "briefing-anchor":
      return Newspaper;
    case "library":
      return BookMarked;
    case "meeting":
      return Users;
  }
}

function targetLabel(target: CommentTarget): string {
  switch (target.kind) {
    case "task":
      return "Task";
    case "loop-item":
      return `Loop: ${target.loop}`;
    case "briefing":
      return `Briefing · ${target.date}`;
    case "briefing-section":
      return `Briefing · ${target.date} § ${target.section}`;
    case "briefing-anchor":
      return `Briefing${target.date ? ` · ${target.date}` : ""}`;
    case "library":
      return "Library reference";
    case "meeting": {
      const basename = target.rel.split("/").pop()?.replace(/\.md$/, "") || target.rel;
      return `Meeting · ${basename}`;
    }
  }
}

function targetOpenHandler(target: CommentTarget, navigateTo: ReturnType<typeof useScope>["navigateTo"]): (() => void) | null {
  switch (target.kind) {
    case "task":
      return () => requestTaskOpen(target.id);
    case "library":
      return () => navigateTo("library", libraryItemScope(target.id));
    case "loop-item":
    case "briefing":
    case "briefing-section":
    case "briefing-anchor":
    case "meeting":
      return null;
  }
}

function relativeTime(value: string): string {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return "unknown";
  const diff = Date.now() - time;
  const abs = Math.abs(diff);
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (abs < minute) return "just now";
  if (abs < hour) return `${Math.round(diff / minute)}m ago`;
  if (abs < day) return `${Math.round(diff / hour)}h ago`;
  return `${Math.round(diff / day)}d ago`;
}
