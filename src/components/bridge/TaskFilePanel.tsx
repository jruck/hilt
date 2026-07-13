"use client";

/**
 * TaskFilePanel — the FILE-addressable task detail pane. Where BridgeTaskPanel is keyed to a
 * weekly-list row (positional selection), this pane is keyed to a task-file id (`t-…`) and
 * reads/writes ONLY through the task-object store (useTaskFile → /api/tasks/[id]) — so a
 * proposal, a done/dropped task, or a past-week task opens even with no weekly row.
 *
 * Editability follows the store's own rules:
 * - proposed/accepted/in-progress → title + body editable (PUT /api/tasks/[id]; body edits preserve
 *   the `## History` audit section, which renders read-only below the editor).
 * - proposed → editable task notes plus the SAME verdict actions as TaskCard, now in the house
 *   three-dot header menu (VerdictActionMenu; POST /api/loops/verdicts via origin). The pane
 *   stays open after a verdict showing the new state (approve → Accepted; dismiss → Dismissed
 *   badge over the last-known content — the file is deleted, SWR's stale data is the memory).
 * - done/dropped → read-only.
 *
 * Proposal layout (proposal-card cleanup, 2026-07-07): the provenance quote renders in the
 * BODY as a full-size blockquote (house .bridge-task-editor blockquote styling), and the
 * meeting linkage is a full MeetingObjectCard in the same slot BridgeTaskPanel gives its
 * pinned project cards — resolved via useObjectCard so it matches the pill popover exactly.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { History, MessageSquare } from "lucide-react";
import dynamic from "next/dynamic";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import { useTaskFile } from "@/hooks/useTaskFile";
import { useMeetingLedgerDetail } from "@/hooks/useMeetingLedger";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";
import { parseLifecycle } from "@/lib/attribution";
import { historyEntries, joinTaskBody, splitTaskBody } from "@/lib/tasks/task-body";
import type { ImplementedCommentTarget } from "@/lib/comments/types";
import { CommentPopover } from "@/components/comments/CommentPopover";
import { useVerdictNote, VerdictNoteField } from "@/components/comments/VerdictNoteField";
import { mutateThreadsForTarget, ThreadView } from "@/components/threads/ThreadView";
import { TaskMeetingActionSection } from "./TaskMeetingActionSection";
import { TaskMeetingLinkageCard } from "./TaskMeetingLinkageCard";
import {
  DueBadge,
  STATUS_BADGES,
  VerdictActionMenu,
  verdictBadgeClass,
  verdictBadgeLabel,
} from "@/components/tasks/TaskCard";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface TaskFilePanelProps {
  taskId: string;
  vaultPath?: string;
  onClose: () => void;
}

/** Proposed gets its own badge here (TaskCard's proposal surfaces never badge it — the verdict
 * buttons say it; this pane shows both). Dropped likewise (read-only terminal state). */
const PANE_STATUS_BADGES: typeof STATUS_BADGES = {
  ...STATUS_BADGES,
  proposed: { label: "Proposed", className: "bg-amber-500/10 text-amber-700 dark:text-amber-300" },
  dropped: { label: "Dropped", className: "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]" },
};

