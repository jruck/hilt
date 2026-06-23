"use client";

import { Copy, Check } from "lucide-react";
import type { HiltRef } from "@/lib/references/types";
import { useCopyReference } from "@/hooks/useCopyReference";

interface CopyReferenceButtonProps {
  /** The object to build a portable reference for. */
  reference: HiltRef;
  /** "menu-item" = full-width row for a dropdown; "icon" = compact icon button. */
  variant?: "menu-item" | "icon";
  /** Override the resting label (default "Copy reference"). */
  label?: string;
  className?: string;
  /** Called after a copy is triggered — e.g. so a host dropdown can close itself. */
  onCopied?: () => void;
}

/**
 * Drop-in "Copy reference" affordance. Routes through useCopyReference (shared formatter + clipboard
 * + "Copied!" feedback), so adding a portable reference to a new surface is a single import.
 */
export function CopyReferenceButton({
  reference,
  variant = "menu-item",
  label = "Copy reference",
  className = "",
  onCopied,
}: CopyReferenceButtonProps) {
  const { copy, copied } = useCopyReference();

  function handleClick() {
    copy(reference);
    onCopied?.();
  }

  if (variant === "icon") {
    return (
      <button
        onClick={handleClick}
        title={copied ? "Copied!" : label}
        aria-label={label}
        className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded ${className}`}
      >
        {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors ${className}`}
    >
      {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />}
      {copied ? "Copied!" : label}
    </button>
  );
}
