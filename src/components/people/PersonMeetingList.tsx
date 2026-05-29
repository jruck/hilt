"use client";

import { useState, useCallback } from "react";
import { ArrowLeft, Check, EyeOff, Inbox, Settings, Copy, FolderOpen, NotebookPen } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import MeetingRow from "./MeetingRow";
import type { PersonDetail, PersonMeeting, SuggestedMeeting } from "@/lib/types";

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
  suggestedMeeting?: SuggestedMeeting | null;
  totalCount?: number;
  onCreateNext?: () => void;
  onPromoteSuggested?: (input: {
    name: string;
    type: "person" | "group";
    description: string;
  }) => Promise<void>;
  onHideSuggested?: (suggestion: SuggestedMeeting) => Promise<void>;
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
  suggestedMeeting,
  totalCount,
  onCreateNext,
  onPromoteSuggested,
  onHideSuggested,
}: PersonMeetingListProps) {
  const [showConfig, setShowConfig] = useState(false);
  const [showSuggestedActions, setShowSuggestedActions] = useState(false);
  const [showPromoteForm, setShowPromoteForm] = useState(false);
  const [promoteType, setPromoteType] = useState<"person" | "group">("group");
  const [description, setDescription] = useState("");
  const [actionPending, setActionPending] = useState<"promote" | "hide" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const isMobile = useIsMobile();
  useMobileChromeVisibilityLock(showConfig || showSuggestedActions || showPromoteForm || actionPending !== null);
  const mobileHeaderChromeEnabled = !(showConfig || showSuggestedActions || showPromoteForm || actionPending !== null);

  const notesCount = person
    ? person.meetings.filter((m) => !!m.notes).length
    : 0;
  const granolaCount = person
    ? person.meetings.filter((m) => m.source === "granola").length
    : 0;

  const meetingCount = inboxMode || suggestedName
    ? totalCount ?? displayMeetings.length
    : person?.meetings.length ?? 0;

  const handlePromote = useCallback(async () => {
    if (!suggestedName || !onPromoteSuggested) return;
    setActionPending("promote");
    setActionError(null);
    try {
      await onPromoteSuggested({
        name: suggestedName,
        type: promoteType,
        description,
      });
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not accept suggestion");
    } finally {
      setActionPending(null);
    }
  }, [description, onPromoteSuggested, promoteType, suggestedName]);

  const handleHide = useCallback(async () => {
    if (!suggestedMeeting || !onHideSuggested) return;
    setActionPending("hide");
    setActionError(null);
    try {
      await onHideSuggested(suggestedMeeting);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "Could not hide suggestion");
    } finally {
      setActionPending(null);
    }
  }, [onHideSuggested, suggestedMeeting]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <MobileChromeTopBar enabled={mobileHeaderChromeEnabled}>
        {/* Header */}
        <div className="flex h-16 items-center border-b border-[var(--border-default)] px-4">
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
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base font-semibold text-[var(--text-primary)] truncate">
                        {suggestedName}
                      </span>
                      <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] uppercase tracking-wide">
                        Suggested
                      </span>
                    </div>
                    {suggestedMeeting && (
                      <div className="text-xs text-[var(--text-secondary)] mt-1">
                        {suggestedMeeting.count} unmatched recording{suggestedMeeting.count !== 1 ? "s" : ""}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      onClick={() => {
                        const next = !showSuggestedActions;
                        setShowSuggestedActions(next);
                        if (!next) setShowPromoteForm(false);
                      }}
                      className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ${
                        showSuggestedActions ? "text-[var(--text-secondary)]" : ""
                      }`}
                      title="Show suggestion actions"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              ) : inboxMode ? (
                <>
                  <Inbox className="w-4 h-4 text-[var(--text-tertiary)]" />
                  <span className="text-base font-semibold text-[var(--text-primary)]">
                    All Meetings
                  </span>
                </>
              ) : person ? (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-base font-semibold text-[var(--text-primary)] truncate">
                        {person.name}
                      </span>
                      <span className="flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] uppercase tracking-wide">
                        {person.type === "group" ? "Group" : "Person"}
                      </span>
                    </div>
                    {person.description && (
                      <div className="text-xs text-[var(--text-secondary)] mt-1 truncate">
                        {person.description}
                      </div>
                    )}
                  </div>
                  <div className="ml-auto flex flex-shrink-0 items-center gap-1">
                    {onCreateNext && (
                      <button
                        onClick={onCreateNext}
                        className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        title="Open prep note"
                      >
                        <NotebookPen className="w-3.5 h-3.5" />
                        Prep
                      </button>
                    )}
                    <button
                      onClick={() => setShowConfig((v) => !v)}
                      className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ${
                        showConfig ? "text-[var(--text-secondary)]" : ""
                      }`}
                      title="Show matching config"
                    >
                      <Settings className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Config Panel (person mode only) */}
        {showConfig && person && !inboxMode && (
          <ConfigPanel person={person} />
        )}

      {showSuggestedActions && suggestedName && (
        <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)]">
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setShowPromoteForm((value) => !value)}
              disabled={actionPending !== null || !onPromoteSuggested}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md bg-[var(--interactive-default)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              <Check className="w-3.5 h-3.5" />
              Accept
            </button>
            <button
              type="button"
              onClick={handleHide}
              disabled={actionPending !== null || !suggestedMeeting || !onHideSuggested}
              className="flex items-center justify-center gap-1.5 px-2 py-1.5 text-xs font-medium rounded-md border border-[var(--border-default)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              <EyeOff className="w-3.5 h-3.5" />
              {actionPending === "hide" ? "Hiding..." : "Hide"}
            </button>
          </div>
        </div>
      )}

      {showPromoteForm && suggestedName && (
        <form
          className="flex-shrink-0 px-4 py-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            handlePromote();
          }}
        >
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPromoteType("group")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                promoteType === "group"
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              }`}
            >
              Group
            </button>
            <button
              type="button"
              onClick={() => setPromoteType("person")}
              className={`px-2 py-1 text-xs rounded-md transition-colors ${
                promoteType === "person"
                  ? "bg-[var(--bg-tertiary)] text-[var(--text-primary)] font-medium"
                  : "text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
              }`}
            >
              Person
            </button>
          </div>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Description (optional)"
            className="w-full px-2 py-1.5 text-sm rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] outline-none focus:border-[var(--interactive-default)]"
          />
          {actionError && (
            <div className="text-xs text-red-500">
              {actionError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowPromoteForm(false)}
              disabled={actionPending !== null}
              className="px-2 py-1 text-xs font-medium rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={actionPending !== null}
              className="px-2 py-1 text-xs font-medium rounded-md bg-[var(--interactive-default)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity"
            >
              {actionPending === "promote" ? "Accepting..." : "Accept"}
            </button>
          </div>
        </form>
      )}

      {actionError && !showPromoteForm && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-[var(--border-default)] bg-red-50 text-xs text-red-600">
          {actionError}
        </div>
      )}

        {/* Meetings Header + Filter */}
        <div className="flex h-10 items-center justify-between border-b border-[var(--border-default)] px-4">
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
      </MobileChromeTopBar>

      <MobileChromeContent
        enabled={mobileHeaderChromeEnabled}
        offset="104px"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Meeting List */}
        <div data-mobile-scroll-chrome="top-bottom" className={`flex-1 overflow-y-auto ${isMobile ? "pb-[var(--hilt-mobile-nav-clearance)]" : ""}`}>
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
      </MobileChromeContent>
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
