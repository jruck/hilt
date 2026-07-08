"use client";

/**
 * ThreadView — read-only rendering of every thread anchored to ONE CommentTarget (v3 C2 UI).
 *
 * The thread-under-object pattern: an object's detail surface (task pane, meeting card)
 * renders its conversation as a quiet section UNDER the body — dense message rows, tertiary
 * metadata, no chrome when there is nothing to say (empty/loading/error states render
 * NOTHING; the section only exists once a comment does).
 *
 * - Fetches GET /api/threads?target=<json> via SWR keyed on `threadsUrlForTarget(target)`.
 *   Posting surfaces (CommentBox/VerdictNoteField onPosted) refresh the section through
 *   `mutateThreadsForTarget(target)` — same key, global mutate, no prop threading.
 * - Author chip: "You" for justin, the loop name for `agent:<loop>`, else the raw author.
 * - justin-authored messages carry hover-revealed edit/delete (comments are uniformly
 *   editable/deletable — settled decision): inline edit → PATCH /api/threads/[id]
 *   {messageId, text}; trash → DELETE /api/threads/[id]/messages/[messageId] (deleting the
 *   last message deletes the thread — the section simply disappears).
 * - Resolution/processed stamps render as quiet tertiary metadata lines per thread.
 * - Open threads carry a quiet Process affordance for running the active processor.
 */
import { useState, type FormEvent } from "react";
import useSWR, { mutate as globalMutate } from "swr";
import { Check, MessageSquare, Pencil, Play, Trash2, X } from "lucide-react";
import { withBasePath } from "@/lib/base-path";
import type { CommentTarget } from "@/lib/comments/types";
import { runThreadProcess } from "@/lib/threads/process-client";
import type { Thread, ThreadMessage } from "@/lib/threads/types";
import { formatRelativeDate } from "@/components/tasks/ProposalsSection";

/** The SWR key for one anchor's threads — shared by ThreadView and posting surfaces. */
export function threadsUrlForTarget(target: CommentTarget): string {
  return `/api/threads?target=${encodeURIComponent(JSON.stringify(target))}`;
}

/** Revalidate an anchor's ThreadView after a post lands (CommentBox/VerdictNoteField onPosted). */
export function mutateThreadsForTarget(target: CommentTarget): Promise<unknown> {
  return globalMutate(threadsUrlForTarget(target));
}

function authorChipLabel(author: string): string {
  if (author === "justin") return "You";
  if (author.startsWith("agent:")) return author.slice("agent:".length) || "agent";
  return author;
}

