"use client";

import { User, Users } from "lucide-react";
import type { BridgePerson } from "@/lib/types";
import { useHaptics } from "@/hooks/useHaptics";

interface PersonCardProps {
  person: BridgePerson;
  selected?: boolean;
  compact?: boolean;
  onClick?: (person: BridgePerson) => void;
}

function formatRelativeDate(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (days === 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

export function PersonCard({ person, selected, compact, onClick }: PersonCardProps) {
  const haptics = useHaptics();
  return (
    <div
      className={`rounded-lg border bg-[var(--bg-secondary)] ${compact ? "px-2.5 pt-1.5 pb-3" : "px-3 pt-2 pb-3.5"} cursor-pointer transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] ${
        selected
          ? "border-[var(--interactive-default)]"
          : "border-[var(--border-default)]"
      }`}
      onClick={() => { haptics.selection(); onClick?.(person); }}
    >
      {/* Name row */}
      <div className="flex items-center gap-2.5">
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          {person.type === "group" ? (
            <Users className="w-4 h-4 text-[var(--text-tertiary)]" />
          ) : (
            <User className="w-4 h-4 text-[var(--text-tertiary)]" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
            {person.name}
          </div>
        </div>
      </div>

      {/* Description */}
      {person.description && (
        <div className="text-xs text-[var(--text-secondary)] mt-1 truncate">
          {person.description}
        </div>
      )}

      {/* Meta row: last meeting + meeting count */}
      <div className="flex items-center gap-3 mt-1.5">
        {person.lastMeetingDate && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {formatRelativeDate(person.lastMeetingDate)}
          </span>
        )}
        {person.meetingCount > 0 && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {person.meetingCount} meeting{person.meetingCount !== 1 ? "s" : ""}
          </span>
        )}
      </div>

      {/* First next topic */}
      {!compact && person.nextTopics.length > 0 && (
        <div className="text-xs text-[var(--text-tertiary)] mt-1 truncate">
          {person.nextTopics[0]}
        </div>
      )}
    </div>
  );
}
