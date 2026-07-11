"use client";

/**
 * TaskCard (v3 unit A6) — the shared card for a task-object file. PURE PROPS: the task data and
 * a verdict callback come in, nothing is fetched here, so the same card can render in Priorities'
 * Proposals section today and in the meeting view / briefing canvas in Phase B.
 *
 * Verdict controls (proposal-card cleanup, 2026-07-07): a decidable card leads with a
 * DOTTED-SQUARE checkbox — the bridge-checkbox position/size, but dashed + amber, echoing the
 * Library candidate CircleDashed as a square ("not yet a real task"). Clicking it opens the
 * house dropdown (BridgeTaskPanel's three-dot menu styling) with icon+label verdict actions;
 * the POSTing still lives in the surface, not the card. Badge once decided, as before.
 */
import { useEffect, useRef, useState } from "react";
import { Bot, Check, ChevronRight, MessageSquare, MoreVertical, SquareDashed, X, type LucideIcon } from "lucide-react";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import type { ObjectRef } from "@/lib/objects/types";
import type { ImplementedCommentTarget } from "@/lib/comments/types";
import { ObjectPill } from "@/components/objects/ObjectPill";
import { useVerdictNote, VerdictNoteField } from "@/components/comments/VerdictNoteField";
import { formatHiltMonthDay } from "@/lib/display-date";
import { parseLifecycle } from "@/lib/attribution";
import { ownerChip, parseOwnerPrefix, type OwnerTag } from "@/lib/tasks/owner";

// Each button carries a plain-language tooltip of its EFFECT (gate-B: verdict clarity).
// Exported for the file-addressable task pane (TaskFilePanel) — same buttons, same language.
export const VERDICT_BUTTONS: Array<{ verdict: Verdict; label: string; title: string }> = [
  { verdict: "approve", label: "Approve", title: "Take this on — becomes your task and joins this week's list" },
  { verdict: "assign_to_agent", label: "Assign to agent", title: "Mark as agent work — joins this week's Ready for agents section (agent execution arrives in Phase C)" },
  { verdict: "dismiss", label: "Dismiss", title: "Decline — removed; the loop remembers and won't re-propose it" },
];

function verdictLabel(verdict: Verdict): string {
  return VERDICT_BUTTONS.find((entry) => entry.verdict === verdict)?.label ?? verdict.replace(/_/g, " ");
}

/** Icon per verdict action — the dropdown items carry icon + label (menu idiom, not bare text). */
const VERDICT_MENU_ICONS: Partial<Record<Verdict, LucideIcon>> = {
  approve: Check,
  assign_to_agent: Bot,
  dismiss: X,
};

/**
 * VerdictActionMenu — the ONE proposal-decision dropdown, shared by TaskCard (dotted-square
 * checkbox trigger, leading position) and TaskFilePanel (three-dot header trigger). Menu
 * styling/positioning/dismissal copied from BridgeTaskPanel's three-dot menu (outside-mousedown
 * close + Escape); items are the VERDICT_BUTTONS with icons, plus "Add note" which opens the
 * surface's VerdictNoteField (a typed note still rides the next verdict pick — one gesture).
 */
