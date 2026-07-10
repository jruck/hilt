"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { MessageSquare, Play, Send, X } from "lucide-react";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { consumeNdjsonStream, mergeTraceEvent } from "@/components/chat/stream";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";
import { useScope } from "@/contexts/ScopeContext";
import { THREAD_SUMMARIES_KEY } from "@/hooks/useThreadCounts";
import { withBasePath } from "@/lib/base-path";
import type { ChatMessage, ChatSession, ChatStreamEvent, ChatTraceEvent } from "@/lib/chat/types";
import { postComment } from "@/lib/comments/post";
import type { CommentTarget } from "@/lib/comments/types";
import type { Thread } from "@/lib/threads/types";
import { mutateThreadsForTarget, ThreadBlock, threadsUrlForTarget } from "./ThreadView";
import {
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
  /** Follow the conversation when it moves: a comment posted while THIS thread is resolved
   * starts a fresh open thread on the same target (append-to-open semantics) — without
   * re-selection the reply lands invisibly outside the pinned id (adversarial finding). */
  onFollowThread?: (threadId: string) => void;
}

async function fetchThreads(url: string): Promise<{ threads: Thread[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<{ threads: Thread[] }>;
}

async function fetchChatSession(url: string): Promise<ChatSession | null> {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<ChatSession>;
}

function isAbortError(error: unknown): boolean {
  return (error instanceof DOMException || error instanceof Error) && error.name === "AbortError";
}

function statusLine(thread: Thread | null): string {
  if (!thread) return "Loading";
  if (thread.status === "open") return `Open · ${formatRelativeDate(thread.updated_at)}`;
  return `${resolutionStory(thread)} · ${formatRelativeDate(resolvedAt(thread))}`;
}

function failedLiveMessage(trace: ChatTraceEvent[], draft: string, timestamp: number): ChatMessage | null {
  if (trace.length === 0 && !draft.trim()) return null;
  return {
    id: "failed-live-turn",
    role: "assistant",
    content: draft,
    timestamp,
    ...(trace.length > 0 ? { trace } : {}),
  };
}

export function ThreadDrawer({ threadId, target, onClose, onProcessingChange, onFollowThread }: ThreadDrawerProps) {
  const threadKey = useMemo(() => threadsUrlForTarget(target), [target]);
  const { navigateTo } = useScope();
  const { data, error, mutate } = useSWR<{ threads: Thread[] }, Error>(threadKey, fetchThreads, {
    keepPreviousData: true,
  });
  const thread = data?.threads.find((candidate) => candidate.id === threadId) ?? null;
  const Icon = targetIcon(target);
  const openTarget = targetOpenHandler(target, navigateTo);
  const chatIds = thread?.chat_ids ?? [];

  const [processing, setProcessing] = useState(false);
  const [liveChatId, setLiveChatId] = useState<string | null>(null);
  const [liveTrace, setLiveTrace] = useState<ChatTraceEvent[]>([]);
  const [liveDraft, setLiveDraft] = useState("");
  const [liveError, setLiveError] = useState<string | null>(null);
  const [liveStartedAt, setLiveStartedAt] = useState(Date.now());
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [commentError, setCommentError] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const liveChatIdRef = useRef<string | null>(null);
  const onProcessingChangeRef = useRef(onProcessingChange);

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
    liveChatIdRef.current = liveChatId;
  }, [liveChatId]);

  useEffect(() => {
    return () => {
      const controller = abortControllerRef.current;
      if (!controller) return;
      controller.abort();
      abortControllerRef.current = null;
      onProcessingChangeRef.current?.(false);
    };
  }, []);

  async function processThread() {
    if (!thread || processing || thread.status !== "open") return;

    const controller = new AbortController();
    abortControllerRef.current = controller;
    let failed = false;
    setProcessing(true);
    onProcessingChange?.(true);
    setLiveChatId(null);
    liveChatIdRef.current = null;
    setLiveTrace([]);
    setLiveDraft("");
    setLiveError(null);
    setLiveStartedAt(Date.now());

    try {
      const response = await fetch(withBasePath(`/api/threads/${thread.id}/process`), {
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
          setLiveChatId(event.chatId);
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
      setProcessing(false);
      onProcessingChange?.(false);
      if (!failed || controller.signal.aborted) {
        setLiveChatId(null);
        liveChatIdRef.current = null;
        setLiveTrace([]);
        setLiveDraft("");
        setLiveError(null);
      }
    }
  }

  async function submitComment(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    const trimmed = commentText.trim();
    if (!trimmed || commentBusy) return;
    setCommentBusy(true);
    setCommentError(null);
    try {
      await postComment(target, trimmed);
      setCommentText("");
      await mutateThreadsForTarget(target);
      const refreshed = await mutate();
      // Append-to-open semantics: posting under a RESOLVED thread minted a fresh open thread
      // on this target — follow it, or the reply is invisible in a drawer pinned to the old id.
      if (thread?.status === "resolved") {
        const followUp = refreshed?.threads.find(
          (candidate) => candidate.id !== threadId && candidate.status === "open",
        );
        if (followUp) onFollowThread?.(followUp.id);
      }
    } catch (err) {
      setCommentError(err instanceof Error ? err.message : "Failed to post comment");
    } finally {
      setCommentBusy(false);
    }
  }

  function onComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void submitComment();
    }
  }

  const suppressedChatId = liveChatId && (processing || liveError) ? liveChatId : null;
  const failedMessage = !processing && liveError ? failedLiveMessage(liveTrace, liveDraft, liveStartedAt) : null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--bg-primary)]">
      <header className="flex-shrink-0 border-b border-[var(--border-default)] px-3 py-2">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--text-tertiary)]" />
          <div className="min-w-0 flex-1">
            {openTarget ? (
              <button
                type="button"
                onClick={openTarget}
                className="block min-w-0 truncate text-left text-sm font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                {targetLabel(target)}
              </button>
            ) : (
              <div className="truncate text-sm font-medium text-[var(--text-secondary)]">{targetLabel(target)}</div>
            )}
            <div
              className="mt-0.5 truncate text-xs text-[var(--text-tertiary)]"
              title={thread?.status === "resolved" ? resolvedAt(thread) : undefined}
            >
              {statusLine(thread)}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            title="Close thread"
            aria-label="Close thread"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        <section>
          <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
            <MessageSquare className="h-3 w-3" />
            Thread
          </div>
          <div className="mt-1 border-y border-[var(--border-default)]">
            {thread ? (
              <ThreadBlock
                thread={thread}
                processAffordance="none"
                onChanged={() => void mutateThreadsForTarget(target)}
              />
            ) : (
              <div className="py-2 text-xs text-[var(--text-tertiary)]">
                {error ? error.message : "Loading thread"}
              </div>
            )}
          </div>
        </section>

        {chatIds.length > 0 && (
          <section className="mt-3 space-y-3">
            {chatIds.filter((chatId) => chatId !== suppressedChatId).map((chatId) => (
              <ChatTranscript key={chatId} chatId={chatId} />
            ))}
          </section>
        )}

        {(processing || failedMessage || liveError) && (
          <section className="mt-3 border-t border-[var(--border-default)] pt-2">
            <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
              Processor run · {formatRelativeDate(new Date(liveStartedAt).toISOString())}
            </div>
            <div className="mt-1">
              <ChatMessageList
                messages={failedMessage ? [failedMessage] : []}
                status={processing ? "sending" : "idle"}
                liveTrace={processing ? liveTrace : []}
                liveDraft={processing ? liveDraft : ""}
                scrollable={false}
              />
              {liveError ? <p className="mt-1 text-xs text-red-500">{liveError}</p> : null}
            </div>
          </section>
        )}

        {thread?.status === "open" && (
          <div className="mt-3 border-t border-[var(--border-default)] pt-2">
            <button
              type="button"
              onClick={() => void processThread()}
              disabled={processing}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${
                processing
                  ? "text-emerald-600"
                  : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
              }`}
            >
              <Play className={`h-3.5 w-3.5 ${processing ? "animate-pulse" : ""}`} />
              {processing ? "Processing" : "Process"}
            </button>
          </div>
        )}
      </div>

      <form onSubmit={submitComment} className="flex-shrink-0 border-t border-[var(--border-default)] px-3 py-2">
        <textarea
          value={commentText}
          onChange={(event) => setCommentText(event.target.value)}
          onKeyDown={onComposerKeyDown}
          rows={2}
          disabled={commentBusy}
          className="min-h-14 w-full resize-none rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
          placeholder="Comment"
          aria-label="Comment"
        />
        <div className="mt-1.5 flex items-center justify-end">
          <button
            type="submit"
            disabled={!commentText.trim() || commentBusy}
            className="inline-flex min-h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
            title="Send comment"
            aria-label="Send comment"
          >
            <Send className="h-3.5 w-3.5" />
          </button>
        </div>
        {commentError ? <p className="mt-1 text-xs text-red-500">{commentError}</p> : null}
      </form>
    </div>
  );
}

function ChatTranscript({ chatId }: { chatId: string }) {
  const { data, error } = useSWR<ChatSession | null, Error>(
    `/api/chat/sessions/${chatId}`,
    fetchChatSession,
    { keepPreviousData: true },
  );

  return (
    <section className="border-t border-[var(--border-default)] pt-2">
      <div className="text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
        Processor run{data ? ` · ${formatRelativeDate(new Date(data.createdAt).toISOString())}` : ""}
      </div>
      <div className="mt-1">
        {data === null ? (
          <p className="text-xs text-[var(--text-tertiary)]">Transcript pruned from disk.</p>
        ) : error ? (
          <p className="text-xs text-[var(--text-tertiary)]">Transcript could not be loaded.</p>
        ) : data ? (
          <ChatMessageList messages={data.messages} scrollable={false} />
        ) : (
          <p className="text-xs text-[var(--text-tertiary)]">Loading transcript</p>
        )}
      </div>
    </section>
  );
}
