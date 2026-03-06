"use client";

import { useState, useCallback } from "react";
import { ArrowLeft, Inbox, Settings, Copy, FolderOpen } from "lucide-react";
import MeetingRow from "./MeetingRow";
import type { PersonDetail, PersonMeeting } from "@/lib/types";

type MeetingFilter = "all" | "notes" | "granola";

interface PersonMeetingListProps {
  slug: string;
  person: PersonDetail | null;
  displayMeetings: PersonMeeting[];
  filter: MeetingFilter;
  onFilterChange: (filter: MeetingFilter) => void;
  selectedMeetingIndex: number | null;
  onSelectMeeting: (index: number) => void;
  vaultPath?: string;
  onClose?: () => void;
  inboxMode?: boolean;
  suggestedName?: string | null;
  totalCount?: number;
}

export function PersonMeetingList({
  person,
  displayMeetings,
  filter,
  onFilterChange,
  selectedMeetingIndex,
  onSelectMeeting,
  onClose,
  inboxMode,
  suggestedName,
  totalCount,
}: PersonMeetingListProps) {
  const [showConfig, setShowConfig] = useState(false);

  const notesCount = person
    ? person.meetings.filter((m) => m.source === "inline").length
    : 0;
  const granolaCount = person
    ? person.meetings.filter((m) => m.source === "granola").length
    : 0;

  const meetingCount = inboxMode || suggestedName
    ? totalCount ?? displayMeetings.length
    : person?.meetings.length ?? 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex-shrink-0 h-16 px-4 flex items-center border-b border-[var(--border-default)]">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            {onClose && (
              <button
                onClick={onClose}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {suggestedName ? (
              <span className="text-base font-semibold text-[var(--text-primary)]">
                {suggestedName}
              </span>
            ) : inboxMode ? (
              <>
                <Inbox className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className="text-base font-semibold text-[var(--text-primary)]">
                  All Meetings
                </span>
              </>
            ) : person ? (
              <>
                <span className="text-base font-semibold text-[var(--text-primary)]">
                  {person.name}
                </span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] uppercase tracking-wide">
                  {person.type === "group" ? "Group" : "Person"}
                </span>
                <button
                  onClick={() => setShowConfig((v) => !v)}
                  className={`ml-auto text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ${
                    showConfig ? "text-[var(--text-secondary)]" : ""
                  }`}
                  title="Show matching config"
                >
                  <Settings className="w-3.5 h-3.5" />
                </button>
              </>
            ) : null}
          </div>
          {!inboxMode && person?.description && (
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              {person.description}
            </div>
          )}
        </div>
      </div>

      {/* Config Panel (person mode only) */}
      {showConfig && person && !inboxMode && (
        <ConfigPanel person={person} />
      )}

      {/* Meetings Header + Filter */}
      <div className="flex-shrink-0 h-10 px-4 border-b border-[var(--border-default)] flex items-center justify-between">
        <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wide">
          Meetings ({meetingCount})
        </span>
        {!inboxMode && !suggestedName && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => onFilterChange("all")}
              className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                filter === "all"
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              All
            </button>
            {notesCount > 0 && (
              <button
                onClick={() => onFilterChange("notes")}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  filter === "notes"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Written
              </button>
            )}
            {granolaCount > 0 && (
              <button
                onClick={() => onFilterChange("granola")}
                className={`text-[11px] px-2 py-0.5 rounded transition-colors ${
                  filter === "granola"
                    ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                }`}
              >
                Recorded
              </button>
            )}
          </div>
        )}
      </div>

      {/* Meeting List */}
      <div className="flex-1 overflow-y-auto">
        {displayMeetings.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
            No meetings yet
          </div>
        ) : (
          displayMeetings.map((meeting, i) => (
            <MeetingRow
              key={meeting.source === "next" ? "next" : `${meeting.date}-${meeting.source}-${i}`}
              meeting={meeting}
              selected={i === selectedMeetingIndex}
              onClick={() => onSelectMeeting(i)}
              inboxMode={inboxMode}
            />
          ))
        )}
      </div>
    </div>
  );
}

// ─── Config Panel ───

function ConfigPanel({ person }: { person: PersonDetail }) {
  const filename = person.personFilePath.split("/").pop() || "";
  const matchingTerms = [person.slug, person.name, ...person.aliases].join(", ");

  const handleCopyPath = useCallback(() => {
    navigator.clipboard.writeText(person.personFilePath);
  }, [person.personFilePath]);

  const handleOpenFinder = useCallback(() => {
    fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: person.personFilePath }),
    });
  }, [person.personFilePath]);

  return (
    <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] text-xs space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">File: </span>
        <span className="font-mono text-[var(--text-primary)]">{filename}</span>
        <button
          onClick={handleCopyPath}
          className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          title="Copy full path"
        >
          <Copy className="w-3 h-3" />
        </button>
        <button
          onClick={handleOpenFinder}
          className="p-0.5 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          title="Open in Finder"
        >
          <FolderOpen className="w-3 h-3" />
        </button>
      </div>
      <div>
        <span className="text-[var(--text-tertiary)]">Aliases: </span>
        <span className="text-[var(--text-primary)]">
          {person.aliases.length > 0 ? person.aliases.join(", ") : "none"}
        </span>
      </div>
      <div>
        <span className="text-[var(--text-tertiary)]">Matching: </span>
        <span className="text-[var(--text-primary)]">{matchingTerms}</span>
      </div>
    </div>
  );
}

export type { MeetingFilter };
