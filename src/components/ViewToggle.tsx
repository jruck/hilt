"use client";

import { useRef, useEffect, useState } from "react";
import { FileText, Layers, Compass } from "lucide-react";

// The underlying view mode stored in state/preferences
export type ViewMode = "docs" | "stack" | "bridge";

// Primary view categories (same as ViewMode now)
export type PrimaryView = "docs" | "stack" | "bridge";

// Helper to derive primary view from viewMode
export function getPrimaryView(viewMode: ViewMode): PrimaryView {
  return viewMode;
}

interface ViewToggleProps {
  view: ViewMode;
  onChange: (view: ViewMode) => void;
  /** When true, renders icon-only 48x48 buttons with no background pill (mobile) */
  compact?: boolean;
  /** Override icon size in pixels (default: 16) */
  iconSize?: number;
  /** Show keyboard shortcut hints (⌘ held) */
  cmdHeld?: boolean;
  /** Ref to the toolbar bar for badge positioning */
  barRef?: React.RefObject<HTMLElement | null>;
}

const VIEW_CONFIG = [
  { id: "bridge" as const, label: "Bridge", icon: Compass, title: "Bridge weekly tasks & projects", shortcut: "1" },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation", shortcut: "2" },
  { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack", shortcut: "3" },
];

export function ViewToggle({ view, onChange, compact, iconSize, cmdHeld, barRef }: ViewToggleProps) {
  const btnRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const [positions, setPositions] = useState<{ left: number; top: number }[]>([]);

  useEffect(() => {
    if (!cmdHeld) { setPositions([]); return; }
    // Wait for layout to settle before measuring
    const raf = requestAnimationFrame(() => {
      const barBottom = barRef?.current ? barRef.current.getBoundingClientRect().bottom : 44;
      setPositions(
        btnRefs.current.map((el) => {
          if (!el) return { left: 0, top: barBottom + 4 };
          const rect = el.getBoundingClientRect();
          return { left: rect.left + rect.width / 2, top: barBottom + 4 };
        })
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [cmdHeld, barRef]);
  const size = iconSize ?? (compact ? 24 : 16);

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {VIEW_CONFIG.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={`
              flex items-center justify-center min-w-[48px] min-h-[48px] rounded-md
              transition-colors
              ${
                view === id
                  ? "text-[var(--text-primary)]"
                  : "text-[var(--text-tertiary)]"
              }
            `}
            title={title}
          >
            <Icon style={{ width: size, height: size }} />
          </button>
        ))}
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
        {VIEW_CONFIG.map(({ id, label, icon: Icon, title, shortcut }, idx) => (
          <button
            key={id}
            ref={(el) => { btnRefs.current[idx] = el; }}
            onClick={() => onChange(id)}
            className={`
              flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
              transition-colors
              ${
                view === id
                  ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                  : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              }
            `}
            title={title}
          >
            <Icon style={{ width: size, height: size }} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>
      {cmdHeld && positions.length > 0 && VIEW_CONFIG.map(({ shortcut }, idx) => (
        positions[idx] && (
          <span
            key={shortcut}
            className="fixed px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-[var(--bg-secondary)] text-[var(--text-secondary)] border border-[var(--border-default)] whitespace-nowrap pointer-events-none z-50"
            style={{
              top: positions[idx].top,
              left: positions[idx].left,
              transform: "translateX(-50%)",
            }}
          >
            {shortcut}
          </span>
        )
      ))}
    </>
  );
}
