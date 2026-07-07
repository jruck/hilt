"use client";

/**
 * The Proposals section in Priorities (v3 unit A6) — the ONE new surface for proposal task
 * files (`tasks/.proposals/`). Renders when proposals exist OR dismissed records do (gate-B:
 * a week where everything was dismissed still shows the tail; a fully-empty section stays
 * hidden — house rule). Collapsed by default behind a count header matching the task list's
 * Done accordion. Verdicts POST /api/loops/verdicts (the same body the briefing uses), which
 * applies BOTH the file effect (this route) and the ledger effect (the loop's next run); the
 * list then re-fetches — and the file write itself also comes back around via BridgeWatcher's
 * `tasks-changed`. Dismissed proposals are never gone from the UI: a quiet divider tail
 * ("Dismissed · N", the ProjectBoard reveal-row idiom) expands into the loop-ledger RECORD —
 * muted action + relative date, not TaskCards (the files are deleted; this is memory).
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useDismissed, useTasksList } from "@/hooks/useTaskFile";
import { useEscalations } from "@/components/briefings/EscalationsPanel";
import { useHaptics } from "@/hooks/useHaptics";
import { withBasePath } from "@/lib/base-path";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import { mergeDismissed } from "@/lib/tasks/meeting-next-steps";
import { TaskCard } from "./TaskCard";

/** The one proposal-minting loop today; generalize when a second loop mints proposals.
 * Exported so the meeting view's Next steps section queries the same dismissed ledger. */
export const PROPOSAL_LOOP = "meeting-actions";

/** Same buckets as PersonCard's relative date — the house recency voice. Exported for the
 * meeting view's dismissed tail so both surfaces speak identical recency. */
export function formatRelativeDate(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));

  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

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

export function ProposalsSection({ searchQuery = "", onOpenTask }: {
  searchQuery?: string;
  /** Open a proposal's detail pane by task-file id (the file-addressable pane); clicking a
   *  card body triggers it — the verdict buttons stay independent. */
  onOpenTask?: (taskId: string) => void;
}) {
  const { proposals, mutate } = useTasksList();
  const { dismissed: dismissedLedger } = useDismissed(PROPOSAL_LOOP);
  // Limbo dismissals (verdict recorded, ledger stamp pending until the loop's next run) merge
  // into the tail immediately — the proposal FILE is already deleted, so without this the
  // dismissal would be invisible until the loop ran. Deduped by ledger id once it lands.
  const { items: escalations, mutate: mutateEscalations } = useEscalations();
  const dismissed = useMemo(
    () => mergeDismissed(dismissedLedger, escalations.filter((item) => item.loop === PROPOSAL_LOOP)),
    [dismissedLedger, escalations],
  );
  const haptics = useHaptics();
  const [expanded, setExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-proposals-expanded") === "true"; } catch { return false; }
  });
  const toggleExpanded = () => setExpanded((prev) => {
    const next = !prev;
    next ? haptics.soft() : haptics.rigid();
    try { sessionStorage.setItem("bridge-proposals-expanded", String(next)); } catch { /* private mode */ }
    return next;
  });
  const [dismissedExpanded, setDismissedExpanded] = useState(() => {
    try { return sessionStorage.getItem("bridge-proposals-dismissed-expanded") === "true"; } catch { return false; }
  });
  const toggleDismissed = () => setDismissedExpanded((prev) => {
    const next = !prev;
    next ? haptics.soft() : haptics.rigid();
    try { sessionStorage.setItem("bridge-proposals-dismissed-expanded", String(next)); } catch { /* private mode */ }
    return next;
  });

  const q = searchQuery.toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!q) return proposals;
    return proposals.filter((task) =>
      task.title.toLowerCase().includes(q) ||
      (task.provenance?.quote ?? "").toLowerCase().includes(q) ||
      (task.origin?.meeting ?? "").toLowerCase().includes(q)
    );
  }, [proposals, q]);

  // No empty shell: the section exists only when there is something to decide — or a dismissed
  // record to reveal (gate-B: a week where everything was dismissed still shows the tail).
  if (filtered.length === 0 && dismissed.length === 0) return null;

  const handleVerdict = (task: TaskFile) => async (verdict: Verdict, note?: string) => {
    await postVerdict({
      loop: task.origin?.loop,
      item_id: task.origin?.item_id,
      verdict,
      ...(note ? { note } : {}),
    });
    mutate();
    // A dismiss must land in the tail NOW (the escalations feed carries the fresh verdict).
    mutateEscalations();
  };

  return (
    <div>
      <div
        className="flex items-center justify-between mb-3 pr-3 cursor-pointer group"
        onClick={toggleExpanded}
        title={expanded ? "Collapse proposals" : "Expand proposals"}
      >
        <h2 className="text-sm font-medium text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] uppercase tracking-wide transition-colors">
          Proposals
          <span className="text-[var(--text-quaternary)] group-hover:text-[var(--text-tertiary)] ml-1.5 font-normal transition-colors">
            {filtered.length}
          </span>
        </h2>
        <ChevronRight className={`w-4 h-4 text-[var(--text-tertiary)] group-hover:text-[var(--text-secondary)] transition-all ${expanded ? "rotate-90" : ""}`} />
      </div>
      {expanded && (
        <div className="space-y-1">
          {filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              // B5: the meeting attribution is an object pill — preview + jump to the meeting.
              meetingRef={task.origin?.meeting ? { kind: "meeting", id: task.origin.meeting } : undefined}
              // Only loop-minted proposals carry the verdict join (origin.loop + item_id);
              // anything else renders read-only rather than posting a broken verdict.
              onVerdict={task.origin?.loop && task.origin?.item_id ? handleVerdict(task) : undefined}
              onOpen={onOpenTask ? () => onOpenTask(task.id) : undefined}
            />
          ))}
        </div>
      )}
      {/* The dismissed tail sits after the cards (or stands alone when nothing is pending) —
          the ProjectBoard DividerToggle idiom, classes copied exactly. */}
      {dismissed.length > 0 && (expanded || filtered.length === 0) && (
        <div className={filtered.length > 0 ? "mt-3" : ""}>
          <div className="flex items-center gap-3">
            <div className="h-px flex-1 bg-[var(--border-default)]" />
            <button
              onClick={toggleDismissed}
              className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
              title={dismissedExpanded ? "Hide dismissed proposals" : "View dismissed proposals"}
            >
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${dismissedExpanded ? "rotate-90" : ""}`} />
              Dismissed · {dismissed.length}
            </button>
            <div className="h-px flex-1 bg-[var(--border-default)]" />
          </div>
          {dismissedExpanded && (
            <div className="mt-3 space-y-0.5">
              {dismissed.map((item) => (
                <div key={item.id} className="flex items-baseline gap-2 px-3 py-1">
                  <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]" title={item.action}>
                    {item.action}
                  </span>
                  <span className="flex-shrink-0 text-xs text-[var(--text-quaternary)]">
                    {item.dismissed_at ? formatRelativeDate(item.dismissed_at) : "just now"}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
