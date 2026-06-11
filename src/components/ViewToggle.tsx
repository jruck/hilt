"use client";

import React from "react";
import { FileText, Compass, CalendarRange, Users, Layers, Bookmark } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";

// The underlying view mode stored in state/preferences
export type ViewMode = "docs" | "bridge" | "briefings" | "calendar" | "library" | "people" | "system";

// Primary view categories (same as ViewMode now)
export type PrimaryView = Exclude<ViewMode, "briefings">;

// Helper to derive primary view from viewMode
export function getPrimaryView(viewMode: ViewMode): PrimaryView {
  return viewMode === "briefings" ? "bridge" : viewMode;
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
  { id: "bridge" as const, label: "Bridge", icon: Compass, title: "Bridge", shortcut: "1" },
  { id: "calendar" as const, label: "Calendar", icon: CalendarRange, title: "Calendar", shortcut: "2" },
  { id: "people" as const, label: "People", icon: Users, title: "People & meetings", shortcut: "3" },
  { id: "library" as const, label: "Library", icon: Bookmark, title: "Library", shortcut: "4" },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation", shortcut: "5" },
  { id: "system" as const, label: "System", icon: Layers, title: "System inspection", shortcut: "6" },
];

const VIEW_CONFIG_BY_ID = Object.fromEntries(
  VIEW_CONFIG.map((config) => [config.id, config]),
) as Record<PrimaryView, (typeof VIEW_CONFIG)[number]>;

const VIEW_GROUPS: PrimaryView[][] = [["bridge", "calendar", "people", "library", "docs", "system"]];
const NO_DRAG_STYLE = { WebkitAppRegion: "no-drag" } as React.CSSProperties;

export function ViewToggle({ view, onChange, compact, iconSize, onDoubleTapActive, unreadTabs }: ViewToggleProps) {
  const size = iconSize ?? (compact ? 24 : 16);
  const primaryView = getPrimaryView(view);
  const lastTapRef = React.useRef<{ id: string; time: number }>({ id: "", time: 0 });
  const haptics = useHaptics();

  const handleTap = React.useCallback((id: PrimaryView) => {
    const now = Date.now();
    if (id === primaryView && onDoubleTapActive && now - lastTapRef.current.time < 400 && lastTapRef.current.id === id) {
      onDoubleTapActive();
      lastTapRef.current = { id: "", time: 0 };
    } else {
      if (id !== primaryView) haptics.selection();
      onChange(id);
      lastTapRef.current = { id, time: now };
    }
  }, [primaryView, onChange, onDoubleTapActive, haptics]);

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {VIEW_GROUPS.map((group) => (
          <div key={group.join("-")} className="flex items-center gap-0.5">
            {group.map((id) => {
              const { icon: Icon, title } = VIEW_CONFIG_BY_ID[id];
              return (
                <button
                  key={id}
                  onClick={() => handleTap(id)}
                  style={NO_DRAG_STYLE}
                  className={`
                    relative flex min-h-[48px] min-w-[48px] items-center justify-center rounded-full
                    transition-colors
                    ${
                      primaryView === id
                        ? "bg-[var(--nav-mobile-active-bg)] text-[var(--nav-mobile-active)] shadow-sm"
                        : "text-[var(--nav-mobile-muted)] hover:text-[var(--nav-mobile-hover)] active:bg-[var(--nav-mobile-press-bg)]"
                    }
                  `}
                  title={title}
                >
                  <Icon style={{ width: size, height: size }} />
                  {unreadTabs?.has(id) && primaryView !== id && (
                    <span className="absolute top-2.5 right-2.5 h-2 w-2 rounded-full bg-blue-500" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      {VIEW_GROUPS.map((group) => (
        <div key={group.join("-")} className="flex items-center gap-0.5 rounded-lg bg-[var(--bg-tertiary)] p-0.5">
          {group.map((id) => {
            const { label, icon: Icon, title } = VIEW_CONFIG_BY_ID[id];
            return (
              <button
                key={id}
                onClick={() => onChange(id)}
                className={`
                  relative flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium
                  transition-colors
                  ${
                    primaryView === id
                      ? "bg-[var(--bg-elevated)] text-[var(--text-primary)] shadow-sm"
                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  }
                `}
                title={title}
              >
                <Icon style={{ width: size, height: size }} />
                <span className="hidden sm:inline">{label}</span>
                {unreadTabs?.has(id) && primaryView !== id && (
                  <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-blue-500" />
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