async function fetchThreads(url: string): Promise<{ threads: Thread[] }> {
  const response = await fetch(withBasePath(url));
  if (!response.ok) throw new Error(`Request failed: ${response.status}`);
  return response.json() as Promise<{ threads: Thread[] }>;
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

export interface ThreadViewProps {
  target: CommentTarget;
  /** Section mini-header (History-section idiom) — rendered only when threads exist. */
  title?: string;
  /** Applied to the root — which only renders when there is at least one thread. */
  className?: string;
}

export function ThreadView({ target, title, className }: ThreadViewProps) {
  const { data, mutate } = useSWR<{ threads: Thread[] }>(
    threadsUrlForTarget(target),
    fetchThreads,
    { keepPreviousData: true },
  );
  const threads = data?.threads ?? [];
  if (threads.length === 0) return null;

  return (
    <div className={className}>
      {title && (
        <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
          <MessageSquare className="w-3 h-3" />
          {title}
        </div>
      )}
      <div className={`divide-y divide-[var(--border-default)] ${title ? "mt-1" : ""}`}>
        {threads.map((thread) => (
          <ThreadBlock key={thread.id} thread={thread} onChanged={() => void mutate()} />
        ))}
      </div>
    </div>
  );
}

function ThreadBlock({ thread, onChanged }: { thread: Thread; onChanged: () => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  function saveEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || !editingId) return;
    void run(() => requestJson(`/api/threads/${thread.id}`, {
      method: "PATCH",
      body: JSON.stringify({ messageId: editingId, text }),
    }));
  }

  function deleteMessage(messageId: string) {
    void run(() => requestJson(`/api/threads/${thread.id}/messages/${messageId}`, { method: "DELETE" }));
  }

  async function processThread() {
    setProcessing(true);
    setError(null);
    try {
      await runThreadProcess(thread.id);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thread processing failed");
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="py-1.5 first:pt-1 last:pb-0">
      {thread.messages.map((message) => (
        <MessageRow
          key={message.id}
          message={message}
          editing={editingId === message.id}
          draft={draft}
          busy={busy}
          onDraftChange={setDraft}
          onStartEdit={() => { setEditingId(message.id); setDraft(message.text); setError(null); }}
          onCancelEdit={() => setEditingId(null)}
          onSaveEdit={saveEdit}
          onDelete={() => deleteMessage(message.id)}
        />
      ))}
      {thread.resolution && (
        <div className="py-0.5 text-[11px] text-[var(--text-tertiary)]" title={thread.resolution.at}>
          Resolved · {thread.resolution.action} · {formatRelativeDate(thread.resolution.at)}
        </div>
      )}
      {thread.processed && (
        <div className="py-0.5 text-[11px] text-[var(--text-tertiary)]" title={thread.processed.at}>
          Processed · {formatRelativeDate(thread.processed.at)}
        </div>
      )}
      {thread.status === "resolved" && !thread.resolution && !thread.processed && (
        <div className="py-0.5 text-[11px] text-[var(--text-tertiary)]">Resolved</div>
      )}
      {thread.status === "open" && (
        <div className="py-0.5">
          <button
            type="button"
            onClick={() => void processThread()}
            disabled={processing || busy}
            className={`inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium transition-colors disabled:cursor-default disabled:opacity-60 ${
              processing
                ? "text-emerald-600"
                : "text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            }`}
          >
            <Play className={`h-3 w-3 ${processing ? "animate-pulse" : ""}`} />
            {processing ? "Processing" : "Process"}
          </button>
        </div>
      )}
      {error && <p className="py-0.5 text-xs text-red-500">{error}</p>}
    </div>
  );
}

function MessageRow({
  message,
  editing,
  draft,
  busy,
  onDraftChange,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onDelete,
}: {
  message: ThreadMessage;
  editing: boolean;
  draft: string;
  busy: boolean;
  onDraftChange: (value: string) => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: () => void;
}) {
  const mine = message.author === "justin";

  return (
    <div className="group flex items-baseline gap-2 py-0.5">
      <span className="flex-shrink-0 rounded bg-[var(--bg-secondary)] px-1.5 py-px text-[10px] font-medium text-[var(--text-secondary)]">
        {authorChipLabel(message.author)}
      </span>
      {editing ? (
        <form onSubmit={onSaveEdit} className="flex min-w-0 flex-1 items-center gap-1.5">
          <input
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={(event) => { if (event.key === "Escape") onCancelEdit(); }}
            autoFocus
            className="min-h-7 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            aria-label="Edit comment"
          />
          <button
            type="submit"
            disabled={!draft.trim() || busy}
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
            title="Save edit"
            aria-label="Save edit"
          >
            <Check className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={onCancelEdit}
            className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
            title="Cancel edit"
            aria-label="Cancel edit"
          >
            <X className="h-3 w-3" />
          </button>
        </form>
      ) : (
        <>
          <span className="min-w-0 flex-1 break-words text-xs leading-relaxed text-[var(--text-primary)]">
            {message.text}
          </span>
          <span
            className="flex-shrink-0 text-[11px] text-[var(--text-quaternary)]"
            title={`${message.created_at}${message.edited_at ? ` · edited ${message.edited_at}` : ""}`}
          >
            {message.edited_at ? "edited · " : ""}{formatRelativeDate(message.created_at)}
          </span>
          {mine && (
            <span className="flex flex-shrink-0 items-center gap-0.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
              <button
                type="button"
                onClick={onStartEdit}
                disabled={busy}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
                title="Edit comment"
                aria-label="Edit comment"
              >
                <Pencil className="h-3 w-3" />
              </button>
              <button
                type="button"
                onClick={onDelete}
                disabled={busy}
                className="inline-flex h-5 w-5 items-center justify-center rounded text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-red-500 disabled:cursor-default disabled:opacity-50"
                title="Delete comment"
                aria-label="Delete comment"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </span>
          )}
        </>
      )}
    </div>
  );
}
