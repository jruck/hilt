"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Check, Play, X } from "lucide-react";
import { ChatComposer } from "@/components/chat/ChatComposer";
import { ChatTracePanel } from "@/components/chat/ChatTracePanel";
import { ConversationTurn } from "@/components/chat/ConversationTurn";
import { consumeNdjsonStream, mergeTraceEvent } from "@/components/chat/stream";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";
import { useScope } from "@/contexts/ScopeContext";
import { THREAD_SUMMARIES_KEY } from "@/hooks/useThreadCounts";
import { withBasePath } from "@/lib/base-path";
import type { ChatStreamEvent, ChatTraceEvent } from "@/lib/chat/types";
import { postComment } from "@/lib/comments/post";
import type { CommentTarget } from "@/lib/comments/types";
import type { Thread } from "@/lib/threads/types";
import { mutateThreadsForTarget, threadsUrlForTarget } from "./ThreadView";
import { ThreadConversationTimeline } from "./ThreadConversationTimeline";
import {
  outcomeStory,
  resolutionStory,
  resolvedAt,
  targetIcon,
  targetLabel,
  targetOpenHandler,
} from "./threadTargetHelpers";

export interface ThreadDrawerProps {
  threadId: string;
  target: CommentTarget;
  onClose: () => void;
  onProcessingChange?: (processing: boolean) => void;
  /** Follow the conversation when it moves: only a comment posted after an explicit close
   * starts a fresh thread on the same target. */
  onFollowThread?: (threadId: string) => void;
  /** Deep-link handoff from an async comment surface: open this pane, then start one live turn. */
  autoProcess?: boolean;
  onAutoProcessConsumed?: () => void;
}

