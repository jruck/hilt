"use client";

import { useMemo, useRef, useState, type ReactNode } from "react";
import useSWR from "swr";
import {
  MessageSquare,
  Play,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  SECONDARY_CHROME_BODY_GUTTER_CLASS,
  SecondaryIconButton,
  SecondarySegmentedButton,
  SecondarySegmentedControl,
  SecondaryToolbar,
} from "@/components/layout/SecondaryToolbar";
import { ThreadDrawer } from "@/components/threads/ThreadDrawer";
import {
  resolutionStory,
  resolvedAt,
  resolvedRecently,
  targetIcon,
  targetLabel,
} from "@/components/threads/threadTargetHelpers";
import { LoadingState } from "@/components/ui/LoadingState";
import { useIsMobile } from "@/hooks/useIsMobile";
import { THREAD_SUMMARIES_KEY } from "@/hooks/useThreadCounts";
import { withBasePath } from "@/lib/base-path";
import type { CommentTarget } from "@/lib/comments/types";
import type { ChatSessionSummary } from "@/lib/chat/types";
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

async function fetchChatSessions(url: string): Promise<{ sessions: ChatSessionSummary[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ sessions: ChatSessionSummary[] }>;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

export function SystemThreadsView({ modeSwitcher }: SystemThreadsViewProps) {
  const isMobile = useIsMobile();
  const [filter, setFilter] = useState<ThreadFilter>("open");
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [errorById, setErrorById] = useState<Record<string, string>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<ProcessAllProgress | null>(null);
  const [batchError, setBatchError] = useState<string | null>(null);
  const [selected, setSelected] = useState<{ threadId: string; target: CommentTarget } | null>(null);
  const batchAbortControllerRef = useRef<AbortController | null>(null);
  const { data, error, isLoading, isValidating, mutate } = useSWR<{ threads: ThreadSummary[] }, Error>(
    THREAD_SUMMARIES_KEY,
    fetchThreads,
    { keepPreviousData: true, refreshInterval: 15_000 },
  );
  const { data: chatSessionsData } = useSWR<{ sessions: ChatSessionSummary[] }, Error>(
    "/api/chat/sessions",
    fetchChatSessions,
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

  const sendingChatIds = useMemo(() => {
    const set = new Set<string>();
    for (const session of chatSessionsData?.sessions ?? []) {
      if (session.status === "sending") set.add(session.id);
    }
    return set;
  }, [chatSessionsData]);

  async function processAllOpenThreads() {
    if (batchRunning) {
      batchAbortControllerRef.current?.abort();
      return;
    }
    const controller = new AbortController();
    batchAbortControllerRef.current = controller;
    setBatchRunning(true);
    setBatchProgress({ index: 0, total: counts.open });
    setBatchError(null);
    try {
      await runProcessAll(setBatchProgress, controller.signal);
      await mutate();
    } catch (err) {
      if (isAbortError(err)) {
        setBatchError(null);
        await mutate();
      } else {
        setBatchError(err instanceof Error ? err.message : "Thread batch processing failed");
      }
    } finally {
      if (batchAbortControllerRef.current === controller) batchAbortControllerRef.current = null;
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
      <div className="relative min-h-0 flex-1 overflow-hidden">
        <div className="flex h-full min-w-0">
          <div data-mobile-scroll-chrome="bottom" className={`hilt-mobile-scroll-clearance hilt-mobile-scroll-extra-4 min-w-0 flex-1 overflow-auto px-4 ${SECONDARY_CHROME_BODY_GUTTER_CLASS}`}>
            {filteredThreads.length === 0 ? (
              <div className="flex h-full items-center justify-center text-sm text-[var(--text-tertiary)]">
                {filter === "all" ? "No threads" : `No ${filter} threads`}
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-default)] border-y border-[var(--border-default)]">
                {filteredThreads.map((thread) => {
                  const working = processingId === thread.id
                    || batchProgress?.threadId === thread.id
                    || Boolean(thread.chat_ids?.some((chatId) => sendingChatIds.has(chatId)));
                  return (
                    <ThreadRow
                      key={thread.id}
                      thread={thread}
                      selected={selected?.threadId === thread.id}
                      working={working}
                      processDisabled={Boolean(processingId) || batchRunning}
                      error={errorById[thread.id] ?? null}
                      onSelect={() => setSelected({ threadId: thread.id, target: thread.target })}
                      onProcess={() => void processThread(thread.id)}
                    />
                  );
                })}
              </div>
            )}
          </div>
          {selected && !isMobile ? (
            <aside className="h-full w-[26rem] flex-shrink-0 border-l border-[var(--border-default)]">
              {/* Keyed per thread: switching rows remounts the drawer, so an in-flight process
                  stream aborts (unmount cleanup) instead of bleeding into another thread. */}
              <ThreadDrawer
                key={selected.threadId}
                threadId={selected.threadId}
                target={selected.target}
                onClose={() => setSelected(null)}
                onProcessingChange={(active) => setProcessingId(active ? selected.threadId : null)}
                onFollowThread={(id) => setSelected({ threadId: id, target: selected.target })}
              />
            </aside>
          ) : null}
        </div>
        {selected && isMobile ? (
          <div className="absolute inset-0 z-10">
            <ThreadDrawer
              key={selected.threadId}
              threadId={selected.threadId}
              target={selected.target}
              onClose={() => setSelected(null)}
              onProcessingChange={(active) => setProcessingId(active ? selected.threadId : null)}
              onFollowThread={(id) => setSelected({ threadId: id, target: selected.target })}
            />
          </div>
        ) : null}
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
          {counts.open > 0 || batchRunning ? (
            <>
              {batchRunning ? (
                <span className="hidden text-xs font-medium text-emerald-600 sm:inline">
                  Processing {batchProgress?.index ?? 0}/{batchProgress?.total ?? counts.open}
                </span>
              ) : null}
              <button
                type="button"
                onClick={onProcessAll}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors hover:bg-[var(--bg-tertiary)] ${
                  batchRunning
                    ? "text-red-500 hover:text-red-600"
                    : batchError
                      ? "text-red-500"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                {batchRunning ? <X className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
                <span>{batchRunning ? "Cancel" : "Process all"}</span>
              </button>
            </>
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
  selected,
  working,
  processDisabled,
  error,
  onSelect,
  onProcess,
}: {
  thread: ThreadSummary;
  selected: boolean;
  working: boolean;
  processDisabled: boolean;
  error: string | null;
  onSelect: () => void;
  onProcess: () => void;
}) {
  const Icon = targetIcon(thread.target);
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
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onSelect();
          }
        }}
        className={`group flex cursor-pointer items-center gap-3 border-l-2 px-2 py-2 transition-colors ${
          selected
            ? "border-blue-500/30 bg-blue-500/5 hover:bg-blue-500/10"
            : "border-transparent hover:bg-[var(--bg-secondary)]"
        }`}
      >
        <Icon className="h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
        <div className="min-w-0 flex-1">{middle}</div>
        {thread.dev_item ? (
          <span
            className="hidden shrink-0 items-center rounded border border-amber-500/20 bg-amber-500/5 px-1.5 text-[11px] leading-5 text-amber-600 md:inline-flex"
            title={`Diagnosed ${thread.dev_item.diagnosed_at}`}
          >
            Dev item
          </span>
        ) : null}
        <ThreadStatus thread={thread} working={working} />
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
        {thread.status === "open" && !working ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onProcess();
            }}
            disabled={processDisabled}
            className="inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-medium opacity-0 text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] focus-within:opacity-100 group-hover:opacity-100 disabled:cursor-default disabled:opacity-0"
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden md:inline">Process</span>
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

function ThreadStatus({ thread, working }: { thread: ThreadSummary; working: boolean }) {
  if (working) {
    return (
      <div className="hidden shrink-0 items-center gap-1.5 text-xs font-medium text-emerald-600 md:flex">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
        <span>Processing</span>
      </div>
    );
  }

  return (
    <div className="hidden shrink-0 items-center gap-1.5 text-xs text-[var(--text-tertiary)] md:flex">
      {thread.status === "open" ? (
        <span>Open</span>
      ) : (
        <>
          {/* House unread idiom (ViewToggle/Library blue dot): resolved in the last 24h =
              news you likely haven't seen — "the loop handled this overnight". */}
          {resolvedRecently(thread) ? (
            <span
              className="h-1.5 w-1.5 rounded-full bg-blue-500"
              title="Resolved in the last 24 hours"
            />
          ) : null}
          <span className="text-[var(--text-quaternary)]" title={resolvedAt(thread)}>
            {resolutionStory(thread)}
          </span>
        </>
      )}
    </div>
  );
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
