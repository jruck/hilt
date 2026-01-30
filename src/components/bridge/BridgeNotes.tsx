"use client";

import { useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const BridgeTaskEditor = dynamic(
  () => import("./BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface BridgeNotesProps {
  notes: string;
  vaultPath?: string;
  filePath?: string;
  onSave: (notes: string) => void;
}

export function BridgeNotes({ notes, vaultPath, filePath, onSave }: BridgeNotesProps) {
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
        Notes
      </h2>
      <BridgeTaskEditor
        markdown={notes}
        onChange={handleChange}
        vaultPath={vaultPath}
        filePath={filePath}
      />
    </div>
  );
}
