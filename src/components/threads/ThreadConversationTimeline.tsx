"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Check, Pencil, Trash2, X } from "lucide-react";
import { ChatTracePanel } from "@/components/chat/ChatTracePanel";
import { ConversationTurn } from "@/components/chat/ConversationTurn";
import { THREAD_SUMMARIES_KEY } from "@/hooks/useThreadCounts";
import { withBasePath } from "@/lib/base-path";
import type { ChatSession } from "@/lib/chat/types";
import type { Thread, ThreadMessage, ThreadOutcome } from "@/lib/threads/types";
import { outcomeStory, resolutionStory, resolvedAt } from "./threadTargetHelpers";

async function fetchChatSession(url: string): Promise<ChatSession | null> {
  const response = await fetch(withBasePath(url), { cache: "no-store" });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<ChatSession>;
}

async function requestJson(url: string, init: RequestInit): Promise<void> {
  const response = await fetch(withBasePath(url), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
}

function isHumanMessage(message: ThreadMessage): boolean {
  return message.author === "justin" || message.author === "claude-sim";
}

function outcomeForAgent(outcomes: ThreadOutcome[], agentIndex: number): ThreadOutcome | null {
  return outcomes[agentIndex] ?? null;
}

function chatTurnIndex(outcomes: ThreadOutcome[], outcomeIndex: number): number {
  const outcome = outcomes[outcomeIndex];
  if (!outcome?.chat_id) return -1;
  return outcomes.slice(0, outcomeIndex).filter((candidate) => candidate.chat_id === outcome.chat_id).length;
}

function normalizedReply(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function TurnActivity({
  chatId,
  turnIndex,
  markRead,
  replyText,
  replyTimestamp,
}: {
  chatId: string;
  turnIndex: number;
  markRead: boolean;
  replyText: string;
  replyTimestamp: string;
}) {
  const key = `/api/chat/sessions/${chatId}`;
  const { data, mutate } = useSWR<ChatSession | null>(key, fetchChatSession, { keepPreviousData: true });
  const markingReadRef = useRef(false);
  const assistantMessages = data?.messages.filter((message) => message.role === "assistant") ?? [];
  const normalized = normalizedReply(replyText);
  const replyTime = Date.parse(replyTimestamp);
  const contentMatches = assistantMessages.filter((candidate) => normalizedReply(candidate.content) === normalized);
  const message = contentMatches.length > 0
    ? [...contentMatches].sort((left, right) => (
        Math.abs(left.timestamp - replyTime) - Math.abs(right.timestamp - replyTime)
      ))[0]
    : turnIndex >= 0
      ? (assistantMessages[turnIndex] ?? null)
      : (assistantMessages.at(-1) ?? null);

  useEffect(() => {
    if (!markRead || !data || data.unreadCount <= 0 || markingReadRef.current) return;
    markingReadRef.current = true;
    // An attached processor turn is read when its parent conversation is open. The request is
    // intentionally best-effort; the latch prevents repeated PATCHes while SWR revalidates.
    void fetch(withBasePath(key), {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unreadCount: 0 }),
    }).then((response) => {
      if (!response.ok) return;
      return Promise.all([mutate(), globalMutate("/api/chat/sessions"), globalMutate(THREAD_SUMMARIES_KEY)]);
    }).catch(() => undefined).finally(() => { markingReadRef.current = false; });
  }, [data, key, markRead, mutate]);

  if (!message || ((message.trace?.length ?? 0) === 0 && (message.filesTouched?.length ?? 0) === 0)) return null;
  return <ChatTracePanel trace={message.trace ?? []} filesTouched={message.filesTouched} />;
}

function MessageActions({
  editing,
  busy,
  onEdit,
  onDelete,
  onSave,
  onCancel,
}: {
  editing: boolean;
  busy: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <span className="flex items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
      {editing ? (
        <>
          <button
            type="button"
            onClick={onSave}
            disabled={busy}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title="Save edit"
            aria-label="Save edit"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title="Cancel edit"
            aria-label="Cancel edit"
          >
            <X className="h-3 w-3" />
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            onClick={onEdit}
            disabled={busy}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            title="Edit comment"
            aria-label="Edit comment"
          >
            <Pencil className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={busy}
            className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-red-500 disabled:opacity-40"
            title="Delete comment"
            aria-label="Delete comment"
          >
            <Trash2 className="h-3 w-3" />
          </button>
        </>
      )}
    </span>
  );
}

