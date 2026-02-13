"use client";

import { useState, useRef, useEffect } from "react";
import { MoreHorizontal, Lightbulb } from "lucide-react";
import type { BridgeThought, BridgeThoughtStatus } from "@/lib/types";

const STATUS_OPTIONS: { key: BridgeThoughtStatus; label: string }[] = [
  { key: "next", label: "Next" },
  { key: "later", label: "Later" },
];

interface ThoughtCardProps {
  thought: BridgeThought;
  expanded?: boolean;
  onClick?: (thought: BridgeThought) => void;
  onStatusChange?: (thought: BridgeThought, status: BridgeThoughtStatus) => void;
}

export function ThoughtCard({ thought, expanded, onClick, onStatusChange }: ThoughtCardProps) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  return (
    <div
      draggable={!!onStatusChange}
      onDragStart={(e) => {
        e.dataTransfer.setData("application/x-thought-slug", thought.slug);
        e.dataTransfer.effectAllowed = "move";
      }}
      className="group rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2.5 py-1.5 cursor-pointer hover:border-[var(--border-hover)] transition-colors"
      onClick={() => onClick?.(thought)}
    >
      <div className="flex items-center gap-2">
        <div className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
          {thought.icon ? (
            <span className="text-sm leading-none">{thought.icon}</span>
          ) : (
            <Lightbulb className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-[var(--text-primary)] truncate block">
            {thought.title}
          </span>
        </div>

        {onStatusChange && (
          <div ref={menuRef} className="flex-shrink-0 relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1 rounded text-[var(--text-tertiary)] opacity-0 group-hover:opacity-100 hover:text-[var(--text-secondary)] transition-all"
            >
              <MoreHorizontal className="w-3.5 h-3.5" />
            </button>

            {showMenu && (
              <div className="absolute right-0 top-full mt-1 w-36 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
                <div className="px-3 py-1 text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Move to
                </div>
                {STATUS_OPTIONS.filter((s) => s.key !== thought.status).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={(e) => {
                      e.stopPropagation();
                      setShowMenu(false);
                      onStatusChange(thought, key);
                    }}
                    className="w-full text-left px-3 py-1.5 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {expanded && thought.description && (
        <div className="mt-1 ml-6 text-xs text-[var(--text-tertiary)] line-clamp-2 leading-relaxed">
          {thought.description.split("\n")[0].slice(0, 120)}{thought.description.length > 120 ? "…" : ""}
        </div>
      )}

      {expanded && thought.created && (
        <div className="mt-1 ml-6 text-[10px] text-[var(--text-tertiary)] opacity-60">
          {thought.created}
        </div>
      )}
    </div>
  );
}
