"use client";

/**
 * The Proposals section in Priorities (v3 unit A6) — the ONE new surface for proposal task
 * files (`tasks/.proposals/`). The header remains the compact decision-queue entry point even
 * when the queue is empty, with `View ledger` opening the scalable operational history. Meeting
 * dismissals no longer expand inline here: their unbounded history belongs in Meeting Ledger.
 * Loop proposals post through `/api/loops/verdicts`; proposals from other origins use the
 * task-native proposal decision route.
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTasksList } from "@/hooks/useTaskFile";
import { useHaptics } from "@/hooks/useHaptics";
import { withBasePath } from "@/lib/base-path";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
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

export function ProposalsSection({ searchQuery = "", onOpenTask, onViewLedger }: {
  searchQuery?: string;
  /** Open a proposal's detail pane by task-file id (the file-addressable pane); clicking a
   *  card body triggers it — the verdict buttons stay independent. */
  onOpenTask?: (taskId: string) => void;
  onViewLedger: () => void;
}) {
  const { proposals, mutate } = useTasksList();
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
  const q = searchQuery.toLowerCase().trim();
  const filtered = useMemo(() => {
    if (!q) return proposals;
    return proposals.filter((task) =>
      task.title.toLowerCase().includes(q) ||
      (task.provenance?.quote ?? "").toLowerCase().includes(q) ||
      (task.origin?.meeting ?? "").toLowerCase().includes(q)
    );
  }, [proposals, q]);

  const handleVerdict = (task: TaskFile) => async (verdict: Verdict, note?: string) => {
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
    mutate();
  };

  return (
    <div>
      <div className="mb-3 flex items-center gap-3 pr-3">
        <button
          type="button"
          className="group min-w-0 flex-1 text-left"
          onClick={toggleExpanded}
          title={expanded ? "Collapse proposals" : "Expand proposals"}
        >
          <h2 className="text-sm font-medium uppercase tracking-wide text-[var(--text-tertiary)] transition-colors group-hover:text-[var(--text-secondary)]">
            Proposals
            <span className="ml-1.5 font-normal text-[var(--text-quaternary)] transition-colors group-hover:text-[var(--text-tertiary)]">
              {filtered.length}
            </span>
          </h2>
        </button>
        <button
          type="button"
          onClick={onViewLedger}
          className="shrink-0 text-xs font-medium text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-primary)]"
          title="Browse all meeting actions, including dismissed and resolved records"
        >
          View ledger
        </button>
        <button
          type="button"
          onClick={toggleExpanded}
          className="group rounded p-0.5"
          title={expanded ? "Collapse proposals" : "Expand proposals"}
          aria-label={expanded ? "Collapse proposals" : "Expand proposals"}
          aria-expanded={expanded}
        >
          <ChevronRight className={`h-4 w-4 text-[var(--text-tertiary)] transition-all group-hover:text-[var(--text-secondary)] ${expanded ? "rotate-90" : ""}`} />
        </button>
      </div>
      {expanded && (
        <div className="space-y-1">
          {filtered.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              // B5: the meeting attribution is an object pill — preview + jump to the meeting.
              meetingRef={task.origin?.meeting ? { kind: "meeting", id: task.origin.meeting } : undefined}
              onVerdict={handleVerdict(task)}
              onOpen={onOpenTask ? () => onOpenTask(task.id) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
