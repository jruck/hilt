"use client";

/**
 * TaskFilePanel — the FILE-addressable task detail pane. Where BridgeTaskPanel is keyed to a
 * weekly-list row (positional selection), this pane is keyed to a task-file id (`t-…`) and
 * reads/writes ONLY through the task-object store (useTaskFile → /api/tasks/[id]) — so a
 * proposal, a done/dropped task, or a past-week task opens even with no weekly row.
 *
 * Editability follows the store's own rules:
 * - accepted/in-progress → title + body editable (PUT /api/tasks/[id]; body edits preserve
 *   the `## History` audit section, which renders read-only below the editor).
 * - proposed → read-only fields + the SAME verdict buttons as ProposalsSection/TaskCard
 *   (POST /api/loops/verdicts via origin). The pane stays open after a verdict showing the
 *   new state (approve → Accepted; dismiss → Dismissed badge over the last-known content —
 *   the file is deleted, SWR's stale data is the memory).
 * - done/dropped → read-only.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { History } from "lucide-react";
import dynamic from "next/dynamic";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import { useTaskFile } from "@/hooks/useTaskFile";
import { withBasePath } from "@/lib/base-path";
import { parseLifecycle } from "@/lib/attribution";
import { historyEntries, joinTaskBody, splitTaskBody } from "@/lib/tasks/task-body";
import type { ImplementedCommentTarget } from "@/lib/comments/types";
import { ObjectPill } from "@/components/objects/ObjectPill";
import { useVerdictNote, VerdictNoteField, VerdictNoteTrigger } from "@/components/comments/VerdictNoteField";
import {
  DueBadge,
  STATUS_BADGES,
  VERDICT_BUTTONS,
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
  const editable = store === "tasks" && (status === "accepted-me" || status === "accepted-agent" || status === "in-progress") && !localVerdict;
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
    if (!task?.origin?.loop || !task.origin.item_id) return;
    setBusyVerdict(verdict);
    setVerdictError(null);
    try {
      await postVerdict({
        loop: task.origin.loop,
        item_id: task.origin.item_id,
        verdict,
        ...(note ? { note } : {}),
      });
      // Revise keeps the item proposed (returns revised for a REAL verdict — TaskCard idiom).
      if (verdict !== "revise") setLocalVerdict(verdict);
      resetNote();
      mutate();
    } catch (err) {
      setVerdictError(err instanceof Error ? err.message : "Failed to save verdict");
    } finally {
      setBusyVerdict(null);
    }
  }

  const badge = status ? PANE_STATUS_BADGES[status] : undefined;
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
      </div>

      {task ? (
        <>
          {/* Status / due / verdict badges */}
          <div className="flex-shrink-0 flex flex-wrap items-center gap-1.5 px-6 py-3 border-b border-[var(--border-default)]">
            {localVerdict ? (
              <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
                {verdictBadgeLabel(localVerdict)}
              </span>
            ) : badge ? (
              <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${badge.className}`}>
                {badge.label}
              </span>
            ) : null}
            {task.due && <DueBadge due={task.due} />}
            {task.origin?.meeting && (
              <span className="text-xs text-[var(--text-tertiary)]">
                <ObjectPill refr={{ kind: "meeting", id: task.origin.meeting }} />
              </span>
            )}
          </div>

          {/* Provenance — the verbatim quote this task was minted from */}
          {task.provenance?.quote && (
            <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-default)]">
              <p className="text-xs italic text-[var(--text-tertiary)]" title={task.provenance.source}>
                &ldquo;{task.provenance.quote}&rdquo;
              </p>
            </div>
          )}

          {/* Verdict controls — proposals only; same buttons/wire as ProposalsSection */}
          {proposed && task.origin?.loop && task.origin?.item_id && (
            <div className="flex-shrink-0 px-6 py-3 border-b border-[var(--border-default)]">
              <div className="flex flex-wrap items-center gap-1.5">
                {VERDICT_BUTTONS.map((entry) => (
                  <button
                    key={entry.verdict}
                    type="button"
                    title={entry.title}
                    // Any verdict carries whatever note is typed (Revise retired at the
                    // comment-primitive consolidation).
                    onClick={() => void submitVerdict(entry.verdict, noteControl.noteText)}
                    disabled={Boolean(busyVerdict)}
                    className="inline-flex min-h-6 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60"
                  >
                    {entry.label}
                  </button>
                ))}
                <VerdictNoteTrigger control={noteControl} />
              </div>
              <VerdictNoteField
                control={noteControl}
                target={commentTarget}
                busy={Boolean(busyVerdict)}
              />
              {verdictError && <p className="mt-1 text-xs text-red-500">{verdictError}</p>}
            </div>
          )}

          {/* Body — content editable when the store allows it; History is audit, not notes */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {dismissed ? (
              <div className="text-sm text-[var(--text-tertiary)] py-2">
                Dismissed — the proposal file was removed; the loop remembers and won&apos;t re-propose it.
              </div>
            ) : (
              <BridgeTaskEditor
                key={`${taskId}:${editable ? "rw" : "ro"}`}
                markdown={split?.content ?? ""}
                onChange={handleBodyChange}
                readOnly={!editable}
                vaultPath={vaultPath}
                filePath={vaultPath ? `${vaultPath}/tasks/${store === "proposals" ? ".proposals/" : ""}${taskId}.md` : undefined}
              />
            )}
            {history.length > 0 && !dismissed && (
              <div className="mt-6 border-t border-[var(--border-default)] pt-3">
                <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">
                  <History className="w-3 h-3" />
                  History
                </div>
                <ul className="mt-2 space-y-1">
                  {history.map((entry, index) => (
                    <li key={index} className="text-xs font-mono text-[var(--text-tertiary)] break-words">
                      {entry}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </>
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
