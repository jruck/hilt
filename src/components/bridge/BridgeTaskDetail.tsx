"use client";

import { useState, useRef, useEffect } from "react";

interface BridgeTaskDetailProps {
  taskId: string;
  details: string[];
  onSave: (id: string, details: string[]) => void;
}

export function BridgeTaskDetail({ taskId, details, onSave }: BridgeTaskDetailProps) {
  const [value, setValue] = useState(details.join("\n"));
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastSaved = useRef(value);

  // Sync from props when details change externally
  useEffect(() => {
    const incoming = details.join("\n");
    if (incoming !== lastSaved.current) {
      setValue(incoming);
      lastSaved.current = incoming;
    }
  }, [details]);

  function save(text: string) {
    if (text !== lastSaved.current) {
      lastSaved.current = text;
      onSave(taskId, text.split("\n"));
    }
  }

  return (
    <div className="px-3 pb-3 pt-1 border-t border-[var(--border-default)]">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={(e) => save(e.target.value)}
        rows={Math.max(2, value.split("\n").length)}
        className="w-full text-sm font-mono bg-transparent text-[var(--text-secondary)] leading-relaxed resize-y focus:outline-none focus:bg-[var(--bg-primary)] focus:border focus:border-[var(--border-default)] rounded-md px-2 py-1 -mx-2 transition-colors"
        placeholder="Add details..."
      />
    </div>
  );
}
