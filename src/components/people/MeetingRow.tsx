"use client";

import { NotebookPen } from "lucide-react";
import type { PersonMeeting } from "@/lib/types";

interface MeetingRowProps {
  meeting: PersonMeeting;
  selected: boolean;
  onClick: () => void;
}

export default function MeetingRow({ meeting, selected, onClick }: MeetingRowProps) {
  const isNext = meeting.source === "next";

  const formattedDate = isNext
    ? meeting.date
      ? `Next · ${new Date(`${meeting.date}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
      : "Next"
    : new Date(`${meeting.date}T00:00:00`).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
      });

  // Only show title for granola meetings with a real title (not generic "Notes")
  const showTitle = !isNext && meeting.source === "granola" && !!meeting.title;

  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left px-3 h-13 cursor-pointer border-b border-[var(--border-default)] transition-colors flex items-center ${
        selected
          ? "bg-[var(--bg-tertiary)] border-l-2 border-l-amber-500"
          : "hover:bg-[var(--bg-secondary)]"
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-[var(--text-primary)]">{formattedDate}</span>
          {meeting.source === "inline" && (
            <NotebookPen className="w-3.5 h-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
          )}
        </div>
        {showTitle && (
          <div className="text-xs truncate text-[var(--text-tertiary)]">{meeting.title}</div>
        )}
      </div>
    </button>
  );
}
