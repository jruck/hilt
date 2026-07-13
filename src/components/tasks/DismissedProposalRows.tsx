"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import { restoreDismissedProposal } from "@/hooks/useTaskFile";
import type { DismissedDisplayItem } from "@/lib/tasks/meeting-next-steps";

function formatRelativeDate(isoDate: string): string {
  const hours = Math.floor((Date.now() - new Date(isoDate).getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  return weeks < 8 ? `${weeks} weeks ago` : `${Math.floor(days / 30)} months ago`;
}

export function DismissedProposalRows({
  items,
  loop,
  allowRestore = false,
  onRestored,
}: {
  items: DismissedDisplayItem[];
  loop: string;
  allowRestore?: boolean;
  onRestored?: () => void | Promise<void>;
}) {
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());
  const [errorById, setErrorById] = useState<Record<string, string>>({});

  useEffect(() => {
    const current = new Set(items.map((item) => item.id));
    setHiddenIds((previous) => new Set([...previous].filter((id) => current.has(id))));
  }, [items]);

  const visible = items.filter((item) => !hiddenIds.has(item.id));
  if (!visible.length) return null;

  async function restore(item: DismissedDisplayItem): Promise<void> {
    setRestoringId(item.id);
    setErrorById((previous) => ({ ...previous, [item.id]: "" }));
    try {
      await restoreDismissedProposal(loop, item.id);
      setHiddenIds((previous) => new Set(previous).add(item.id));
      await onRestored?.();
    } catch (error) {
      setErrorById((previous) => ({
        ...previous,
        [item.id]: error instanceof Error ? error.message : "Restore failed",
      }));
    } finally {
      setRestoringId(null);
    }
  }

  return (
    <div className="space-y-0.5" data-dismissed-proposal-list>
      {visible.map((item) => {
        const busy = restoringId === item.id;
        const canRestore = allowRestore && Boolean(item.task_id);
        return (
          <div key={item.id} data-dismissed-proposal={item.id} className="px-3 py-1.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="m-0 text-xs leading-5 text-[var(--text-tertiary)]">{item.action}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-4 text-[var(--text-quaternary)]">
                  <span>Dismissed {item.dismissed_at ? formatRelativeDate(item.dismissed_at) : "just now"}</span>
                  {item.note && <span className="min-w-0">{item.note}</span>}
                </div>
              </div>
              {canRestore && (
                <button
                  type="button"
                  onClick={() => void restore(item)}
                  disabled={busy}
                  aria-label={`Restore proposal: ${item.action}`}
                  title="Restore proposal"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
                >
                  {busy
                    ? <LoaderCircle className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />
                    : <RotateCcw className="h-4 w-4" aria-hidden />}
                </button>
              )}
            </div>
            {errorById[item.id] && (
              <p className="m-0 mt-1 text-[11px] leading-4 text-red-600 dark:text-red-300" role="alert">
                {errorById[item.id]}
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
