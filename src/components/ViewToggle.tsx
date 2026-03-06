"use client";

import React from "react";
import { FileText, Compass, CalendarDays, Users } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";

// The underlying view mode stored in state/preferences
export type ViewMode = "docs" | "stack" | "bridge" | "briefings" | "people";

// Primary view categories (same as ViewMode now)
export type PrimaryView = "docs" | "stack" | "bridge" | "briefings" | "people";

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
  /** Called when user double-taps the already-active tab (mobile refresh) */
  onDoubleTapActive?: () => void;
  /** Set of tab ids that should show an unread indicator dot */
  unreadTabs?: Set<string>;
}

const VIEW_CONFIG = [
  { id: "briefings" as const, label: "Briefing", icon: CalendarDays, title: "Daily briefing", shortcut: "1" },
  { id: "bridge" as const, label: "Bridge", icon: Compass, title: "Bridge weekly tasks & projects", shortcut: "2" },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation", shortcut: "3" },
  { id: "people" as const, label: "People", icon: Users, title: "People & meetings", shortcut: "4" },
];

export function ViewToggle({ view, onChange, compact, iconSize, onDoubleTapActive, unreadTabs }: ViewToggleProps) {
  const size = iconSize ?? (compact ? 24 : 16);
  const lastTapRef = React.useRef<{ id: string; time: number }>({ id: "", time: 0 });
  const haptics = useHaptics();

  const handleTap = React.useCallback((id: ViewMode) => {
    const now = Date.now();
    if (id === view && onDoubleTapActive && now - lastTapRef.current.time < 400 && lastTapRef.current.id === id) {
      onDoubleTapActive();
      lastTapRef.current = { id: "", time: 0 };
    } else {
      if (id !== view) haptics.tap();
      onChange(id);
      lastTapRef.current = { id, time: now };
    }
  }, [view, onChange, onDoubleTapActive, haptics]);

  if (compact) {
    return (
      <div className="flex items-center gap-1">
        {VIEW_CONFIG.map(({ id, icon: Icon, title }) => (
          <button
            key={id}
            onClick={() => handleTap(id)}
            className={`
              relative flex items-center justify-center min-w-[48px] min-h-[48px] rounded-md
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
            {unreadTabs?.has(id) && view !== id && (
              <span className="absolute top-2.5 right-2.5 w-2 h-2 rounded-full bg-blue-500" />
            )}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      {VIEW_CONFIG.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
          onClick={() => onChange(id)}
          className={`
            relative flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium
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
          {unreadTabs?.has(id) && view !== id && (
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-blue-500" />
          )}
        </button>
      ))}
    </div>
  );
}
