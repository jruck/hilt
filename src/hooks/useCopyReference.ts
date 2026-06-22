"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { HiltRef } from "@/lib/references/types";
import { buildReference } from "@/lib/references/build";
import { copyToClipboard } from "@/lib/references/clipboard";

/**
 * useCopyReference — the shared "Copy reference" behavior for any object kind: format via
 * buildReference, write to the clipboard, and flash a 1.5s `copied` state. Generalizes the
 * per-component feedback pattern that BridgeTaskPanel implemented by hand.
 *
 *   const { copy, copied } = useCopyReference();
 *   <button onClick={() => copy(ref)}>{copied ? "Copied!" : "Copy reference"}</button>
 */
export function useCopyReference(resetMs = 1500): {
  copy: (ref: HiltRef) => void;
  copied: boolean;
} {
  const [copied, setCopied] = useState(false);
  const timeout = useRef<number | null>(null);

  useEffect(() => () => {
    if (timeout.current !== null) window.clearTimeout(timeout.current);
  }, []);

  const copy = useCallback((ref: HiltRef) => {
    copyToClipboard(buildReference(ref))
      .then(() => {
        setCopied(true);
        if (timeout.current !== null) window.clearTimeout(timeout.current);
        timeout.current = window.setTimeout(() => {
          setCopied(false);
          timeout.current = null;
        }, resetMs);
      })
      .catch((err) => console.error("[references] failed to copy reference:", err));
  }, [resetMs]);

  return { copy, copied };
}
