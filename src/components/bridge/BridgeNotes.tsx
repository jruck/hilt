"use client";

import { useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const DocsEditor = dynamic(
  () => import("../docs/DocsEditor").then((mod) => mod.DocsEditor),
  { ssr: false }
);

interface BridgeNotesProps {
  notes: string;
  onSave: (notes: string) => void;
}

export function BridgeNotes({ notes, onSave }: BridgeNotesProps) {
  const lastSaved = useRef(notes);

  const handleChange = useCallback(
    (markdown: string) => {
      if (markdown !== lastSaved.current) {
        lastSaved.current = markdown;
        onSave(markdown);
      }
    },
    [onSave]
  );

  return (
    <div>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Notes
      </h2>
      <DocsEditor
        markdown={notes}
        onChange={handleChange}
        hideToolbar
        contentPadding="px-0 py-0"
        wrapperClassName="docs-editor-compact"
      />
    </div>
  );
}