export function ThreadConversationTimeline({
  thread,
  onChanged,
}: {
  thread: Thread;
  onChanged: () => void;
}) {
  const outcomes = thread.outcomes ?? [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seenChatIds = new Set<string>();
  let agentIndex = 0;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditingId(null);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function saveEdit(messageId: string) {
    const text = draft.trim();
    if (!text) return;
    void run(() => requestJson(`/api/threads/${thread.id}`, {
      method: "PATCH",
      body: JSON.stringify({ messageId, text }),
    }));
  }

  function onEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>, messageId: string) {
    if (event.key === "Escape") {
      event.preventDefault();
      setEditingId(null);
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      saveEdit(messageId);
    }
  }

  return (
    <div className="space-y-3.5" role="log" aria-live="polite">
      {thread.messages.map((message) => {
        if (isHumanMessage(message)) {
          const editing = editingId === message.id;
          const actions = message.author === "justin" ? (
            <MessageActions
              editing={editing}
              busy={busy}
              onEdit={() => { setEditingId(message.id); setDraft(message.text); setError(null); }}
              onDelete={() => void run(() => requestJson(`/api/threads/${thread.id}/messages/${message.id}`, { method: "DELETE" }))}
              onSave={() => saveEdit(message.id)}
              onCancel={() => setEditingId(null)}
            />
          ) : null;
          return editing ? (
            <ConversationTurn
              key={message.id}
              role="user"
              timestamp={message.edited_at ?? message.created_at}
              edited={Boolean(message.edited_at)}
              statusLabel={thread.status === "open" && !message.handled_at ? "Queued" : undefined}
              actions={actions}
            >
              <textarea
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => onEditKeyDown(event, message.id)}
                autoFocus
                name="thread-message-edit"
                rows={Math.min(5, Math.max(2, draft.split("\n").length))}
                className="mt-0.5 w-full min-w-56 resize-none rounded-md border border-white/20 bg-white/10 px-2 py-1.5 text-[13px] leading-[1.5] text-inherit placeholder:text-white/60 focus:outline-none focus:ring-1 focus:ring-white/60"
                aria-label="Edit comment"
              />
            </ConversationTurn>
          ) : (
            <ConversationTurn
              key={message.id}
              role="user"
              content={message.text}
              timestamp={message.edited_at ?? message.created_at}
              edited={Boolean(message.edited_at)}
              statusLabel={thread.status === "open" && !message.handled_at ? "Queued" : undefined}
              actions={actions}
            />
          );
        }

        const currentAgentIndex = agentIndex++;
        const outcome = outcomeForAgent(outcomes, currentAgentIndex);
        const outcomeIndex = outcome ? outcomes.indexOf(outcome) : -1;
        const chatId = outcome?.chat_id ?? thread.chat_ids?.[currentAgentIndex] ?? null;
        const markRead = Boolean(chatId && !seenChatIds.has(chatId));
        if (chatId) seenChatIds.add(chatId);
        return (
          <ConversationTurn
            key={message.id}
            role="assistant"
            content={message.text}
            timestamp={message.created_at}
            statusLabel={outcome ? outcomeStory(outcome) : undefined}
          >
            {chatId ? (
              <TurnActivity
                chatId={chatId}
                turnIndex={outcomeIndex >= 0 ? chatTurnIndex(outcomes, outcomeIndex) : -1}
                markRead={markRead}
                replyText={message.text}
                replyTimestamp={message.created_at}
              />
            ) : null}
          </ConversationTurn>
        );
      })}

      {thread.status === "resolved" ? (
        <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-tertiary)]" title={resolvedAt(thread)}>
          <Check className="h-3 w-3" />
          {resolutionStory(thread)}
        </div>
      ) : null}
      {error ? <p className="text-xs text-red-500">{error}</p> : null}
    </div>
  );
}
