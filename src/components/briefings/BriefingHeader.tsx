"use client";

import { useState, useRef, useEffect } from "react";
import { Newspaper, ChevronDown } from "lucide-react";

interface BriefingHeaderProps {
  selectedDate: string;
  title: string;
  availableDates: { date: string; title: string }[];
  onDateChange: (date: string) => void;
}

function formatBriefingDate(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatDateShort(dateStr: string): string {
  try {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function BriefingHeader({
  selectedDate,
  title,
  availableDates,
  onDateChange,
}: BriefingHeaderProps) {
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

  const hasMultiple = availableDates.length > 1;

  return (
    <div className="flex items-center gap-2 text-[var(--text-primary)]">
      <Newspaper className="w-5 h-5 text-[var(--text-tertiary)]" />

      <div className="relative" ref={dropdownRef}>
        {hasMultiple ? (
          <button
            onClick={() => setDropdownOpen(!dropdownOpen)}
            className="flex items-center gap-1.5 text-lg font-semibold hover:text-[var(--text-secondary)] transition-colors"
          >
            {formatBriefingDate(selectedDate)}
            <ChevronDown
              className={`w-4 h-4 transition-transform ${dropdownOpen ? "rotate-180" : ""}`}
            />
          </button>
        ) : (
          <h1 className="text-lg font-semibold">{formatBriefingDate(selectedDate)}</h1>
        )}

        {dropdownOpen && hasMultiple && (
          <div className="absolute top-full left-0 mt-1 py-1 min-w-[220px] bg-[var(--bg-elevated)] border border-[var(--border-default)] rounded-lg shadow-xl z-50">
            {availableDates.map((b, i) => (
              <button
                key={b.date}
                onClick={() => {
                  onDateChange(b.date);
                  setDropdownOpen(false);
                }}
                className={`w-full px-3 py-2 text-sm text-left hover:bg-[var(--bg-tertiary)] transition-colors flex items-center justify-between gap-3 ${
                  b.date === selectedDate ? "bg-[var(--bg-tertiary)] font-medium" : ""
                }`}
              >
                <span>{formatDateShort(b.date)}</span>
                {i === 0 && (
                  <span className="text-xs text-[var(--text-tertiary)]">latest</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
