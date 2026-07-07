"use client";

/**
 * TaskCard (v3 unit A6) — the shared card for a task-object file. PURE PROPS: the task data and
 * a verdict callback come in, nothing is fetched here, so the same card can render in Priorities'
 * Proposals section today and in the meeting view / briefing canvas in Phase B.
 *
 * Verdict controls follow the EscalationsPanel idiom (hover-reveal buttons, inline revise form,
 * badge once decided) but are props-driven — the POSTing lives in the surface, not the card.
 */
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import type { ObjectRef } from "@/lib/objects/types";
import { ObjectPill } from "@/components/objects/ObjectPill";
import { formatHiltMonthDay } from "@/lib/display-date";
import { parseLifecycle } from "@/lib/attribution";
import { ownerChip, parseOwnerPrefix, type OwnerTag } from "@/lib/tasks/owner";

// Each button carries a plain-language tooltip of its EFFECT (gate-B: verdict clarity).
// Exported for the file-addressable task pane (TaskFilePanel) — same buttons, same language.
export const VERDICT_BUTTONS: Array<{ verdict: Verdict; label: string; title: string }> = [
  { verdict: "approve", label: "Approve", title: "Take this on — becomes your task and joins this week's list" },
  { verdict: "assign_to_agent", label: "Assign to agent", title: "Mark as agent work — joins this week's Ready for agents section (agent execution arrives in Phase C)" },
  { verdict: "dismiss", label: "Dismiss", title: "Decline — removed; the loop remembers and won't re-propose it" },
  { verdict: "revise", label: "Revise", title: "Send a correction — returns for a fresh verdict" },
];

function verdictLabel(verdict: Verdict): string {
  return VERDICT_BUTTONS.find((entry) => entry.verdict === verdict)?.label ?? verdict.replace(/_/g, " ");
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
  "accepted-me": { label: "Accepted", className: "bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]" },
  "accepted-agent": { label: "Agent", className: "bg-blue-500/10 text-blue-600 dark:text-blue-300" },
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
  /** Clicking the card body opens the task's detail pane (verdict buttons, the revise form,
   *  and the meeting pill stay independent — they stop propagation). Purity kept: the card
   *  only calls back; the surface decides what "open" means. */
  onOpen?: () => void;
}

export function TaskCard({ task, onVerdict, verdict, showStatus, hideMeeting, meetingRef, flush, onOpen }: TaskCardProps) {
  const [busyVerdict, setBusyVerdict] = useState<Verdict | null>(null);
  const [localVerdict, setLocalVerdict] = useState<Verdict | null>(verdict ?? null);
  const [verdictError, setVerdictError] = useState<string | null>(null);
  const [reviseOpen, setReviseOpen] = useState(false);
  const [reviseNote, setReviseNote] = useState("");

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
      setReviseOpen(false);
      setReviseNote("");
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
          <span className="min-w-0 flex-1 text-sm leading-relaxed text-[var(--text-primary)]">
            {displayTitle}
          </span>
          <OwnerChip owner={owner} className="flex-shrink-0" />
          {statusBadge && (
            <span className={`flex-shrink-0 px-1.5 py-0.5 rounded text-xs font-medium ${statusBadge.className}`}>
              {statusBadge.label}
            </span>
          )}
          {task.due && <DueBadge due={task.due} />}
          {/* Open-pane affordance — BridgeTaskItem's chevron idiom, hover-revealed. */}
          {onOpen && (
            <ChevronRight className="mt-0.5 w-4 h-4 flex-shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover/taskcard:opacity-100" />
          )}
        </div>

        {task.provenance?.quote && (
          <p className="mt-1 truncate text-xs italic text-[var(--text-tertiary)]" title={task.provenance.quote}>
            &ldquo;{task.provenance.quote}&rdquo;
          </p>
        )}

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
          <div
            onClick={(event) => event.stopPropagation()}
            className="mt-1.5 flex flex-wrap items-center gap-1.5 opacity-0 transition-opacity focus-within:opacity-100 group-hover/taskcard:opacity-100"
          >
            {VERDICT_BUTTONS.map((entry) => (
              <button
                key={entry.verdict}
                type="button"
                title={entry.title}
                onClick={() => entry.verdict === "revise" ? setReviseOpen((value) => !value) : void submitVerdict(entry.verdict)}
                disabled={Boolean(busyVerdict)}
                className="inline-flex min-h-6 items-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-0.5 text-xs font-medium text-[var(--text-secondary)] shadow-sm transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-60"
              >
                {entry.label}
              </button>
            ))}
          </div>
        )}

        {localVerdict && (
          <div className="mt-1.5">
            <span className={`inline-flex items-center whitespace-nowrap rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${verdictBadgeClass(localVerdict)}`}>
              {verdictBadgeLabel(localVerdict)}
            </span>
          </div>
        )}

        {reviseOpen && !localVerdict && (
          <form
            onClick={(event) => event.stopPropagation()}
            onSubmit={(event) => {
              event.preventDefault();
              const note = reviseNote.trim();
              if (!note) return;
              void submitVerdict("revise", note);
            }}
            className="mt-1.5 flex items-center gap-2"
          >
            <input
              value={reviseNote}
              onChange={(event) => setReviseNote(event.target.value)}
              autoFocus
              className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
              placeholder="Revision note"
              aria-label="Revision note"
            />
            <button
              type="submit"
              disabled={!reviseNote.trim() || Boolean(busyVerdict)}
              className="inline-flex min-h-8 items-center justify-center rounded-md border border-amber-500/25 bg-amber-500/10 px-2.5 text-xs font-medium text-amber-700 transition-colors hover:bg-amber-500/15 disabled:cursor-default disabled:opacity-50 dark:text-amber-300"
            >
              Revise
            </button>
          </form>
        )}

        {verdictError && <p className="mt-1 text-xs text-red-500">{verdictError}</p>}
      </div>
    </div>
  );
}
