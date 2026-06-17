"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { useHaptics } from "@/hooks/useHaptics";
import { formatHiltWeekdayDate } from "@/lib/display-date";
import type { BriefingDateRange, BriefingKind } from "@/hooks/useBriefings";

interface BriefingHeaderProps {
  selectedId: string;
  title: string;
  availableBriefings: {
    id: string;
    kind: BriefingKind;
    date: string;
    title: string;
    dateRange?: BriefingDateRange;
  }[];
  onBriefingChange: (id: string) => void;
  rightSlot?: ReactNode;
}

function formatBriefingDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return formatHiltWeekdayDate(date);
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return formatHiltWeekdayDate(date, { includeYear: false });
  } catch {
    return dateStr;
  }
}

function formatBriefingRange(range: BriefingDateRange, includeYear: boolean): string {
  const start = new Date(`${range.start}T00:00:00`);
  const end = new Date(`${range.end}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth() && start.getFullYear() === end.getFullYear();
  const sameYear = start.getFullYear() === end.getFullYear();
  const startLabel = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: includeYear && !sameYear ? "numeric" : undefined,
  }).format(start);
  const endLabel = new Intl.DateTimeFormat("en-US", {
    month: sameMonth ? undefined : "short",
    day: "numeric",
    year: includeYear ? "numeric" : undefined,
  }).format(end);
  return `${startLabel}-${endLabel}`;
}

function formatBriefingOption(
  briefing: BriefingHeaderProps["availableBriefings"][number] | undefined,
  includeYear: boolean
): string {
  if (!briefing) return "";
  if (briefing.kind === "weekend" && briefing.dateRange) {
    return `Weekend, ${formatBriefingRange(briefing.dateRange, includeYear)}`;
  }
  return includeYear ? formatBriefingDate(briefing.date) : formatDateShort(briefing.date);
}

export function BriefingHeader({
  selectedId,
  title,
  availableBriefings,
  onBriefingChange,
  rightSlot,
}: BriefingHeaderProps) {
  const haptics = useHaptics();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [dropdownOpen]);

  const hasMultiple = availableBriefings.length > 1;
  const selectedBriefing = availableBriefings.find((briefing) => briefing.id === selectedId);
  const selectedLabel = formatBriefingOption(selectedBriefing, true) || title || selectedId;

  return (
    <div className="flex min-h-8 items-center justify-between gap-3 text-[var(--text-primary)]">
      <div className="relative" ref={dropdownRef}>
        {hasMultiple ? (
          <button
            onClick={() => { dropdownOpen ? haptics.rigid() : haptics.light(); setDropdownOpen(!dropdownOpen); }}
            className="flex items-center gap-1.5 text-lg font-semibold hover:text-[var(--text-secondary)] transition-colors"
          >
            {selectedLabel}
            <ChevronDown
              className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <h1 className="text-lg font-semibold">{selectedLabel}</h1>
        )}

        {dropdownOpen && hasMultiple && (
          <div className="absolute top-full left-0 mt-1 py-1 min-w-[220px] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl z-50">
            {availableBriefings.map((b, i) => (
              <button
                key={b.id}
                onClick={() => {
                  haptics.selection();
                  onBriefingChange(b.id);
                  setDropdownOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-between gap-3 ${
                  b.id === selectedId ? "bg-[var(--bg-tertiary)] font-medium" : ""
                }`}
              >
                <span>{formatBriefingOption(b, false)}</span>
                {i === 0 && (
                  <span className="text-xs text-[var(--text-tertiary)]">latest</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
      {rightSlot ? <div className="shrink-0">{rightSlot}</div> : null}
    </div>
  );
}
