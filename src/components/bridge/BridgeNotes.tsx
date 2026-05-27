"use client";

import { useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface BridgeNotesProps {
  title?: string;
  notes: string;
  vaultPath?: string;
  filePath?: string;
  onSave: (notes: string) => void;
}

export function BridgeNotes({ title = "Notes", notes, vaultPath, filePath, onSave }: BridgeNotesProps) {
  const lastSaved = useRef(notes);

  const handleChange = useCallback(
    (markdown: string) => {
      const trimmed = markdown.trimEnd();
      if (trimmed !== lastSaved.current) {
        lastSaved.current = trimmed;
        onSave(trimmed);
      }
    },
    [onSave]
  );

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        {title}
      </h2>
      <div className="rounded-lg border border-[var(--border-default)] bg-[var(--content-surface)] px-3 py-2">
        <BridgeTaskEditor
          markdown={notes}
          onChange={handleChange}
          trailingNode={false}
          vaultPath={vaultPath}
          filePath={filePath}
        />
      </div>
    </div>
  );
}
