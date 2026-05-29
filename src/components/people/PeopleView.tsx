"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { ChevronDown, ChevronRight, Inbox, Loader2, Users } from "lucide-react";
import { useBridgePeople } from "@/hooks/useBridgePeople";
import { usePersonDetail } from "@/hooks/usePersonDetail";
import { useInboxMeetings } from "@/hooks/useInboxMeetings";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScope } from "@/contexts/ScopeContext";
import { MobileChromeContent, MobileChromeTopBar } from "@/contexts/MobileChromeContext";
import { PersonCard } from "./PersonCard";
import { PersonMeetingList } from "./PersonMeetingList";
import { MeetingEntry } from "./MeetingEntry";
import { GranolaSyncControl } from "./GranolaSyncControl";
import type { MeetingFilter } from "./PersonMeetingList";
import type { BridgePerson, PersonMeeting, SuggestedMeeting } from "@/lib/types";

const INBOX_SLUG = "__inbox__";
const SUGGESTED_PREFIX = "__suggested__/";
const PEOPLE_SCOPE_STORAGE_KEY = "hilt-people-scope";
const OLDER_PEOPLE_DAYS = 60;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function isOlderPerson(person: BridgePerson): boolean {
  if (!person.lastMeetingDate) return false;
  const lastMeetingTime = new Date(person.lastMeetingDate).getTime();
  if (Number.isNaN(lastMeetingTime)) return false;
  return Date.now() - lastMeetingTime > OLDER_PEOPLE_DAYS * MS_PER_DAY;
}

function getDefaultMeetingIndex(meetings: PersonMeeting[]): number | null {
  if (meetings.length === 0) return null;
  const firstSavedMeetingIndex = meetings.findIndex((meeting) => meeting.source !== "next");
  return firstSavedMeetingIndex === -1 ? 0 : firstSavedMeetingIndex;
}

interface PeopleViewProps {
  searchQuery?: string;
}