async function fetchThreads(url: string): Promise<{ threads: Thread[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ threads: Thread[] }>;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function statusLine(thread: Thread | null): string {
  if (!thread) return "Loading";
  const pending = thread.messages.filter((message) => (
    (message.author === "justin" || message.author === "claude-sim") && !message.handled_at
  )).length;
  if (thread.status === "open" && pending > 0) return `${pending} ${pending === 1 ? "comment" : "comments"} ready to process`;
  if (thread.status === "open" && thread.dev_item) {
    return `Dev item · diagnosed ${formatRelativeDate(thread.dev_item.diagnosed_at)}`;
  }
  const outcome = thread.outcomes?.[thread.outcomes.length - 1];
  if (thread.status === "open" && outcome) return `${outcomeStory(outcome)} · ${formatRelativeDate(outcome.at)}`;
  if (thread.status === "open") return `Open · ${formatRelativeDate(thread.updated_at)}`;
  return `${resolutionStory(thread)} · ${formatRelativeDate(resolvedAt(thread))}`;
}

export function ThreadDrawer({
  threadId,
  target,
  onClose,
  onProcessingChange,
  onFollowThread,
  autoProcess = false,
  onAutoProcessConsumed,
}: ThreadDrawerProps) {
  const threadKey = useMemo(() => threadsUrlForTarget(target), [target]);
  const { navigateTo } = useScope();
  const { data, error, mutate } = useSWR<{ threads: Thread[] }, Error>(threadKey, fetchThreads, {
    keepPreviousData: true,
  });
  const thread = data?.threads.find((candidate) => candidate.id === threadId) ?? null;
  const Icon = targetIcon(target);
  const openTarget = targetOpenHandler(target, navigateTo);
  const pendingCount = thread?.messages.filter((message) => (
    (message.author === "justin" || message.author === "claude-sim") && !message.handled_at
  )).length ?? 0;
  const firstHumanMessage = thread?.messages.find((message) => (
    message.author === "justin" || message.author === "claude-sim"
  ));
  const conversationTitle = firstHumanMessage?.text.replace(/\s+/g, " ").trim().slice(0, 96)
    || targetLabel(target);

  const [processing, setProcessing] = useState(false);
  const [liveTrace, setLiveTrace] = useState<ChatTraceEvent[]>([]);
  const [liveDraft, setLiveDraft] = useState("");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState(Date.now());
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const processingRef = useRef(false);
  const queuedProcessThreadIdRef = useRef<string | null>(null);
  const autoProcessStartedRef = useRef(false);
  const liveChatIdRef = useRef<string | null>(null);
  const processThreadRef = useRef<(requestedThreadId?: string | null) => Promise<void>>(async () => undefined);
  const onProcessingChangeRef = useRef(onProcessingChange);
  const conversationEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    onProcessingChangeRef.current = onProcessingChange;
  }, [onProcessingChange]);

  // Escape closes the drawer (TaskFilePanel parity) — but a composer draft is protected:
  // first Escape only blurs the textarea, a second one closes.
  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (event.key !== "Escape") return;
      const active = document.activeElement;
      if (active instanceof HTMLTextAreaElement && active.value.trim()) {
        active.blur();
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (!processing) return;
    conversationEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [processing, liveDraft, liveTrace.length]);

  useEffect(() => {
    return () => {
      const controller = abortControllerRef.current;
      if (!controller) return;
      controller.abort();
      abortControllerRef.current = null;
      onProcessingChangeRef.current?.(false);
    };
  }, []);

  async function processThread(requestedThreadId: string | null = thread?.id ?? null) {
    if (!requestedThreadId || processingRef.current) return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    processingRef.current = true;
    let failed = false;
    setProcessing(true);
    onProcessingChange?.(true);
    liveChatIdRef.current = null;
    setLiveTrace([]);
    setLiveDraft("");
    setLiveError(null);
    setLiveStartedAt(Date.now());

    try {
      const response = await fetch(withBasePath(`/api/threads/${requestedThreadId}/process`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed: ${response.status}`);
      }

      await consumeNdjsonStream<ChatStreamEvent>(response, (event) => {
        if (event.type === "session") {
          liveChatIdRef.current = event.chatId;
          void mutate();
          return;
        }
        if (event.type === "trace") {
          setLiveTrace((current) => mergeTraceEvent(current, event.trace));
          return;
        }
        if (event.type === "message") {
          setLiveDraft((current) => current + event.content);
          return;
        }
        if (event.type === "error" && !controller.signal.aborted) {
          failed = true;
          setLiveError(event.error);
        }
      });
    } catch (err) {
      if (!controller.signal.aborted && !isAbortError(err)) {
        failed = true;
        setLiveError(err instanceof Error ? err.message : "Thread processing failed");
      }
    } finally {
      const finalChatId = liveChatIdRef.current;
      await Promise.all([
        mutateThreadsForTarget(target),
        globalMutate(THREAD_SUMMARIES_KEY),
        globalMutate("/api/chat/sessions"),
        finalChatId ? globalMutate(`/api/chat/sessions/${finalChatId}`) : Promise.resolve(),
      ]).catch(() => undefined);
      if (abortControllerRef.current === controller) abortControllerRef.current = null;
      processingRef.current = false;
      setProcessing(false);
      onProcessingChange?.(false);
      if (!failed || controller.signal.aborted) {
        liveChatIdRef.current = null;
        setLiveTrace([]);
        setLiveDraft("");
        setLiveError(null);
      }
      const queuedThreadId = queuedProcessThreadIdRef.current;
      queuedProcessThreadIdRef.current = null;
      if (queuedThreadId && !controller.signal.aborted) {
        window.setTimeout(() => { void processThread(queuedThreadId); }, 0);
      }
    }
  }

  processThreadRef.current = processThread;

  useEffect(() => {
    if (!autoProcess) {
      autoProcessStartedRef.current = false;
      return;
    }
    if (!thread || autoProcessStartedRef.current) return;
    autoProcessStartedRef.current = true;
    onAutoProcessConsumed?.();
    const pending = thread.messages.some((message) => (
      (message.author === "justin" || message.author === "claude-sim") && !message.handled_at
    ));
    if (thread.status === "open" && pending) void processThreadRef.current(thread.id);
  }, [autoProcess, thread, onAutoProcessConsumed]);

  async function resolveManually() {
    if (!thread || resolving) return;
    setResolving(true);
    setResolveError(null);
    try {
      const response = await fetch(withBasePath(`/api/threads/${thread.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ resolveAction: "closed", by: "justin" }),
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || `Request failed: ${response.status}`);
      }
      await Promise.all([mutate(), mutateThreadsForTarget(target), globalMutate(THREAD_SUMMARIES_KEY)]);
    } catch (err) {
      setResolveError(err instanceof Error ? err.message : "Failed to close conversation");
    } finally {
      setResolving(false);
    }
  }

  async function submitComment(text: string) {
    const trimmed = text.trim();
    if (!trimmed || commentBusy) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      const postedThread = await postComment(target, trimmed);
      await mutateThreadsForTarget(target);
      await mutate();
      if (postedThread.id !== threadId) {
        onFollowThread?.(postedThread.id);
        navigateTo("chats", `/${postedThread.id}/process`);
      } else if (processingRef.current) {
        // The active run snapshots pending messages at start. A comment arriving mid-run is
        // deliberately the next volley, never silently folded into the in-flight answer.
        queuedProcessThreadIdRef.current = postedThread.id;
      } else {
        void processThread(postedThread.id);
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setCommentBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--content-surface,var(--bg-primary))]">
      <header className="flex-shrink-0 border-b border-[var(--border-default)] px-3 py-2.5">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-[var(--text-primary)]" title={conversationTitle}>
              {conversationTitle}
            </div>
            <div className="mt-0.5 flex min-w-0 items-center gap-1.5 truncate text-[11px] text-[var(--text-tertiary)]">
              {openTarget ? (
                <button
                  type="button"
                  onClick={openTarget}
                  className="shrink-0 transition-colors hover:text-[var(--text-primary)]"
                >
                  {targetLabel(target)}
                </button>
              ) : <span className="shrink-0">{targetLabel(target)}</span>}
              <span aria-hidden="true">·</span>
              <span className="truncate" title={thread?.status === "resolved" ? resolvedAt(thread) : undefined}>
                {statusLine(thread)}
              </span>
            </div>
          </div>
          {thread?.status === "open" && pendingCount > 0 ? (
            <button
              type="button"
              onClick={() => void processThread()}
              disabled={processing}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:text-emerald-600"
              title={processing ? "Processing" : "Process now"}
              aria-label={processing ? "Processing" : "Process now"}
            >
              <Play className={`h-3.5 w-3.5 ${processing ? "animate-pulse" : ""}`} />
            </button>
          ) : null}
          {thread?.status === "open" ? (
            <button
              type="button"
              onClick={() => void resolveManually()}
              disabled={processing || resolving}
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
              title="Close conversation"
              aria-label="Close conversation"
            >
              <Check className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            title="Close pane"
            aria-label="Close pane"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {thread ? (
          <ThreadConversationTimeline
            thread={thread}
            onChanged={() => void mutateThreadsForTarget(target)}
          />
        ) : (
          <div className="py-2 text-xs text-[var(--text-tertiary)]">
            {error ? error.message : "Loading conversation"}
          </div>
        )}

        {(processing || liveError) && (
          <div className="mt-3.5">
            <ConversationTurn
              role="assistant"
              content={liveDraft}
              timestamp={!processing ? liveStartedAt : undefined}
              statusLabel={liveError ? "Turn failed" : undefined}
            >
              {!liveDraft.trim() && processing ? (
                <div className="flex items-center gap-2 text-[12px] text-[var(--text-tertiary)]" role="status">
                  <span className="flex items-center gap-0.5" aria-hidden="true">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70 animate-pulse [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/40 animate-pulse [animation-delay:300ms]" />
                  </span>
                  <span>Working</span>
                </div>
              ) : null}
              <ChatTracePanel trace={liveTrace} />
            </ConversationTurn>
            {liveError ? <p className="mt-1 text-xs text-red-500">{liveError}</p> : null}
          </div>
        )}
        {resolveError ? <p className="mt-2 text-xs text-red-500">{resolveError}</p> : null}
        <div ref={conversationEndRef} />
      </div>

      <div className="flex-shrink-0 border-t border-[var(--border-default)] bg-[var(--content-surface,var(--bg-primary))] px-3 py-3">
        <ChatComposer
          onSend={(text) => void submitComment(text)}
          onStop={processing ? () => abortControllerRef.current?.abort() : undefined}
          sending={processing || commentBusy}
          placeholder="Reply and process now"
        />
        {commentError ? <p className="mt-1 text-xs text-red-500">{commentError}</p> : null}
      </div>
    </div>
  );
}
