"use client";

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
}

const VIEW_CONFIG = [
  { id: "bridge" as const, label: "Bridge", icon: Compass, title: "Bridge weekly tasks & projects" },
  { id: "docs" as const, label: "Docs", icon: FileText, title: "Documentation" },
  { id: "stack" as const, label: "Stack", icon: Layers, title: "Claude configuration stack" },
];

export function ViewToggle({ view, onChange, compact, iconSize }: ViewToggleProps) {
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
    <div className="flex items-center bg-[var(--bg-tertiary)] rounded-lg p-0.5">
      {VIEW_CONFIG.map(({ id, label, icon: Icon, title }) => (
        <button
          key={id}
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
  );
}