export function VerdictActionMenu({
  variant,
  onVerdict,
  onAddNote,
  busy = false,
  align = variant === "kebab" ? "right" : "left",
}: {
  /** "checkbox" = the dotted-square proposal checkbox (card); "kebab" = MoreVertical (pane). */
  variant: "checkbox" | "kebab";
  onVerdict: (verdict: Verdict) => void;
  onAddNote: () => void;
  busy?: boolean;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Dismissal — BridgeTaskPanel's outside-mousedown idiom, plus Escape.
  useEffect(() => {
    if (!open) return;
    function handleMousedown(event: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleMousedown);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleMousedown);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  const itemClass = "w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors disabled:cursor-default disabled:opacity-60";

  return (
    // stopPropagation: the trigger sits inside clickable containers (the card's onOpen).
    <div ref={rootRef} className="relative flex-shrink-0" onClick={(event) => event.stopPropagation()}>
      {variant === "checkbox" ? (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title="Proposed — not yet a task. Approve, assign to an agent, or dismiss"
          className="mt-0.5 flex h-4 w-4 items-center justify-center rounded-[3px] text-amber-500 transition-colors hover:text-amber-600 dark:hover:text-amber-400"
        >
          <SquareDashed className="h-4 w-4" strokeWidth={1.75} />
        </button>
      ) : (
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          title="Proposal actions"
          className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded"
        >
          <MoreVertical className="w-4 h-4" />
        </button>
      )}

      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-1 w-56 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1`}
        >
          {VERDICT_BUTTONS.map((entry) => {
            const Icon = VERDICT_MENU_ICONS[entry.verdict] ?? Check;
            return (
              <button
                key={entry.verdict}
                type="button"
                role="menuitem"
                title={entry.title}
                disabled={busy}
                onClick={() => {
                  setOpen(false);
                  onVerdict(entry.verdict);
                }}
                className={itemClass}
              >
                <Icon className="w-4 h-4 text-[var(--text-tertiary)]" />
                {entry.label}
              </button>
            );
          })}
          <button
            type="button"
            role="menuitem"
            title="Add a note — it rides your next verdict, or Send posts it as a comment"
            disabled={busy}
            onClick={() => {
              setOpen(false);
              onAddNote();
            }}
            className={itemClass}
          >
            <MessageSquare className="w-4 h-4 text-[var(--text-tertiary)]" />
            Add note
          </button>
        </div>
      )}
    </div>
  );
}

/** Decided-state badge text — past tense. The imperative button labels ("Dismiss") on a badge
 * read as available ACTIONS ("the button itself says dismiss which suggests it wasn't
 * dismissed" — Justin, 2026-07-07). */
export function verdictBadgeLabel(verdict: Verdict): string {
  if (verdict === "approve") return "Approved";
  if (verdict === "dismiss") return "Dismissed";
  if (verdict === "assign_to_me") return "Assigned to me";
  if (verdict === "assign_to_agent") return "Assigned to agent";
  if (verdict === "revise") return "Revision sent";
  return verdictLabel(verdict);
}

export function verdictBadgeClass(verdict: Verdict): string {
  if (verdict === "approve" || verdict === "assign_to_me") return "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300";
  if (verdict === "dismiss") return "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)]";
  if (verdict === "revise") return "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300";
  return "border-blue-500/25 bg-blue-500/10 text-blue-600 dark:text-blue-300";
}

/** "meetings/2026-07-05/Floyds sync-2026-07-05….md" → { title: "Floyds sync", date: "2026-07-05" } */
function meetingLabel(meeting: string): { title: string; date: string | null } {
  const date = meeting.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? null;
  const title = (meeting.split("/").pop() || meeting)
    .replace(/-\d{4}-\d{2}-\d{2}[^/]*\.md$/, "")
    .replace(/\.md$/, "");
  return { title, date };
}

export function DueBadge({ due }: { due: string }) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dueDate = new Date(`${due}T00:00:00`);
  // Ledger dues can be free text ("next sprint", "Q3 2026") — Intl.format on an Invalid Date
  // THROWS and would take down the whole Priorities render. Show the raw text instead.
  if (isNaN(dueDate.getTime())) {
    return (
      <span className="flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
        {due}
      </span>
    );
  }
  const diffDays = Math.floor((dueDate.getTime() - today.getTime()) / 86400000);
  const colorClass = diffDays <= 0
    ? "bg-red-500/15 text-red-500"
    : diffDays <= 2
      ? "bg-orange-500/15 text-orange-500"
      : "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]";
  return (
    <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${colorClass}`}>
      {formatHiltMonthDay(dueDate)}
    </span>
  );
}

/**
 * The owner chip: a `[unclear] …` / `[other:Name] …` title prefix (the loop's TEXT-surface
 * encoding) renders as this small muted chip instead — STATUS_BADGES styling, plain-language
 * tooltip. Exported so the briefing fallback rows (LoopItemRow) match exactly.
 */
export function OwnerChip({ owner, className = "" }: { owner: OwnerTag | null; className?: string }) {
  const chip = ownerChip(owner);
  if (!chip) return null;
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] ${className}`}
      title={chip.title}
    >
      {chip.label}
    </span>
  );
}

// Exported for the file-addressable task pane (TaskFilePanel) — one status voice everywhere.
export const STATUS_BADGES: Partial<Record<TaskFile["status"], { label: string; className: string }>> = {
  // Same word + tint as verdictBadgeLabel("approve"): the verdict badge (live escalation lane)
  // and this status badge (task-file lane) are the SAME decision seen from two data paths —
  // "Approved" then "Accepted" read as two different outcomes of one click (Justin, 2026-07-10).
  "accepted-me": { label: "Approved", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
  "accepted-agent": { label: "Assigned to agent", className: "bg-blue-500/10 text-blue-600 dark:text-blue-300" },
  "in-progress": { label: "In progress", className: "bg-blue-500/10 text-blue-600 dark:text-blue-300" },
  done: { label: "Done", className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-300" },
};

export interface TaskCardProps {
  task: TaskFile;
  /** Present when this surface can decide the proposal; absent renders a read-only card. */
  onVerdict?: (verdict: Verdict, note?: string) => Promise<void> | void;
  /** Already-decided verdict (ledger asks) — seeds the decided badge instead of controls. */
  verdict?: Verdict;
  /** Subtle status badge for accepted/in-progress/done cards (meeting Next steps, B2). */
  showStatus?: boolean;
  /** Hide the meeting attribution line — for surfaces already scoped to that meeting. */
  hideMeeting?: boolean;
  /** B5: when present, the meeting attribution line renders as a meeting ObjectPill
   *  (popover preview + click-through) instead of plain text. Absent → today's text. */
  meetingRef?: ObjectRef;
  /** In-briefing rendering (B3 canvas): drop the hilt-card hover chrome/shadow for a quiet
   *  bordered block that sits in the reading flow instead of popping out of it. */
  flush?: boolean;
  /** Clicking the card body opens the task's detail pane (the proposal checkbox/menu, the
   *  note field, and the meeting pill stay independent — they stop propagation). Purity kept:
   *  the card only calls back; the surface decides what "open" means. */
  onOpen?: () => void;
}

export function TaskCard({ task, onVerdict, verdict, showStatus, hideMeeting, meetingRef, flush, onOpen }: TaskCardProps) {
  const [busyVerdict, setBusyVerdict] = useState<Verdict | null>(null);
  const [localVerdict, setLocalVerdict] = useState<Verdict | null>(verdict ?? null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  // The unified note (gate-B comment primitive): typed text rides ANY verdict click in the
  // same POST (what the revise input used to do, for every verdict); the field's own Send
  // posts it as a pure comment on the task's origin ask (or the task file when origin-less).
  const noteControl = useVerdictNote();
  const commentTarget: ImplementedCommentTarget = task.origin?.loop && task.origin.item_id
    ? { kind: "loop-item", loop: task.origin.loop, itemId: task.origin.item_id }
    : { kind: "task", id: task.id };

  // Follow a decided verdict arriving from the server (SWR refresh) — but never CLEAR a
  // just-clicked local badge when the prop is still undefined.
  useEffect(() => {
    if (verdict) setLocalVerdict(verdict);
  }, [verdict]);

  const meeting = !hideMeeting && task.origin?.meeting ? meetingLabel(task.origin.meeting) : null;
  const statusBadge = showStatus ? STATUS_BADGES[task.status] : undefined;
  // Render-level only: the file/markdown keeps its markers; the card shows clean text.
  // Order matters: lifecycle strip FIRST (verdict-promoted task files carry a leading "🆕 "
  // until viewed — never show it raw), then the owner-prefix chip parse (task-file titles
  // shouldn't carry owner prefixes, but be defensive about the combination).
  const { title: displayTitle, owner } = parseOwnerPrefix(
    parseLifecycle(task.title, task.status === "done").displayTitle,
  );

  async function submitVerdict(verdict: Verdict, note?: string) {
    if (!onVerdict) return;
    setBusyVerdict(verdict);
    setVerdictError(null);
    try {
      await onVerdict(verdict, note);
      // Badge until the surface's list mutation removes/refreshes this card. Revise does NOT
      // set the badge: the item stays proposed and returns revised for a REAL verdict (the
      // briefing idiom) — locking the controls here stranded the card until navigation.
      if (verdict !== "revise") setLocalVerdict(verdict);
      noteControl.reset();
    } catch (error) {
      setVerdictError(error instanceof Error ? error.message : "Failed to save verdict");
    } finally {
      setBusyVerdict(null);
    }
  }

  return (
    <div
      onClick={onOpen}
      className={`${flush
        ? "group/taskcard rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)]"
        : "group/taskcard hilt-card"}${onOpen ? " cursor-pointer" : ""}`}
    >
      <div className="px-3 py-2.5">
        <div className="flex items-start gap-2">
          {/* Dotted-square proposal checkbox — the task-row checkbox position, dashed border
              signalling "not yet a real task"; clicking opens the verdict dropdown. */}
          {onVerdict && !localVerdict && (
            <VerdictActionMenu
              variant="checkbox"
              busy={Boolean(busyVerdict)}
              onVerdict={(entry) => void submitVerdict(entry, noteControl.noteText)}
              onAddNote={() => {
                if (!noteControl.open) noteControl.toggle();
              }}
            />
          )}
          <span className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--text-primary)]">
            {displayTitle}
          </span>
          <OwnerChip owner={owner} className="flex-shrink-0" />
          {/* ONE badge slot: a just-clicked verdict and a task-file status are the same
              decision seen from two data reps — rendering them in different positions made
              one click look like two outcomes (Justin, 2026-07-10). Verdict wins when both
              could apply (it is the fresher signal). */}
          {localVerdict ? (
            <span className={`flex-shrink-0 inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
              {verdictBadgeLabel(localVerdict)}
            </span>
          ) : statusBadge ? (
            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          ) : null}
          {task.due && <DueBadge due={task.due} />}
          {/* Open-pane affordance — BridgeTaskItem's chevron idiom, hover-revealed. */}
          {onOpen && (
            <ChevronRight className="mt-0.5 w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover/taskcard:opacity-100" />
          )}
        </div>

        {/* Provenance quote moved OFF the card — it renders as a blockquote in the task pane
            (TaskFilePanel) where there's room to read it at full size. */}

        {meeting && (
          <p className="mt-0.5 text-xs text-[var(--text-tertiary)]" title={task.origin?.meeting}>
            {meetingRef ? (
              // The pill's own date segment renders the instance date ("· Jul 7") — repeating
              // the ISO date in the label doubled it (pill-date adversarial finding).
              <ObjectPill refr={meetingRef}>{meeting.title}</ObjectPill>
            ) : (
              <>
                {meeting.title}
                {meeting.date ? ` · ${meeting.date}` : ""}
              </>
            )}
          </p>
        )}

        {onVerdict && !localVerdict && (
          <VerdictNoteField
            control={noteControl}
            target={commentTarget}
            busy={Boolean(busyVerdict)}
          />
        )}

        {verdictError && <p className="mt-1 text-xs text-red-500">{verdictError}</p>}
      </div>
    </div>
  );
}