export function PeopleView({ searchQuery = "" }: PeopleViewProps) {
  const { data, isLoading, mutate: mutatePeople } = useBridgePeople();
  const isMobile = useIsMobile();
  const { scopePath, navigateTo } = useScope();

  // Derive selected slug from URL scope: "/amrit" → "amrit", "/__inbox__" → "__inbox__"
  const rawSelectedSlug =
    scopePath && scopePath.startsWith("/")
      ? scopePath.slice(1) || null
      : scopePath || null;
  const meetingDeepLink = rawSelectedSlug?.match(/^([^/]+)\/meeting\/(.+)$/) ?? null;
  const selectedSlug = meetingDeepLink ? meetingDeepLink[1] : rawSelectedSlug;
  const targetGranolaId = meetingDeepLink ? decodeURIComponent(meetingDeepLink[2]) : null;

  const isInboxMode = selectedSlug === INBOX_SLUG;
  const isSuggestedMode = selectedSlug?.startsWith(SUGGESTED_PREFIX) ?? false;
  const suggestedName = isSuggestedMode ? decodeURIComponent(selectedSlug!.slice(SUGGESTED_PREFIX.length)) : null;
  const personSlug = isInboxMode || isSuggestedMode ? null : selectedSlug;
  const supportsNext = !!personSlug && !isInboxMode && !isSuggestedMode;
  const hasAppliedInitialDefaultSelection = useRef(false);
  const [olderPeopleExpanded, setOlderPeopleExpanded] = useState(false);

  useEffect(() => {
    if (!data) return;

    const hasKnownSelection =
      selectedSlug === INBOX_SLUG ||
      (selectedSlug?.startsWith(SUGGESTED_PREFIX) ?? false) ||
      data.people.some((person) => person.slug === selectedSlug);

    if (selectedSlug && !hasKnownSelection) {
      navigateTo("people", `/${INBOX_SLUG}`);
      return;
    }

    if (!selectedSlug && !hasAppliedInitialDefaultSelection.current) {
      hasAppliedInitialDefaultSelection.current = true;
      navigateTo("people", `/${INBOX_SLUG}`);
      return;
    }

    hasAppliedInitialDefaultSelection.current = true;

    if (hasKnownSelection && typeof window !== "undefined") {
      localStorage.setItem(PEOPLE_SCOPE_STORAGE_KEY, selectedSlug ? `/${selectedSlug}` : "");
    }
  }, [data, selectedSlug, navigateTo]);

  const q = searchQuery.toLowerCase().trim();

  const filteredPeople = useMemo(() => {
    if (!data?.people) return [];
    if (!q) return data.people;
    return data.people.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q)
    );
  }, [data, q]);

  const filteredSuggestedMeetings = useMemo(() => {
    if (!data?.suggestedMeetings) return [];
    if (!q) return data.suggestedMeetings;
    return data.suggestedMeetings.filter((meeting) =>
      meeting.name.toLowerCase().includes(q)
    );
  }, [data, q]);

  const { recentPeople, olderPeople } = useMemo(() => {
    const recent: BridgePerson[] = [];
    const older: BridgePerson[] = [];

    for (const person of filteredPeople) {
      if (isOlderPerson(person)) {
        older.push(person);
      } else {
        recent.push(person);
      }
    }

    return { recentPeople: recent, olderPeople: older };
  }, [filteredPeople]);

  // Person detail — fetched when a person (not inbox) is selected
  const { data: personDetail, mutate: mutatePersonDetail } = usePersonDetail(personSlug);
  const activePersonDetail = personDetail?.slug === personSlug ? personDetail : null;

  // Inbox data — fetched when inbox or suggested is selected
  const { data: inboxData } = useInboxMeetings(isInboxMode || isSuggestedMode, suggestedName ?? undefined);

  const selectedSuggestedMeeting = useMemo(() => {
    if (!suggestedName || !data?.suggestedMeetings) return null;
    return data.suggestedMeetings.find((meeting) => meeting.name === suggestedName) ?? null;
  }, [data, suggestedName]);

  // Meeting filter
  const [filterState, setFilterState] = useState<{ slug: string | null; value: MeetingFilter }>({
    slug: null,
    value: "all",
  });
  const filter = filterState.slug === selectedSlug ? filterState.value : "all";

  const filteredMeetings = useMemo(() => {
    if (isInboxMode || isSuggestedMode) {
      return (inboxData?.meetings ?? []).filter((meeting) => meeting.source !== "next");
    }
    if (!activePersonDetail) return [];
    if (filter === "all") return activePersonDetail.meetings;
    if (filter === "notes") return activePersonDetail.meetings.filter((m) => !!m.notes);
    return activePersonDetail.meetings.filter(
      (m) => m.source === "granola"
    );
  }, [isInboxMode, isSuggestedMode, inboxData, activePersonDetail, filter]);

  // Build the synthetic "Next" entry (person mode only)
  const nextEntry = useMemo((): PersonMeeting | null => {
    if (!supportsNext || !activePersonDetail) return null;

    return {
      source: "next",
      date: "",
      title: "Next",
      notes: activePersonDetail.nextRaw,
    };
  }, [supportsNext, activePersonDetail]);

  // Display meetings: Next pinned at top + filtered historical meetings
  const displayMeetings = useMemo(() => {
    const list: PersonMeeting[] = [];
    if (nextEntry) list.push(nextEntry);
    list.push(...filteredMeetings);
    return list;
  }, [nextEntry, filteredMeetings]);

  // Meeting selection — index into displayMeetings, scoped to the current slug.
  const [meetingSelection, setMeetingSelection] = useState<{ slug: string | null; index: number | null }>({
    slug: null,
    index: null,
  });

  const defaultMeetingIdx = useMemo(() => getDefaultMeetingIndex(displayMeetings), [displayMeetings]);

  const selectedMeetingIdx = useMemo(() => {
    if (displayMeetings.length === 0) return null;
    const fallbackIndex = defaultMeetingIdx ?? 0;
    const rawIndex = meetingSelection.slug === selectedSlug ? meetingSelection.index : fallbackIndex;
    if (rawIndex === null) return fallbackIndex;
    if (rawIndex < 0 || rawIndex >= displayMeetings.length) return fallbackIndex;
    return rawIndex;
  }, [defaultMeetingIdx, displayMeetings.length, meetingSelection, selectedSlug]);

  const handleFilterChange = useCallback(
    (nextFilter: MeetingFilter) => {
      setFilterState({ slug: selectedSlug, value: nextFilter });
      setMeetingSelection({ slug: selectedSlug, index: null });
    },
    [selectedSlug]
  );

  const selectedMeeting =
    selectedMeetingIdx !== null ? displayMeetings[selectedMeetingIdx] ?? null : null;

  // Auto-focus the editor when the topmost meeting is selected and is editable
  const shouldAutoFocus =
    supportsNext &&
    selectedMeetingIdx === 0 &&
    selectedMeeting !== null &&
    (selectedMeeting.source === "next" || selectedMeeting.source === "inline");

  const vaultPath = isInboxMode || isSuggestedMode
    ? inboxData?.vaultPath
    : activePersonDetail?.personFilePath
      ? activePersonDetail.personFilePath.replace(/\/people\/[^/]+$/, "")
      : undefined;

  const handleDeleteMeeting = useCallback(() => {
    mutatePersonDetail();
    setMeetingSelection({ slug: selectedSlug, index: null });
  }, [mutatePersonDetail, selectedSlug]);

  const handleSelect = useCallback(
    (person: BridgePerson) => {
      setMeetingSelection({ slug: person.slug, index: null });
      if (selectedSlug !== person.slug) {
        navigateTo("people", `/${person.slug}`);
      }
    },
    [selectedSlug, navigateTo]
  );

  const handleInboxSelect = useCallback(() => {
    if (isInboxMode) {
      navigateTo("people", "");
    } else {
      navigateTo("people", `/${INBOX_SLUG}`);
    }
  }, [isInboxMode, navigateTo]);

  const handleSuggestedSelect = useCallback(
    (name: string) => {
      const encoded = encodeURIComponent(name);
      const target = SUGGESTED_PREFIX + encoded;
      if (selectedSlug === target) {
        navigateTo("people", "");
      } else {
        navigateTo("people", `/${target}`);
      }
    },
    [selectedSlug, navigateTo]
  );

  const handlePromoteSuggested = useCallback(
    async (input: { name: string; type: "person" | "group"; description: string }) => {
      const response = await fetch("/api/bridge/people/suggestions/promote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to accept suggestion");
      }

      const body = await response.json();
      await mutatePeople();
      if (body.slug) {
        setMeetingSelection({ slug: body.slug, index: null });
        navigateTo("people", `/${body.slug}`);
      }
    },
    [mutatePeople, navigateTo]
  );

  const handleHideSuggested = useCallback(
    async (suggestion: SuggestedMeeting) => {
      const response = await fetch("/api/bridge/people/suggestions/hide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(suggestion),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || "Failed to hide suggestion");
      }

      await mutatePeople();
      if (suggestedName === suggestion.name) {
        navigateTo("people", `/${INBOX_SLUG}`);
      }
    },
    [mutatePeople, navigateTo, suggestedName]
  );

  const handleClose = useCallback(() => {
    navigateTo("people", "");
  }, [navigateTo]);

  // Mobile: track navigation depth for stacked screens
  const [mobileShowMeeting, setMobileShowMeeting] = useState(false);

  useEffect(() => {
    if (!targetGranolaId || !selectedSlug || displayMeetings.length === 0) return;
    const index = displayMeetings.findIndex((meeting) => meeting.granolaId === targetGranolaId);
    if (index === -1) return;
    setMeetingSelection({ slug: selectedSlug, index });
    if (isMobile) setMobileShowMeeting(true);
  }, [displayMeetings, isMobile, selectedSlug, targetGranolaId]);

  const handleCreateNext = useCallback(() => {
    if (!supportsNext) return;
    setFilterState({ slug: selectedSlug, value: "all" });
    setMeetingSelection({ slug: selectedSlug, index: 0 });
    if (isMobile) setMobileShowMeeting(true);
  }, [isMobile, selectedSlug, supportsNext]);

  const handleMobileSelectMeeting = useCallback((idx: number) => {
    setMeetingSelection({ slug: selectedSlug, index: idx });
    setMobileShowMeeting(true);
  }, [selectedSlug]);

  const handleMobileBackFromMeeting = useCallback(() => {
    setMobileShowMeeting(false);
  }, []);

  // Determine if middle column has data to show
  const hasMiddleContent = isInboxMode || isSuggestedMode
    ? !!inboxData
    : !!(personSlug && activePersonDetail);

  // Loading state
  if (isLoading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  // Empty state
  if (!data || (filteredPeople.length === 0 && filteredSuggestedMeetings.length === 0)) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
        <Users className="w-8 h-8" />
        <p className="text-sm">{q ? "No matching people" : "No people yet"}</p>
        {!q && (
          <p className="text-xs max-w-[240px] text-center">
            People will appear here once your agents start tracking them.
          </p>
        )}
      </div>
    );
  }

  // ─── Mobile Layout ─── stacked navigation
  if (isMobile) {
    // Level 3: Meeting content
    if (selectedSlug && mobileShowMeeting && selectedMeeting) {
      return (
        <div className="relative flex-1 flex flex-col overflow-hidden">
          <MobileChromeTopBar>
          <div className="flex h-11 items-center border-b border-[var(--border-default)] px-3">
            <button
              onClick={handleMobileBackFromMeeting}
              className="text-sm text-[var(--text-accent)]"
            >
              &larr; Back
            </button>
          </div>
          </MobileChromeTopBar>
          <MobileChromeContent className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div data-mobile-scroll-chrome="top-bottom" className="flex-1 overflow-y-auto pb-[var(--hilt-mobile-nav-clearance)]">
              <MeetingEntry
                meeting={selectedMeeting}
                slug={isInboxMode || isSuggestedMode ? "" : (personSlug ?? "")}
                vaultPath={vaultPath}
                autoFocus={shouldAutoFocus}
                onDelete={isInboxMode || isSuggestedMode ? undefined : handleDeleteMeeting}
                onSaved={isInboxMode || isSuggestedMode ? undefined : mutatePersonDetail}
              />
            </div>
          </MobileChromeContent>
        </div>
      );
    }

    // Level 2: Meeting list (person, inbox, or suggested)
    if (selectedSlug && hasMiddleContent) {
      return (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <PersonMeetingList
              slug={selectedSlug}
              person={isInboxMode || isSuggestedMode ? null : activePersonDetail!}
              displayMeetings={displayMeetings}
              filter={filter}
              onFilterChange={handleFilterChange}
              selectedMeetingIndex={selectedMeetingIdx}
              onSelectMeeting={handleMobileSelectMeeting}
              vaultPath={vaultPath}
              onClose={handleClose}
              inboxMode={isInboxMode}
              suggestedName={suggestedName}
              suggestedMeeting={selectedSuggestedMeeting}
              totalCount={inboxData?.totalCount}
              onCreateNext={supportsNext ? handleCreateNext : undefined}
              onPromoteSuggested={isSuggestedMode ? handlePromoteSuggested : undefined}
              onHideSuggested={isSuggestedMode ? handleHideSuggested : undefined}
            />
          </div>
        </div>
      );
    }

    // Level 1: Person list
    return (
      <div data-mobile-scroll-chrome="bottom" className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 pb-[var(--hilt-mobile-nav-clearance)] space-y-4">
          <PeopleListSections
            inboxStats={data.inboxStats}
            isInboxMode={isInboxMode}
            selectedSlug={selectedSlug}
            suggestedMeetings={filteredSuggestedMeetings}
            recentPeople={recentPeople}
            olderPeople={olderPeople}
            olderPeopleExpanded={olderPeopleExpanded}
            forceShowOlderPeople={!!q}
            onInboxSelect={handleInboxSelect}
            onSuggestedSelect={handleSuggestedSelect}
            onSelectPerson={handleSelect}
            onToggleOlderPeople={() => setOlderPeopleExpanded((expanded) => !expanded)}
          />
        </div>
      </div>
    );
  }

  // ─── Desktop Layout ─── three-column
  return (
    <div className="flex-1 flex overflow-hidden">
      {/* Left: People list */}
      <div className="w-56 flex-shrink-0 overflow-y-auto border-r border-[var(--border-default)]">
        <div className="px-2 py-2 space-y-2">
          <PeopleListSections
            compact
            inboxStats={data.inboxStats}
            isInboxMode={isInboxMode}
            selectedSlug={selectedSlug}
            suggestedMeetings={filteredSuggestedMeetings}
            recentPeople={recentPeople}
            olderPeople={olderPeople}
            olderPeopleExpanded={olderPeopleExpanded}
            forceShowOlderPeople={!!q}
            onInboxSelect={handleInboxSelect}
            onSuggestedSelect={handleSuggestedSelect}
            onSelectPerson={handleSelect}
            onToggleOlderPeople={() => setOlderPeopleExpanded((expanded) => !expanded)}
          />
        </div>
      </div>

      {/* Middle: Meeting feed */}
      {hasMiddleContent ? (
        <div className="w-80 flex-shrink-0 border-r border-[var(--border-default)] overflow-hidden">
          <PersonMeetingList
            slug={selectedSlug!}
            person={isInboxMode || isSuggestedMode ? null : activePersonDetail!}
            displayMeetings={displayMeetings}
            filter={filter}
            onFilterChange={handleFilterChange}
            selectedMeetingIndex={selectedMeetingIdx}
            onSelectMeeting={(idx) => setMeetingSelection({ slug: selectedSlug, index: idx })}
            vaultPath={vaultPath}
            inboxMode={isInboxMode}
            suggestedName={suggestedName}
            suggestedMeeting={selectedSuggestedMeeting}
            totalCount={inboxData?.totalCount}
            onCreateNext={supportsNext ? handleCreateNext : undefined}
            onPromoteSuggested={isSuggestedMode ? handlePromoteSuggested : undefined}
            onHideSuggested={isSuggestedMode ? handleHideSuggested : undefined}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
          <p className="text-sm">Select a person</p>
        </div>
      )}

      {/* Right: Meeting content */}
      {hasMiddleContent && (
        <div className="flex-1 overflow-y-auto">
          {selectedMeeting ? (
            <MeetingEntry
              meeting={selectedMeeting}
              slug={isInboxMode || isSuggestedMode ? "" : (personSlug ?? "")}
              vaultPath={vaultPath}
              autoFocus={shouldAutoFocus}
              onDelete={isInboxMode || isSuggestedMode ? undefined : handleDeleteMeeting}
              onSaved={isInboxMode || isSuggestedMode ? undefined : mutatePersonDetail}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-[var(--text-tertiary)]">
              <p className="text-sm">No meetings</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Inbox Card ───

function PeopleListSections({
  compact,
  inboxStats,
  isInboxMode,
  selectedSlug,
  suggestedMeetings,
  recentPeople,
  olderPeople,
  olderPeopleExpanded,
  forceShowOlderPeople,
  onInboxSelect,
  onSuggestedSelect,
  onSelectPerson,
  onToggleOlderPeople,
}: {
  compact?: boolean;
  inboxStats?: { totalMeetings: number; lastMeetingTitle: string; lastMeetingDate: string } | null;
  isInboxMode: boolean;
  selectedSlug: string | null;
  suggestedMeetings: SuggestedMeeting[];
  recentPeople: BridgePerson[];
  olderPeople: BridgePerson[];
  olderPeopleExpanded: boolean;
  forceShowOlderPeople: boolean;
  onInboxSelect: () => void;
  onSuggestedSelect: (name: string) => void;
  onSelectPerson: (person: BridgePerson) => void;
  onToggleOlderPeople: () => void;
}) {
  const showOlderPeople = forceShowOlderPeople || olderPeopleExpanded;

  return (
    <>
      <InboxCard compact={compact} selected={isInboxMode} onClick={onInboxSelect} stats={inboxStats} />
      <GranolaSyncControl compact={compact} />

      {suggestedMeetings.length > 0 && (
        <>
          <ListSectionDivider compact={compact} label="Suggested" />
          {suggestedMeetings.map((meeting) => (
            <SuggestedMeetingCard
              key={meeting.name}
              meeting={meeting}
              compact={compact}
              selected={selectedSlug === SUGGESTED_PREFIX + encodeURIComponent(meeting.name)}
              onClick={() => onSuggestedSelect(meeting.name)}
            />
          ))}
        </>
      )}

      {recentPeople.length > 0 && (
        <>
          <ListSectionDivider compact={compact} label="Saved" />
          {recentPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              compact={compact}
              selected={person.slug === selectedSlug}
              onClick={onSelectPerson}
            />
          ))}
        </>
      )}

      {olderPeople.length > 0 && (
        <>
          <button
            type="button"
            className={`w-full flex items-center gap-1.5 text-left text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors ${compact ? "pt-1 px-1" : "pt-2 px-1"}`}
            aria-expanded={showOlderPeople}
            onClick={onToggleOlderPeople}
          >
            {showOlderPeople ? (
              <ChevronDown className="w-3 h-3 flex-shrink-0" />
            ) : (
              <ChevronRight className="w-3 h-3 flex-shrink-0" />
            )}
            <span className="flex-1 truncate">Older than {OLDER_PEOPLE_DAYS} days</span>
            <span className="text-[var(--text-tertiary)]">{olderPeople.length}</span>
          </button>
          {showOlderPeople && olderPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              compact={compact}
              selected={person.slug === selectedSlug}
              onClick={onSelectPerson}
            />
          ))}
        </>
      )}
    </>
  );
}

function ListSectionDivider({ compact, label }: { compact?: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-3 ${compact ? "pt-1" : "pt-2"}`}>
      <div className="flex-1 border-t border-[var(--border-default)]" />
      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
        {label}
      </span>
      <div className="flex-1 border-t border-[var(--border-default)]" />
    </div>
  );
}

function formatRelativeDate(isoDate: string): string {
  const now = new Date();
  const date = new Date(isoDate);
  const diffMs = now.getTime() - date.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));

  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months === 1) return "1 month ago";
  return `${months} months ago`;
}

function InboxCard({
  compact,
  selected,
  onClick,
  stats,
}: {
  compact?: boolean;
  selected: boolean;
  onClick: () => void;
  stats?: { totalMeetings: number; lastMeetingTitle: string; lastMeetingDate: string } | null;
}) {
  return (
    <div
      className={`rounded-lg border bg-[var(--content-surface)] ${compact ? "px-2.5 pt-1.5 pb-2" : "px-3 pt-2 pb-2.5"} cursor-pointer transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] ${
        selected
          ? "border-[var(--interactive-default)]"
          : "border-[var(--border-default)]"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          <Inbox className="w-4 h-4 text-[var(--text-tertiary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
            All Meetings
          </div>
        </div>
      </div>
      {stats && (
        <>
          <div className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
            Last: {stats.lastMeetingTitle || "Unknown"}
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            {stats.lastMeetingDate && (
              <span className="text-[11px] text-[var(--text-tertiary)]">
                {formatRelativeDate(stats.lastMeetingDate)}
              </span>
            )}
            <span className="text-[11px] text-[var(--text-tertiary)]">
              {stats.totalMeetings} meeting{stats.totalMeetings !== 1 ? "s" : ""}
            </span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Suggested Meeting Card ───

function SuggestedMeetingCard({
  meeting,
  compact,
  selected,
  onClick,
}: {
  meeting: SuggestedMeeting;
  compact?: boolean;
  selected?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`rounded-lg border border-dashed bg-[var(--content-surface)] ${compact ? "px-2.5 pt-1.5 pb-2" : "px-3 pt-2 pb-2.5"} cursor-pointer transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] ${
        selected
          ? "border-[var(--interactive-default)]"
          : "border-[var(--border-default)]"
      }`}
      onClick={onClick}
    >
      <div className="flex items-center gap-2.5">
        <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
          <Users className="w-4 h-4 text-[var(--text-tertiary)]" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-[var(--text-primary)] truncate leading-tight">
            {meeting.name}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-0.5">
        {meeting.lastDate && (
          <span className="text-[11px] text-[var(--text-tertiary)]">
            {formatRelativeDate(meeting.lastDate)}
          </span>
        )}
        <span className="text-[11px] text-[var(--text-tertiary)]">
          {meeting.count} recording{meeting.count !== 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}
