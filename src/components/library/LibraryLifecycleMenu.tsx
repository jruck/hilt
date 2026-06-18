"use client";

import { useState, type MouseEvent } from "react";
import { Archive, Check, ChevronDown, CircleDashed, CircleDot, ExternalLink, X } from "lucide-react";
import type { LibraryArtifact, LibraryArtifactDetail, PromotionReason, RecommendedArtifact } from "@/lib/library/types";
import { archiveArtifact, promoteCandidate, skipCandidate } from "@/hooks/useLibrary";

type LibraryLifecycleArtifact = LibraryArtifact | LibraryArtifactDetail | RecommendedArtifact;

function LibraryLifecycleIcon({ status }: { status: LibraryLifecycleArtifact["lifecycle_status"] }) {
  if (status === "candidate") {
    return <CircleDashed className="h-4 w-4 text-amber-500" aria-hidden="true" />;
  }

  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-1 ring-emerald-500/25" aria-hidden="true">
      <Check className="h-2.5 w-2.5 stroke-[3]" />
    </span>
  );
}

export function LibraryLifecycleMenu<T extends LibraryLifecycleArtifact>({
  artifact,
  promoteReason = "manual_save",
  onChanged,
  onMarkUnread,
  onDismissCandidate,
  onArchiveReference,
  align = "left",
  open,
  onOpenChange,
  onBeforeOpen,
  stopPropagation = false,
  className = "",
  buttonClassName = "",
}: {
  artifact: T;
  promoteReason?: PromotionReason;
  onChanged?: () => void | Promise<void>;
  onMarkUnread?: (id: string) => void | Promise<void>;
  onDismissCandidate?: (artifact: T) => void | Promise<void>;
  onArchiveReference?: (artifact: T) => void | Promise<void>;
  align?: "left" | "right";
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  onBeforeOpen?: () => void;
  stopPropagation?: boolean;
  className?: string;
  buttonClassName?: string;
}) {
  const [internalOpen, setInternalOpen] = useState(false);
  const menuOpen = open ?? internalOpen;
  const isCandidate = artifact.lifecycle_status === "candidate";
  const label = isCandidate ? "Candidate" : "Saved";
  const toneClass = isCandidate
    ? "text-amber-700 hover:text-amber-800 dark:text-amber-300 dark:hover:text-amber-200"
    : "text-emerald-700 hover:text-emerald-800 dark:text-emerald-300 dark:hover:text-emerald-200";
  const menuAlignClass = align === "right" ? "right-0" : "left-0";
  const menuItemClass = "flex w-full items-center gap-2 rounded px-2 py-2 text-left text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]";

  const setMenuOpen = (nextOpen: boolean) => {
    if (nextOpen) onBeforeOpen?.();
    if (open === undefined) setInternalOpen(nextOpen);
    onOpenChange?.(nextOpen);
  };

  const handleRootClick = (event: MouseEvent<HTMLDivElement>) => {
    if (stopPropagation) event.stopPropagation();
  };

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className={`pointer-events-auto relative ${className}`} onClick={handleRootClick}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(!menuOpen)}
        className={`inline-flex min-h-7 items-center gap-1.5 rounded-md px-1 text-xs font-medium transition-colors hover:bg-[var(--bg-secondary)] ${toneClass} ${buttonClassName}`}
        title={isCandidate ? "Candidate review actions" : "Saved reference actions"}
      >
        <LibraryLifecycleIcon status={artifact.lifecycle_status} />
        {label}
        <ChevronDown className="h-3 w-3" aria-hidden="true" />
      </button>
      {menuOpen && (
        <div role="menu" className={`absolute ${menuAlignClass} z-50 mt-1 w-44 rounded-md border border-[var(--border-default)] bg-[var(--content-surface)] p-1 content-card-shadow`}>
          {isCandidate ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  closeMenu();
                  await promoteCandidate(artifact.id, promoteReason);
                  await onChanged?.();
                }}
                className={menuItemClass}
              >
                <Check className="h-3.5 w-3.5" />
                Save
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  closeMenu();
                  if (onDismissCandidate) await onDismissCandidate(artifact);
                  else {
                    await skipCandidate(artifact.id);
                    await onChanged?.();
                  }
                }}
                className={menuItemClass}
                title="Dismiss this candidate from review; it remains in the temporary candidate cache until cleanup"
              >
                <X className="h-3.5 w-3.5" />
                Dismiss
              </button>
            </>
          ) : (
            <>
              {artifact.url && (
                <a
                  role="menuitem"
                  href={artifact.url}
                  target="_blank"
                  rel="noreferrer"
                  onClick={closeMenu}
                  className={menuItemClass}
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  Open source
                </a>
              )}
              {onMarkUnread && !artifact.is_unread && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={async () => {
                    closeMenu();
                    await onMarkUnread(artifact.id);
                  }}
                  className={menuItemClass}
                >
                  <CircleDot className="h-3.5 w-3.5" />
                  Mark as unread
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  if (!window.confirm("Archive this saved reference? It will move out of the active Library.")) return;
                  closeMenu();
                  if (onArchiveReference) {
                    await onArchiveReference(artifact);
                    return;
                  }
                  await archiveArtifact(artifact.id);
                  await onChanged?.();
                }}
                className={menuItemClass}
              >
                <Archive className="h-3.5 w-3.5" />
                Archive reference
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
