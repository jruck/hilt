"use client";

import { useState, useRef, useEffect } from "react";
import { RefreshCw, ChevronDown, ArrowLeft } from "lucide-react";

interface WeekHeaderProps {
  week: string;
  needsRecycle: boolean;
  onRecycle: () => void;
  availableWeeks: string[];
  isPreviewingPast: boolean;
  onWeekChange: (week: string | null) => void;
}

function formatWeekDate(week: string): string {
  try {
    const monday = new Date(week + "T00:00:00");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const monMonth = monday.toLocaleDateString("en-US", { month: "long" });
    const sunMonth = sunday.toLocaleDateString("en-US", { month: "long" });
    const monDay = monday.getDate();
    const sunDay = sunday.getDate();
    const year = sunday.getFullYear();

    if (monMonth === sunMonth) {
      return `${monMonth} ${monDay} – ${sunDay}, ${year}`;
    }
    return `${monMonth} ${monDay} – ${sunMonth} ${sunDay}, ${year}`;
  } catch {
    return week;
  }
}

function formatWeekShort(week: string): string {
  try {
    const monday = new Date(week + "T00:00:00");
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);

    const monMonth = monday.toLocaleDateString("en-US", { month: "short" });
    const sunMonth = sunday.toLocaleDateString("en-US", { month: "short" });
    const monDay = monday.getDate();
    const sunDay = sunday.getDate();

    if (monMonth === sunMonth) {
      return `${monMonth} ${monDay} – ${sunDay}`;
    }
    return `${monMonth} ${monDay} – ${sunMonth} ${sunDay}`;
  } catch {
    return week;
  }
}

export function WeekHeader({
  week,
  needsRecycle,
  onRecycle,
  availableWeeks,
  isPreviewingPast,
  onWeekChange,
}: WeekHeaderProps) {
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

  // Compute next Monday for the "Next" week entry
  const nextMonday = (() => {
    const now = new Date();
    const day = now.getDay();
    const daysUntilMonday = day === 0 ? 1 : 8 - day;
    const next = new Date(now);
    next.setDate(now.getDate() + daysUntilMonday);
    return next.toISOString().split("T")[0];
  })();

  // Show "Next" entry when the current week file is the latest and next week doesn't exist yet
  const showNextWeek = availableWeeks.length > 0 && !availableWeeks.includes(nextMonday);
  const hasOtherWeeks = availableWeeks.length > 1 || showNextWeek;

  return (
    <div>
      {/* Past week preview notice */}
      {isPreviewingPast && (
        <button
          onClick={() => onWeekChange(null)}
          className="mb-3 w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
        >
          <span className="text-sm text-[var(--text-secondary)] flex-1 text-left">
            Viewing past week. Switch back to current?
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <ArrowLeft className="w-3.5 h-3.5" />
            Current Week
          </span>
        </button>
      )}

      <div className="flex items-center gap-2 text-[var(--text-primary)]">
        {/* Week heading with optional dropdown */}
        <div className="relative" ref={dropdownRef}>
          {hasOtherWeeks ? (
            <button
              onClick={() => setDropdownOpen(!dropdownOpen)}
              className="flex items-center gap-1.5 text-lg font-semibold hover:text-[var(--text-secondary)] transition-colors"
            >
              Week of {formatWeekDate(week)}
              <ChevronDown className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`} />
            </button>
          ) : (
            <h1 className="text-lg font-semibold">Week of {formatWeekDate(week)}</h1>
          )}

          {/* Dropdown */}
          {dropdownOpen && hasOtherWeeks && (
            <div className="absolute top-full left-0 mt-1 py-1 min-w-[180px] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl z-50">
              {/* "Next" week entry — triggers recycle */}
              {showNextWeek && (
                <>
                  <button
                    onClick={() => {
                      setDropdownOpen(false);
                      onRecycle();
                    }}
                    className="w-full px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-between"
                  >
                    <span>{formatWeekShort(nextMonday)}</span>
                    <span className="text-xs text-[var(--text-tertiary)]">next</span>
                  </button>
                  <div className="my-1 border-t border-[var(--border-default)]" />
                </>
              )}
              {availableWeeks.map((w, i) => (
                <button
                  key={w}
                  onClick={() => {
                    onWeekChange(i === 0 ? null : w);
                    setDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-between ${
                    w === week ? "bg-[var(--bg-tertiary)] font-medium" : ""
                  }`}
                >
                  <span>{formatWeekShort(w)}</span>
                  {i === 0 && (
                    <span className="text-xs text-[var(--text-tertiary)]">current</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* End-of-week retrospective CTA (only show when not previewing past) */}
      {needsRecycle && !isPreviewingPast && (
        <button
          onClick={onRecycle}
          className="mt-3 w-full flex items-center gap-3 px-4 py-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-default)] hover:bg-[var(--bg-tertiary)] transition-colors cursor-pointer"
        >
          <span className="text-sm text-[var(--text-secondary)] flex-1 text-left">
            Ready to wrap up the week?
          </span>
          <span className="flex items-center gap-1 text-xs font-medium text-[var(--text-secondary)]">
            <RefreshCw className="w-3.5 h-3.5" />
            Week Review
          </span>
        </button>
      )}
    </div>
  );
}
