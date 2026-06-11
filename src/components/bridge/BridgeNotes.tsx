"use client";

import { useRef, useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";

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
  const hasNotes = notes.trim().length > 0;
  const [isAdding, setIsAdding] = useState(false);

  useEffect(() => {
    lastSaved.current = notes;
    if (notes.trim().length > 0) {
      setIsAdding(false);
    }
  }, [notes]);

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

  const handleBlur = useCallback((markdown: string) => {
    if (markdown.trim().length === 0) {
      setIsAdding(false);
    }
  }, []);

  const showEditor = hasNotes || isAdding;

  return (
    <div>
      <div className="flex items-center justify-between mb-3 pr-3">
        <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
          {title}
        </h2>
        {!showEditor && (
          <button
            type="button"
            onClick={() => setIsAdding(true)}
            className="group rounded p-0.5 text-[var(--text-tertiary)] transition-colors hover:text-[var(--text-secondary)]"
            aria-label={`Add ${title.toLowerCase()}`}
            title={`Add ${title.toLowerCase()}`}
          >
            <Plus className="h-4 w-4 transition-colors" />
          </button>
        )}
      </div>
      {showEditor && (
        <BridgeTaskEditor
          markdown={notes}
          onChange={handleChange}
          onBlur={handleBlur}
          autoFocus={isAdding}
          className="bridge-notes-editor"
          trailingNode={false}
          vaultPath={vaultPath}
          filePath={filePath}
        />
      )}
    </div>
  );
}
