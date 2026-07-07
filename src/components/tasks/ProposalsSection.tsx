"use client";

/**
 * The Proposals section in Priorities (v3 unit A6) — the ONE new surface for proposal task
 * files (`tasks/.proposals/`). Renders ONLY when proposals exist (no empty shell — house rule);
 * collapsed by default behind a count header matching the task list's Done accordion. Verdicts
 * POST /api/loops/verdicts (the same body the briefing uses), which applies BOTH the file effect
 * (this route) and the ledger effect (the loop's next run); the list then re-fetches — and the
 * file write itself also comes back around via BridgeWatcher's `tasks-changed`.
 */
import { useMemo, useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTasksList } from "@/hooks/useTaskFile";
import { useHaptics } from "@/hooks/useHaptics";
import { withBasePath } from "@/lib/base-path";
import type { TaskFile } from "@/lib/tasks/types";
import type { Verdict } from "@/lib/loops/types";
import { TaskCard } from "./TaskCard";

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

export function ProposalsSection({ searchQuery = "" }: { searchQuery?: string }) {
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

  // No empty shell: the section exists only when there is something to decide.
  if (filtered.length === 0) return null;

  const handleVerdict = (task: TaskFile) => async (verdict: Verdict, note?: string) => {
    await postVerdict({
      loop: task.origin?.loop,
      item_id: task.origin?.item_id,
      verdict,
      ...(note ? { note } : {}),
    });
    mutate();
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
              // Only loop-minted proposals carry the verdict join (origin.loop + item_id);
              // anything else renders read-only rather than posting a broken verdict.
              onVerdict={task.origin?.loop && task.origin?.item_id ? handleVerdict(task) : undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}