async function postVerdict(body: unknown): Promise<void> {
  const response = await fetch(withBasePath("/api/loops/verdicts"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
}

async function postTaskVerdict(taskId: string, verdict: Verdict, note?: string): Promise<void> {
  const response = await fetch(withBasePath(`/api/tasks/${encodeURIComponent(taskId)}/verdict`), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ verdict, ...(note ? { note } : {}) }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
}

export function TaskFilePanel({ taskId, vaultPath, onClose }: TaskFilePanelProps) {
  const { task: rawTask, store, isLoading, error, mutate } = useTaskFile(taskId);
  // keepPreviousData: a just-switched selection briefly serves the PREVIOUS task's file —
  // never render another task's content under this id (same guard as BridgeTaskPanel).
  // Exception below: after a dismiss the file is GONE and the stale data IS the memory.
  const [localVerdict, setLocalVerdict] = useState<Verdict | null>(null);
  const [busyVerdict, setBusyVerdict] = useState<Verdict | null>(null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  // The unified note (gate-B comment primitive): typed text rides ANY verdict click in one
  // POST; the field's own Send posts a pure comment (no decision) via postComment.
  const noteControl = useVerdictNote();
  const { reset: resetNote, setSaved: setNoteSaved } = noteControl;
  const task: TaskFile | null = rawTask && rawTask.id === taskId ? rawTask : null;
  const ledgerId = task?.origin?.loop === "meeting-actions" ? task.origin.item_id ?? null : null;
  const { data: ledgerDetail } = useMeetingLedgerDetail(ledgerId);
  const { navigateTo } = useScope();
  const commentTarget: ImplementedCommentTarget = task?.origin?.loop && task.origin.item_id
    ? { kind: "loop-item", loop: task.origin.loop, itemId: task.origin.item_id }
    : { kind: "task", id: taskId };

  // Reset verdict state when the pane re-targets another task.
  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setLocalVerdict(null);
      setBusyVerdict(null);
      setVerdictError(null);
      resetNote();
      setNoteSaved(false);
    });
    return () => {
      cancelled = true;
    };
  }, [taskId, resetNote, setNoteSaved]);

  const dismissed = localVerdict === "dismiss";
  const status = task?.status ?? null;
  const editable = (
    (store === "proposals" && status === "proposed")
    || (store === "tasks" && (status === "accepted-me" || status === "accepted-agent" || status === "in-progress"))
  ) && !localVerdict;
  const proposed = status === "proposed" && !localVerdict;

  // Body sections: the editor edits content; History stays read-only and is re-attached on
  // save from the LATEST fetched body (a transition landing mid-edit keeps its audit line).
  const split = task ? splitTaskBody(task.body) : null;
  const latestHistory = useRef<string | null>(null);
  useEffect(() => {
    if (split) latestHistory.current = split.history;
  }, [split?.history]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastSavedContent = useRef<string | null>(null);
  useEffect(() => {
    if (split) lastSavedContent.current = split.content.replace(/\n+$/, "");
  }, [task]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBodyChange = useCallback(
    (markdown: string) => {
      const normalized = markdown.replace(/\n+$/, "");
      if (normalized === lastSavedContent.current) return;
      lastSavedContent.current = normalized;
      void fetch(withBasePath(`/api/tasks/${taskId}`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: joinTaskBody(markdown, latestHistory.current) }),
      })
        .then(() => mutate())
        .catch((err) => console.error("[bridge/task-file] Failed to save task body:", err));
    },
    [taskId, mutate]
  );

  const [title, setTitle] = useState("");
  const lastSavedTitle = useRef<string | null>(null);
  useEffect(() => {
    if (task && task.title !== lastSavedTitle.current) {
      lastSavedTitle.current = task.title;
      queueMicrotask(() => setTitle(task.title));
    }
  }, [task]);
  const displayTitle = parseLifecycle(title, status === "done").displayTitle;

  function saveTitle(value: string) {
    const trimmed = value.trim();
    const lastDisplay = parseLifecycle(lastSavedTitle.current ?? "", status === "done").displayTitle;
    if (!trimmed) {
      setTitle(lastSavedTitle.current ?? "");
      return;
    }
    if (trimmed === lastDisplay) return;
    lastSavedTitle.current = trimmed;
    void fetch(withBasePath(`/api/tasks/${taskId}`), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: trimmed }),
    })
      .then(() => mutate())
      .catch((err) => console.error("[bridge/task-file] Failed to save task title:", err));
  }

  async function submitVerdict(verdict: Verdict, note?: string) {
    if (!task) return;
    setBusyVerdict(verdict);
    setVerdictError(null);
    try {
      if (task.origin?.loop && task.origin.item_id) {
        await postVerdict({
          loop: task.origin.loop,
          item_id: task.origin.item_id,
          verdict,
          ...(note ? { note } : {}),
        });
      } else {
        await postTaskVerdict(task.id, verdict, note);
      }
      // Revise keeps the item proposed (returns revised for a REAL verdict — TaskCard idiom).
      if (verdict !== "revise") setLocalVerdict(verdict);
      resetNote();
      mutate();
      // A note riding the verdict lands in the thread store (feedback adapter) — refresh the pane's thread section.
      void mutateThreadsForTarget(commentTarget);
    } catch (err) {
      setVerdictError(err instanceof Error ? err.message : "Failed to save verdict");
    } finally {
      setBusyVerdict(null);
    }
  }

  const badge = status ? PANE_STATUS_BADGES[status] : undefined;
  const visibleBadge = ledgerId && status === "proposed" ? undefined : badge;
  const showStatusRow = Boolean(localVerdict || visibleBadge || task?.due);
  const history = historyEntries(split?.history ?? null);
  const notFound = !task && !isLoading && Boolean(error);

  return (
    <div className="relative flex flex-col h-full bg-[var(--bg-primary)] border-l border-[var(--border-default)]">
      {/* Retract edge — full-height clickable strip on the left border (BridgeTaskPanel idiom) */}
      <div
        onClick={onClose}
        className="absolute -left-px top-0 bottom-0 w-3 z-10 cursor-e-resize"
      />

      {/* Header */}
      <div className="flex-shrink-0 flex items-start gap-3 px-6 py-5 border-b border-[var(--border-default)]">
        {editable ? (
          <textarea
            value={displayTitle}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={(e) => saveTitle(e.target.value)}
            onKeyDown={(e) => {
              if ((e.key === "Enter" && !e.shiftKey) || e.key === "Tab") {
                e.preventDefault();
                saveTitle(e.currentTarget.value);
              }
              if (e.key === "Escape") onClose();
            }}
            rows={1}
            className="flex-1 text-lg leading-snug font-semibold bg-transparent border-none outline-none text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none overflow-hidden p-0 m-0"
            placeholder="Task title..."
            style={{ fieldSizing: "content" } as React.CSSProperties}
          />
        ) : (
          <div className="flex-1 text-lg leading-snug font-semibold text-[var(--text-primary)]">
            {task ? displayTitle : notFound ? "Task not found" : ""}
          </div>
        )}

        {/* The quick comment layer (W1) — same anchor as the under-body Comments record below;
            both read threadsUrlForTarget(commentTarget), so they cannot disagree. */}
        {task && !dismissed && (
          <CommentPopover
            target={commentTarget}
            placeholder="Comment on this task"
            triggerTitle="Comment on this task"
          />
        )}

        {/* Verdict actions — proposals only; the house three-dot menu (BridgeTaskPanel slot),
            items shared with TaskCard's proposal checkbox via VerdictActionMenu. */}
        {proposed && task && (
          <VerdictActionMenu
            variant="kebab"
            busy={Boolean(busyVerdict)}
            onVerdict={(entry) => void submitVerdict(entry, noteControl.noteText)}
            onAddNote={() => {
              if (!noteControl.open) noteControl.toggle();
            }}
          />
        )}
      </div>

      {task ? (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {/* Status / due / verdict badges */}
          {showStatusRow && (
            <div className="flex flex-wrap items-center gap-1.5 px-6 pt-3">
              {localVerdict ? (
                <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
                  {verdictBadgeLabel(localVerdict)}
                </span>
              ) : visibleBadge ? (
                <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${visibleBadge.className}`}>
                  {visibleBadge.label}
                </span>
              ) : null}
              {task.due && <DueBadge due={task.due} />}
            </div>
          )}

          {/* Meeting linkage — the full meeting card in the pinned-attachment slot (mirrors
              BridgeTaskPanel's project cards; the popover-identical card, resolver-fed). */}
          {task.origin?.meeting && !dismissed && <TaskMeetingLinkageCard meetingId={task.origin.meeting} />}

          {task.origin?.thread && !dismissed && (
            <div className="px-6 pt-3">
              <button
                type="button"
                onClick={() => navigateTo("chats", `/${task.origin!.thread}`)}
                className="hilt-card flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
              >
                <MessageSquare className="h-4 w-4" />
                <span>Feedback thread</span>
                <span className="ml-auto font-mono text-[10px] text-[var(--text-quaternary)]">{task.origin.thread.slice(0, 8)}</span>
              </button>
            </div>
          )}

          {/* The verdict note — reachable from the menu's "Add note"; a typed note rides the
              next verdict pick, or its own Send posts a pure comment. */}
          {proposed && task && (noteControl.open || verdictError) && (
            <div className="px-6 pt-3">
              <VerdictNoteField
                control={noteControl}
                target={commentTarget}
                busy={Boolean(busyVerdict)}
                className="flex items-center gap-2"
                onPosted={() => void mutateThreadsForTarget(commentTarget)}
              />
              {verdictError && <p className="mt-1 text-xs text-red-500">{verdictError}</p>}
            </div>
          )}

          {/* One stacked document: attachments, user notes, comments, then the canonical source
              record. There is no copied source prose and no second independently scrolling dock. */}
          <div className="px-6 py-4">
              {dismissed ? (
                <div className="text-sm text-[var(--text-tertiary)] py-2">
                  Dismissed — the proposal file was removed; the loop remembers and won&apos;t re-propose it.
                </div>
              ) : (
                <>
                  {/* Non-ledger proposals still need their source quote inline. A linked meeting
                      task gets the same quote, plus every later sighting, in the record dock. */}
                  {task.provenance?.quote && !ledgerDetail && (
                    <blockquote
                      className="mb-4 border-l-[3px] border-[var(--border-strong)] pl-4 text-sm leading-[1.6] text-[var(--text-tertiary)]"
                      title={task.provenance.source}
                    >
                      &ldquo;{task.provenance.quote}&rdquo;
                    </blockquote>
                  )}
                  <BridgeTaskEditor
                    key={`${taskId}:${editable ? "rw" : "ro"}`}
                    markdown={split?.content ?? ""}
                    onChange={handleBodyChange}
                    readOnly={!editable}
                    className="task-notes-editor"
                    vaultPath={vaultPath}
                    filePath={vaultPath ? `${vaultPath}/tasks/${store === "proposals" ? ".proposals/" : ""}${taskId}.md` : undefined}
                  />
                </>
              )}
              {/* Comments are working context. The machine-written task transition trail remains
                  available, but no longer competes with the linked meeting record. */}
              {!dismissed && (
                <ThreadView
                  target={commentTarget}
                  title="Comments"
                  className="mt-6 border-t border-[var(--border-default)] pt-3"
                />
              )}
              {history.length > 0 && !dismissed && !ledgerId && (
                <details className="group mt-6 border-t border-[var(--border-default)] pt-3">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]">
                    <History className="h-3 w-3" />
                    Task history · {history.length}
                  </summary>
                  <ul className="mt-2 space-y-1 pl-4">
                    {history.map((entry, index) => (
                      <li key={index} className="break-words text-xs font-mono text-[var(--text-tertiary)]">
                        {entry}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
          </div>
          {ledgerDetail && !dismissed && (
            <TaskMeetingActionSection detail={ledgerDetail} taskTitle={displayTitle} />
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {notFound ? (
            <div className="text-sm text-[var(--text-tertiary)] py-2">
              This task file no longer exists — it may have been dismissed or deleted.
            </div>
          ) : (
            <div className="text-sm text-[var(--text-tertiary)] py-2">Loading…</div>
          )}
        </div>
      )}
    </div>
  );
}
