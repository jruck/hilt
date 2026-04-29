"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react";

interface DatePickerPopoverProps {
  value: string | null;
  onSelect: (value: string | null) => void;
  onClose: () => void;
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const monthFormatter = new Intl.DateTimeFormat("en-US", {
  month: "long",
  year: "numeric",
});

const displayDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const fullDateFormatter = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function parseIsoDate(value: string | null): Date | null {
  if (!value) return null;
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) {
    return null;
  }
  return date;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function getCalendarDays(month: Date): Date[] {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const gridStart = addDays(firstOfMonth, -firstOfMonth.getDay());
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function formatDueDate(value: string | null): string {
  const date = parseIsoDate(value);
  return date ? displayDateFormatter.format(date) : "";
}

export function DatePickerPopover({ value, onSelect, onClose }: DatePickerPopoverProps) {
  const selectedDate = useMemo(() => parseIsoDate(value), [value]);
  const today = useMemo(() => startOfDay(new Date()), []);
  const [visibleMonth, setVisibleMonth] = useState(() => selectedDate ?? today);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const days = useMemo(() => getCalendarDays(visibleMonth), [visibleMonth]);

  function selectDate(date: Date) {
    onSelect(toIsoDate(date));
  }

  return (
    <div
      ref={containerRef}
      className="absolute right-0 top-full mt-1 w-72 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden"
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border-default)]">
        <CalendarDays className="w-4 h-4 text-[var(--text-tertiary)]" />
        <div className="flex-1 text-sm font-medium text-[var(--text-primary)]">
          Due date
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
          aria-label="Close date picker"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      <div className="px-3 py-3">
        <div className="flex items-center justify-between mb-3">
          <button
            onClick={() => setVisibleMonth((current) => addMonths(current, -1))}
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="text-sm font-medium text-[var(--text-primary)]">
            {monthFormatter.format(visibleMonth)}
          </div>
          <button
            onClick={() => setVisibleMonth((current) => addMonths(current, 1))}
            className="w-7 h-7 flex items-center justify-center rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="grid grid-cols-7 gap-1 mb-1">
          {WEEKDAYS.map((day, index) => (
            <div
              key={`${day}-${index}`}
              className="h-7 flex items-center justify-center text-[10px] font-medium text-[var(--text-tertiary)]"
            >
              {day}
            </div>
          ))}
        </div>

        <div className="grid grid-cols-7 gap-1">
          {days.map((day) => {
            const iso = toIsoDate(day);
            const inMonth = day.getMonth() === visibleMonth.getMonth();
            const selected = selectedDate ? isSameDay(day, selectedDate) : false;
            const current = isSameDay(day, today);
            return (
              <button
                key={iso}
                onClick={() => selectDate(day)}
                className={`h-8 rounded-md text-sm transition-colors ${
                  selected
                    ? "bg-[var(--interactive-default)] text-white"
                    : current
                      ? "text-[var(--text-primary)] ring-1 ring-inset ring-[var(--interactive-default)] hover:bg-[var(--bg-secondary)]"
                      : inMonth
                        ? "text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                        : "text-[var(--text-quaternary)] hover:bg-[var(--bg-secondary)]"
                }`}
                aria-label={fullDateFormatter.format(day)}
                aria-pressed={selected}
              >
                {day.getDate()}
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2 mt-3">
          <button
            onClick={() => selectDate(today)}
            className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Today
          </button>
          <button
            onClick={() => selectDate(addDays(today, 1))}
            className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-[var(--text-secondary)] bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            Tomorrow
          </button>
          {value && (
            <button
              onClick={() => onSelect(null)}
              className="flex-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 bg-red-500/10 hover:bg-red-500/15 transition-colors"
            >
              Clear
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
