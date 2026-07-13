"use client";

import { AlertTriangle } from "lucide-react";
import type { LibraryArtifactAttention } from "@/lib/library/types";

export function AttentionStatus({
  attention,
  compact = false,
  standalone = false,
}: {
  attention: LibraryArtifactAttention;
  compact?: boolean;
  standalone?: boolean;
}) {
  return (
    <div
      className={`${standalone ? "" : "border-t border-[var(--border-default)]"} ${standalone ? "" : compact ? "pt-2" : "pt-3"}`}
      role="status"
      data-library-attention={attention.kind}
    >
      <div className="flex min-w-0 items-center gap-2 text-amber-600 dark:text-amber-300">
        <AlertTriangle className="h-4 w-4 shrink-0" />
        <span className="min-w-0 truncate text-xs font-medium">{attention.label}</span>
        {compact && attention.attempt_count ? (
          <span className="shrink-0 text-[10px] tabular-nums text-[var(--text-tertiary)]">{attention.attempt_count} tries</span>
        ) : null}
      </div>
      {!compact && attention.detail && (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-tertiary)]">{attention.detail}</p>
      )}
    </div>
  );
}
