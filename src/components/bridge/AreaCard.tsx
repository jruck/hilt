"use client";

import {
  Briefcase,
  ChevronRight,
  Handshake,
  HeartPulse,
  House,
  Landmark,
  PenLine,
  Rocket,
  Target,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { BridgeArea } from "@/lib/types";
import { useHaptics } from "@/hooks/useHaptics";

interface AreaCardProps {
  area: BridgeArea;
  onClick?: (area: BridgeArea) => void;
}

const AREA_ICONS: Record<string, LucideIcon> = {
  career: Briefcase,
  family: Users,
  finances: Landmark,
  health: HeartPulse,
  home: House,
  relationships: Handshake,
  ventures: Rocket,
  writing: PenLine,
};

export function AreaCard({ area, onClick }: AreaCardProps) {
  const haptics = useHaptics();
  const Icon = AREA_ICONS[area.slug] ?? Target;
  const fallbackText = area.description || area.focus[0]?.text || "No goals captured yet.";

  return (
    <button
      type="button"
      className="hilt-card group flex min-h-[232px] w-full cursor-pointer flex-col px-3 py-3 text-left transition-colors"
      onClick={() => {
        haptics.selection();
        onClick?.(area);
      }}
      title={`Open ${area.title} in Docs`}
      aria-label={`Open ${area.title} in Docs`}
    >
      <div className="flex items-start gap-2.5">
        <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="truncate text-sm font-medium leading-tight text-[var(--text-primary)]">
            {area.title}
          </div>
        </div>
        <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)] opacity-0 transition-opacity group-hover:opacity-100" />
      </div>

      <div className="mt-3 flex-1">
        {area.goals.length > 0 ? (
          <ul className="space-y-2">
            {area.goals.map((goal, index) => (
              <li key={`${area.slug}-goal-${index}`} className="flex gap-2 text-xs leading-relaxed text-[var(--text-secondary)]">
                <span className="mt-[0.55em] h-1 w-1 flex-shrink-0 rounded-full bg-[var(--text-tertiary)]" />
                <span className="min-w-0">{goal}</span>
              </li>
            ))}
          </ul>
        ) : area.description ? (
          <div className="line-clamp-3 text-xs leading-relaxed text-[var(--text-secondary)]">
            {fallbackText}
          </div>
        ) : (
          <div className="text-xs leading-relaxed text-[var(--text-tertiary)]">{fallbackText}</div>
        )}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-[var(--border-subtle)] pt-2 text-[11px] text-[var(--text-tertiary)]">
        <span>Open in Docs</span>
        <ChevronRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
}
