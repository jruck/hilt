"use client";

import { useState, useCallback, useEffect, useRef, type ReactNode } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowLeft, CalendarDays, Check, Copy, ExternalLink, EyeOff, FileText, FolderOpen, Inbox, Link as LinkIcon, Loader2, MoreVertical, Network, Plus, Settings, Trash2, Video } from "lucide-react";
import { useScope } from "@/contexts/ScopeContext";
import { isGraphEnabled } from "@/lib/graph/config";
import { buildGraphScope } from "@/components/graph/graph-deeplink";
import { buildReference } from "@/lib/references/build";
import { copyToClipboard } from "@/lib/references/clipboard";
import { MobileChromeContent, MobileChromeTopBar, useMobileChromeVisibilityLock } from "@/contexts/MobileChromeContext";
import MeetingRow from "./MeetingRow";
import type { PersonActiveMeeting, PersonCalendarCandidate, PersonDetail, PersonMeeting, PersonResourceLink, SuggestedMeeting } from "@/lib/types";
import { withBasePath } from "@/lib/base-path";
import { formatHiltMonthDay } from "@/lib/display-date";

type MeetingFilter = "all" | "notes" | "granola";

const MEETING_ROW_HEIGHT = 56;
const MEETING_ROW_OVERSCAN = 10;

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
  const [showResourceForm, setShowResourceForm] = useState(false);
  const [resourceUrl, setResourceUrl] = useState("");
  const [resourceLabel, setResourceLabel] = useState("");
  const [resourcePending, setResourcePending] = useState<"add" | string | null>(null);
  const [resourceError, setResourceError] = useState<string | null>(null);
  const [promoteType, setPromoteType] = useState<"person" | "group">("group");
  const [description, setDescription] = useState("");
  const [actionPending, setActionPending] = useState<"promote" | "hide" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const topChromeContentRef = useRef<HTMLDivElement>(null);
  const [topChromeHeight, setTopChromeHeight] = useState(104);
  useMobileChromeVisibilityLock(showConfig || showSuggestedActions || showPromoteForm || showCalendarMenu || showActionsMenu || showResourceForm || actionPending !== null || resourcePending !== null);
  const mobileHeaderChromeEnabled = !(showConfig || showSuggestedActions || showPromoteForm || showCalendarMenu || showActionsMenu || showResourceForm || actionPending !== null || resourcePending !== null);
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

  const handleAddResource = useCallback(async () => {
    if (!person) return;
    const url = resourceUrl.trim();
    if (!url) {
      setResourceError("URL is required");
      return;
    }

    setResourcePending("add");
    setResourceError(null);
    try {
      const response = await fetch(withBasePath(`/api/bridge/people/${person.slug}/resources`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          label: resourceLabel.trim() || undefined,
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Save failed with HTTP ${response.status}`);
      setResourceUrl("");
      setResourceLabel("");
      setShowResourceForm(false);
      await onPersonUpdated?.();
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : "Could not save resource");
    } finally {
      setResourcePending(null);
    }
  }, [onPersonUpdated, person, resourceLabel, resourceUrl]);

  const handleRemoveResource = useCallback(async (resource: PersonResourceLink) => {
    if (!person) return;
    setResourcePending(resource.id);
    setResourceError(null);
    try {
      const response = await fetch(withBasePath(`/api/bridge/people/${person.slug}/resources`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: resource.id }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.error || `Delete failed with HTTP ${response.status}`);
      await onPersonUpdated?.();
    } catch (error) {
      setResourceError(error instanceof Error ? error.message : "Could not remove resource");
    } finally {
      setResourcePending(null);
    }
  }, [onPersonUpdated, person]);

  const handleCopyPersonPath = useCallback(() => {
    if (!person?.personFilePath) return;
    void copyToClipboard(buildReference({ kind: "person", absPath: person.personFilePath, name: person.name }));
    setShowActionsMenu(false);
  }, [person?.personFilePath, person?.name]);

  const handleRevealPerson = useCallback(() => {
    if (!person?.personFilePath) return;
    setShowActionsMenu(false);
    void fetch(withBasePath("/api/reveal"), {
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
    const element = topChromeContentRef.current;
    if (!element) return;

    const updateHeight = () => {
      setTopChromeHeight(Math.max(1, Math.ceil(element.getBoundingClientRect().height)));
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(element);
    return () => observer.disconnect();
  }, [person?.slug, inboxMode, suggestedName, showConfig, showSuggestedActions, showPromoteForm, showCalendarMenu, showResourceForm, resourceError, resourcePending]);

  useEffect(() => {
    setShowActionsMenu(false);
    setShowCalendarMenu(false);
    setShowConfig(false);
    setShowResourceForm(false);
    setResourceUrl("");
    setResourceLabel("");
    setResourceError(null);
  }, [person?.slug, inboxMode, suggestedName]);

  const meetingListRef = useRef<HTMLDivElement>(null);
  const meetingVirtualizer = useVirtualizer({
    count: displayMeetings.length,
    getScrollElement: () => meetingListRef.current,
    estimateSize: () => MEETING_ROW_HEIGHT,
    overscan: MEETING_ROW_OVERSCAN,
  });

  // Keep the selected meeting visible — matters for deep-links (e.g. /people/
  // {slug}/meeting/{id}) that select a row far below the fold, which a
  // virtualized list would otherwise never render or scroll to.
  useEffect(() => {
    if (selectedMeetingIndex === null || selectedMeetingIndex < 0) return;
    meetingVirtualizer.scrollToIndex(selectedMeetingIndex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMeetingIndex]);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      <MobileChromeTopBar enabled={mobileHeaderChromeEnabled}>
        <div ref={topChromeContentRef}>
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
                            Copy reference
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

        {person && !inboxMode && !suggestedName && (
          <PeopleResourcesSection
            error={resourceError}
            label={resourceLabel}
            onAdd={() => void handleAddResource()}
            onLabelChange={setResourceLabel}
            onRemove={(resource) => void handleRemoveResource(resource)}
            onShowFormChange={setShowResourceForm}
            onUrlChange={setResourceUrl}
            pending={resourcePending}
            resources={person.resources ?? []}
            showForm={showResourceForm}
            url={resourceUrl}
          />
        )}

        {person && !inboxMode && !suggestedName && (person.activeMeetings ?? []).length > 0 && (
          <ActiveMeetingsSection
            meetings={person.activeMeetings ?? []}
            onOpenCalendar={(meeting) => {
              navigateTo("calendar", `/event/${encodeURIComponent(meeting.eventId)}/${meeting.start.slice(0, 10)}`);
            }}
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
        </div>
      </MobileChromeTopBar>

      <MobileChromeContent
        enabled={mobileHeaderChromeEnabled}
        offset={`${topChromeHeight}px`}
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        {/* Meeting List */}
        <div ref={meetingListRef} data-mobile-scroll-chrome="top-bottom" className="hilt-mobile-scroll-clearance flex-1 overflow-y-auto">
          {displayMeetings.length === 0 ? (
            <div className="flex items-center justify-center h-full text-[var(--text-tertiary)] text-sm">
              No meetings yet
            </div>
          ) : (
            <div className="relative w-full" style={{ height: meetingVirtualizer.getTotalSize() }}>
              {meetingVirtualizer.getVirtualItems().map((virtualRow) => {
                const meeting = displayMeetings[virtualRow.index];
                if (!meeting) return null;
                return (
                  <div
                    key={meeting.source === "next" ? "next" : `${meeting.date}-${meeting.source}-${virtualRow.index}`}
                    ref={meetingVirtualizer.measureElement}
                    data-index={virtualRow.index}
                    className="absolute left-0 top-0 w-full"
                    style={{ transform: `translateY(${virtualRow.start}px)` }}
                  >
                    <MeetingRow
                      meeting={meeting}
                      selected={virtualRow.index === selectedMeetingIndex}
                      onClick={() => onSelectMeeting(virtualRow.index)}
                      inboxMode={inboxMode}
                    />
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </MobileChromeContent>
    </div>
  );
}

function PeopleResourcesSection({
  error,
  label,
  onAdd,
  onLabelChange,
  onRemove,
  onShowFormChange,
  onUrlChange,
  pending,
  resources,
  showForm,
  url,
}: {
  error: string | null;
  label: string;
  onAdd: () => void;
  onLabelChange: (value: string) => void;
  onRemove: (resource: PersonResourceLink) => void;
  onShowFormChange: (value: boolean) => void;
  onUrlChange: (value: string) => void;
  pending: "add" | string | null;
  resources: PersonResourceLink[];
  showForm: boolean;
  url: string;
}) {
  const hasResources = resources.length > 0;
  return (
    <div className="flex-shrink-0 border-b border-[var(--border-default)] px-4 py-2.5">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Resources</div>
          {hasResources ? (
            <div className="flex flex-wrap gap-1.5">
              {resources.map((resource) => (
                <span
                  key={resource.id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] px-2 py-1 text-xs text-[var(--text-primary)]"
                >
                  <a
                    href={resource.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex min-w-0 items-center gap-1.5 hover:text-[var(--interactive-default)]"
                    title={resource.url}
                  >
                    {resource.kind === "web" ? <LinkIcon className="h-3 w-3 flex-shrink-0" /> : <FileText className="h-3 w-3 flex-shrink-0" />}
                    <span className="truncate">{resource.label}</span>
                  </a>
                  <button
                    type="button"
                    className="flex h-4 w-4 flex-shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-red-500 disabled:cursor-wait disabled:opacity-60"
                    disabled={pending === resource.id}
                    onClick={() => onRemove(resource)}
                    title="Remove resource"
                  >
                    {pending === resource.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <div className="text-xs text-[var(--text-tertiary)]">No saved resources</div>
          )}
        </div>
        <button
          type="button"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
          onClick={() => onShowFormChange(!showForm)}
          title="Add resource"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>
      {showForm ? (
        <form
          className="mt-2 grid gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            onAdd();
          }}
        >
          <input
            value={url}
            onChange={(event) => onUrlChange(event.target.value)}
            placeholder="https://..."
            className="h-8 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--interactive-default)]"
          />
          <div className="flex items-center gap-2">
            <input
              value={label}
              onChange={(event) => onLabelChange(event.target.value)}
              placeholder="Label (optional)"
              className="h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)] focus:border-[var(--interactive-default)]"
            />
            <button
              type="submit"
              disabled={pending === "add"}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-2.5 text-xs font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-wait disabled:opacity-60"
            >
              {pending === "add" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
              Add
            </button>
          </div>
          {error ? <div className="text-xs text-red-500">{error}</div> : null}
        </form>
      ) : error ? (
        <div className="mt-1.5 text-xs text-red-500">{error}</div>
      ) : null}
    </div>
  );
}

function ActiveMeetingsSection({
  meetings,
  onOpenCalendar,
}: {
  meetings: PersonActiveMeeting[];
  onOpenCalendar: (meeting: PersonActiveMeeting) => void;
}) {
  return (
    <div className="flex-shrink-0 border-b border-[var(--border-default)] px-4 py-2.5">
      <div className="mb-2 text-[10px] font-medium uppercase tracking-wide text-[var(--text-tertiary)]">Active meetings</div>
      <div className="grid gap-2">
        {meetings.map((meeting) => (
          <div key={meeting.seriesKey} className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-secondary)] p-2.5">
            <div className="flex min-w-0 items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-[var(--text-primary)]">{meeting.title}</div>
                <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{formatActiveMeetingTime(meeting)}</div>
                <div className="mt-0.5 text-[11px] text-[var(--text-tertiary)]">
                  {meeting.method === "icaluid" ? "iCal UID" : "Title"} · {Math.round(meeting.confidence * 100)}% · {meeting.historicalCount} recording{meeting.historicalCount === 1 ? "" : "s"}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onOpenCalendar(meeting)}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
                title="Open in Calendar"
              >
                <CalendarDays className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {meeting.joinLinks.map((link, index) => (
                <PeopleActionLink
                  key={`${link.kind}:${link.url}`}
                  href={link.url}
                  icon={<Video className="h-3 w-3" />}
                  label={joinLinkLabel(link.kind)}
                  primary={index === 0}
                />
              ))}
              {meeting.resourceLinks.map((link) => (
                <PeopleActionLink
                  key={`resource:${link.kind}:${link.url}`}
                  href={link.url}
                  icon={link.kind === "web" ? <LinkIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                  label={link.label}
                />
              ))}
              {meeting.providerUrl ? (
                <PeopleActionLink
                  href={meeting.providerUrl}
                  icon={<ExternalLink className="h-3 w-3" />}
                  label="Provider"
                />
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function PeopleActionLink({
  href,
  icon,
  label,
  primary = false,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  primary?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={primary
        ? "inline-flex h-7 items-center gap-1.5 rounded-md bg-[var(--interactive-default)] px-2 text-xs font-medium text-white hover:bg-[var(--interactive-hover)]"
        : "inline-flex h-7 items-center gap-1.5 rounded-md border border-[var(--border-default)] px-2 text-xs text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)]"}
      title={href}
    >
      {icon}
      {label}
    </a>
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
  return formatHiltMonthDay(date);
}

function formatCandidateDate(candidate: PersonCalendarCandidate): string {
  const date = new Date(candidate.start);
  if (Number.isNaN(date.getTime())) return candidate.start;
  const datePart = formatHiltMonthDay(date);
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

function formatActiveMeetingTime(meeting: PersonActiveMeeting): string {
  const start = new Date(meeting.start);
  const end = new Date(meeting.end);
  if (Number.isNaN(start.getTime())) return meeting.start;
  const datePart = formatHiltMonthDay(start);
  const formatter = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  if (Number.isNaN(end.getTime())) return `${datePart}, ${formatter.format(start)}`;
  return `${datePart}, ${formatter.format(start)} - ${formatter.format(end)}`;
}

function joinLinkLabel(kind: PersonActiveMeeting["joinLinks"][number]["kind"]): string {
  if (kind === "teams") return "Teams";
  if (kind === "meet") return "Meet";
  if (kind === "zoom") return "Zoom";
  return "Link";
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
      const response = await fetch(withBasePath(`/api/bridge/people/${person.slug}`), {
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
