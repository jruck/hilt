"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { ArrowLeft, CalendarDays, Check, Copy, EyeOff, FolderOpen, Inbox, MoreVertical, Network, Settings } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { isGraphEnabled } from "@/lib/graph/config";
import { buildGraphScope } from "@/components/graph/graph-deeplink";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import MeetingRow from "./MeetingRow";
import type { PersonCalendarCandidate, PersonDetail, PersonMeeting, SuggestedMeeting } from "@/lib/types";

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
  onSelectCalendarCandidate?: (candidate: PersonCalendarCandidate) => Promise<void>;
  onPersonUpdated?: () => Promise<void> | void;
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
  onSelectCalendarCandidate,
  onPersonUpdated,
  onPromoteSuggested,
  onHideSuggested,
}: PersonMeetingListProps) {
  const { navigateTo } = useScope();
  const graphEnabled = isGraphEnabled();
  const [showConfig, setShowConfig] = useState(false);
  const [showSuggestedActions, setShowSuggestedActions] = useState(false);
  const [showPromoteForm, setShowPromoteForm] = useState(false);
  const [showCalendarMenu, setShowCalendarMenu] = useState(false);
  const [showActionsMenu, setShowActionsMenu] = useState(false);
  const [promoteType, setPromoteType] = useState<"person" | "group">("group");
  const [description, setDescription] = useState("");
  const [actionPending, setActionPending] = useState<"promote" | "hide" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  useMobileChromeVisibilityLock(showConfig || showSuggestedActions || showPromoteForm || showCalendarMenu || showActionsMenu || actionPending !== null);
  const mobileHeaderChromeEnabled = !(showConfig || showSuggestedActions || showPromoteForm || showCalendarMenu || showActionsMenu || actionPending !== null);
  const calendarCandidates = person?.calendarLinks.candidates ?? [];
  const selectedCalendarKey = person?.calendarLinks.selectedSeriesKey ?? person?.calendarLinks.primary?.seriesKey ?? null;

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

  const handleOpenCalendarCandidate = useCallback((candidate: PersonCalendarCandidate) => {
    void onSelectCalendarCandidate?.(candidate);
    navigateTo("calendar", `/event/${encodeURIComponent(candidate.eventId)}/${candidate.start.slice(0, 10)}`);
  }, [navigateTo, onSelectCalendarCandidate]);

  const handleSelectCalendarCandidate = useCallback((candidate: PersonCalendarCandidate) => {
    setShowCalendarMenu(false);
    void onSelectCalendarCandidate?.(candidate);
  }, [onSelectCalendarCandidate]);

  const handleCopyPersonPath = useCallback(() => {
    if (!person?.personFilePath) return;
    void navigator.clipboard.writeText(person.personFilePath);
    setShowActionsMenu(false);
  }, [person?.personFilePath]);

  const handleRevealPerson = useCallback(() => {
    if (!person?.personFilePath) return;
    setShowActionsMenu(false);
    void fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: person.personFilePath }),
    });
  }, [person?.personFilePath]);

  useEffect(() => {
    if (!showActionsMenu) return;
    function handleClick(event: MouseEvent) {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setShowActionsMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showActionsMenu]);

  useEffect(() => {
    setShowActionsMenu(false);
    setShowCalendarMenu(false);
    setShowConfig(false);
  }, [person?.slug, inboxMode, suggestedName]);

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
                  <div className="ml-2 flex flex-shrink-0 items-center gap-1">
                    {calendarCandidates.length === 1 && (
                      <button
                        onClick={() => handleOpenCalendarCandidate(calendarCandidates[0])}
                        className="flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)] transition-colors"
                        title={`Open ${formatCandidateDate(calendarCandidates[0])}`}
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                        {formatCandidateShortDate(calendarCandidates[0])}
                      </button>
                    )}
                    {calendarCandidates.length > 1 && (
                      <button
                        onClick={() => {
                          setShowActionsMenu(false);
                          setShowCalendarMenu((value) => !value);
                        }}
                        className={`flex items-center gap-1 px-1.5 py-1 text-xs font-medium rounded-md transition-colors ${
                          showCalendarMenu
                            ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                            : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
                        }`}
                        title="Choose calendar series"
                      >
                        <CalendarDays className="w-3.5 h-3.5" />
                        {person.calendarLinks.primary ? formatCandidateShortDate(person.calendarLinks.primary) : "Calendar"}
                      </button>
                    )}
                    <div className="relative" ref={actionsMenuRef}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowCalendarMenu(false);
                          setShowActionsMenu((value) => !value);
                        }}
                        className={`p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded-md ${
                          showActionsMenu ? "bg-[var(--bg-secondary)] text-[var(--text-secondary)]" : ""
                        }`}
                        title="More actions"
                      >
                        <MoreVertical className="w-4 h-4" />
                      </button>
                      {showActionsMenu && (
                        <div className="absolute right-0 top-full z-50 mt-1 w-48 overflow-hidden rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] py-1 shadow-lg">
                          {graphEnabled && (
                            <button
                              type="button"
                              onClick={() => {
                                setShowActionsMenu(false);
                                navigateTo("system", buildGraphScope({ focus: person.slug }));
                              }}
                              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
                            >
                              <Network className="h-4 w-4 text-[var(--text-tertiary)]" />
                              Show in Graph
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => {
                              setShowActionsMenu(false);
                              setShowConfig((value) => !value);
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
                          >
                            <Settings className="h-4 w-4 text-[var(--text-tertiary)]" />
                            Matching settings
                          </button>
                          <div className="my-1 border-t border-[var(--border-default)]" />
                          <button
                            type="button"
                            onClick={handleCopyPersonPath}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
                          >
                            <Copy className="h-4 w-4 text-[var(--text-tertiary)]" />
                            Copy path
                          </button>
                          <button
                            type="button"
                            onClick={handleRevealPerson}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-[var(--text-primary)] transition-colors hover:bg-[var(--bg-secondary)]"
                          >
                            <FolderOpen className="h-4 w-4 text-[var(--text-tertiary)]" />
                            Reveal in Finder
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>
        </div>

        {/* Config Panel (person mode only) */}
        {showConfig && person && !inboxMode && (
          <ConfigPanel person={person} onSaved={onPersonUpdated} />
        )}

        {showCalendarMenu && person && !inboxMode && (
          <CalendarCandidateMenu
            candidates={calendarCandidates}
            selectedSeriesKey={selectedCalendarKey}
            onSelect={handleSelectCalendarCandidate}
            onOpen={handleOpenCalendarCandidate}
          />
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
        <div data-mobile-scroll-chrome="top-bottom" className="hilt-mobile-scroll-clearance flex-1 overflow-y-auto">
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

function CalendarCandidateMenu({
  candidates,
  selectedSeriesKey,
  onSelect,
  onOpen,
}: {
  candidates: PersonCalendarCandidate[];
  selectedSeriesKey: string | null;
  onSelect: (candidate: PersonCalendarCandidate) => void;
  onOpen: (candidate: PersonCalendarCandidate) => void;
}) {
  return (
    <div className="flex-shrink-0 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-3 py-2">
      <div className="space-y-1">
        {candidates.map((candidate) => {
          const selected = candidate.seriesKey === selectedSeriesKey;
          return (
            <div key={candidate.seriesKey} className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onSelect(candidate)}
                className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                title={candidate.title}
              >
                <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                  {selected ? <Check className="h-3.5 w-3.5 text-amber-500" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-[var(--text-primary)]">{candidate.title}</span>
                  <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                    {formatCandidateDate(candidate)} · {candidate.historicalCount} recording{candidate.historicalCount === 1 ? "" : "s"}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => onOpen(candidate)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-secondary)]"
                title="Open calendar event"
              >
                <CalendarDays className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatCandidateShortDate(candidate: PersonCalendarCandidate): string {
  const date = new Date(candidate.start);
  if (Number.isNaN(date.getTime())) return "Calendar";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatCandidateDate(candidate: PersonCalendarCandidate): string {
  const date = new Date(candidate.start);
  if (Number.isNaN(date.getTime())) return candidate.start;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

// ─── Config Panel ───

function ConfigPanel({ person, onSaved }: { person: PersonDetail; onSaved?: () => Promise<void> | void }) {
  const filename = person.personFilePath.split("/").pop() || "";
  const matchingTerms = [person.slug, person.name, ...person.aliases].join(", ");
  const [name, setName] = useState(person.name);
  const [description, setDescription] = useState(person.description);
  const [aliases, setAliases] = useState(person.aliases.join(", "));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(person.name);
    setDescription(person.description);
    setAliases(person.aliases.join(", "));
    setError(null);
  }, [person.aliases, person.description, person.name, person.slug]);

  const handleSave = useCallback(async () => {
    const nextName = name.trim();
    if (!nextName) {
      setError("Name is required");
      return;
    }

    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/bridge/people/${person.slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: nextName,
          description,
          aliases: aliases.split(",").map((alias) => alias.trim()).filter(Boolean),
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Save failed with HTTP ${response.status}`);
      }

      await onSaved?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [aliases, description, name, onSaved, person.slug]);

  return (
    <div className="flex-shrink-0 space-y-3 border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-3 text-xs">
      <div className="grid gap-2">
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Title</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--interactive-default)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Description</span>
          <input
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--interactive-default)]"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Aliases</span>
          <input
            value={aliases}
            onChange={(event) => setAliases(event.target.value)}
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--interactive-default)]"
          />
        </label>
        {error && (
          <div className="text-red-500">{error}</div>
        )}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="rounded-md bg-[var(--interactive-default)] px-2.5 py-1.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[var(--text-tertiary)]">File: </span>
        <span className="font-mono text-[var(--text-primary)]">{filename}</span>
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
