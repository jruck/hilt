"use client";

import { useState } from "react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { BridgeThought, BridgeThoughtStatus } from "@/lib/types";
import { ThoughtCard } from "./ThoughtCard";

const COLUMN_ORDER: { key: BridgeThoughtStatus; label: string }[] = [
  { key: "next", label: "Next" },
  { key: "later", label: "Later" },
];

interface ThoughtBoardProps {
  columns: Record<BridgeThoughtStatus, BridgeThought[]>;
  onThoughtClick?: (thought: BridgeThought) => void;
  onStatusChange?: (thought: BridgeThought, status: BridgeThoughtStatus) => void;
  className?: string;
}

export function ThoughtBoard({ columns, onThoughtClick, onStatusChange, className }: ThoughtBoardProps) {
  const isMobile = useIsMobile();
  const [dragOverColumn, setDragOverColumn] = useState<BridgeThoughtStatus | null>(null);

  function findThoughtBySlug(slug: string): BridgeThought | undefined {
    for (const list of Object.values(columns)) {
      const found = list.find((t) => t.slug === slug);
      if (found) return found;
    }
    return undefined;
  }

  function handleDrop(e: React.DragEvent, targetStatus: BridgeThoughtStatus) {
    e.preventDefault();
    setDragOverColumn(null);
    const slug = e.dataTransfer.getData("application/x-thought-slug");
    if (!slug || !onStatusChange) return;
    const thought = findThoughtBySlug(slug);
    if (thought && thought.status !== targetStatus) {
      onStatusChange(thought, targetStatus);
    }
  }

  function handleDragOver(e: React.DragEvent, status: BridgeThoughtStatus) {
    if (e.dataTransfer.types.includes("application/x-thought-slug")) {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverColumn(status);
    }
  }

  const hasThoughts = COLUMN_ORDER.some(({ key }) => columns[key]?.length > 0);
  if (!hasThoughts) return null;

  return (
    <div className={className}>
      <h2 className="text-sm font-medium text-[var(--text-tertiary)] uppercase tracking-wide mb-3">
        Writing
      </h2>
      <div className={`grid ${isMobile ? "grid-cols-1" : "grid-cols-2"} gap-3`} style={{ minWidth: 0 }}>
        {COLUMN_ORDER.map(({ key, label }) => (
          <div
            key={key}
            className={`min-w-0 rounded-lg p-2 -m-2 transition-colors ${
              dragOverColumn === key ? "bg-[var(--bg-secondary)]" : ""
            }`}
            onDragOver={(e) => handleDragOver(e, key)}
            onDragEnter={(e) => handleDragOver(e, key)}
            onDragLeave={() => setDragOverColumn(null)}
            onDrop={(e) => handleDrop(e, key)}
          >
            <div className="text-xs font-medium text-[var(--text-tertiary)] mb-2 flex items-center gap-1.5">
              <span>{label}</span>
              {columns[key]?.length > 0 && (
                <span className="text-[var(--text-tertiary)] opacity-60">
                  {columns[key].length}
                </span>
              )}
            </div>
            <div className="space-y-2">
              {(columns[key] || []).map((thought) => (
                <ThoughtCard
                  key={thought.slug}
                  thought={thought}
                  onClick={onThoughtClick}
                  onStatusChange={onStatusChange}
                />
              ))}
              {(!columns[key] || columns[key].length === 0) && (
                <div className="text-xs text-[var(--text-tertiary)] opacity-50 py-4 text-center">
                  —
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
