"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Inbox, Loader2, Users } from "lucide-react";
import { useBridgePeople } from "@/hooks/useBridgePeople";
import { usePersonDetail } from "@/hooks/usePersonDetail";
import { useInboxMeetings } from "@/hooks/useInboxMeetings";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScope } from "@/contexts/ScopeContext";
import { PersonCard } from "./PersonCard";
import { PersonMeetingList } from "./PersonMeetingList";
import { MeetingEntry } from "./MeetingEntry";
import type { MeetingFilter } from "./PersonMeetingList";
import type { BridgePerson, PersonMeeting, SuggestedMeeting } from "@/lib/types";

const INBOX_SLUG = "__inbox__";

interface PeopleViewProps {
  searchQuery?: string;
}

export function PeopleView({ searchQuery = "" }: PeopleViewProps) {
  const { data, isLoading } = useBridgePeople();
  const isMobile = useIsMobile();
  const { scopePath, navigateTo } = useScope();

  // Derive selected slug from URL scope: "/amrit" → "amrit", "/__inbox__" → "__inbox__"
  const selectedSlug =
    scopePath && scopePath.startsWith("/")
      ? scopePath.slice(1) || null
      : scopePath || null;

  const isInboxMode = selectedSlug === INBOX_SLUG;
  const personSlug = isInboxMode ? null : selectedSlug;

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

  // Person detail — fetched when a person (not inbox) is selected
  const { data: personDetail, mutate: mutatePersonDetail } = usePersonDetail(personSlug);

  // Inbox data — fetched when inbox is selected
  const { data: inboxData } = useInboxMeetings(isInboxMode);

  // Meeting filter
  const [filter, setFilter] = useState<MeetingFilter>("all");

  const filteredMeetings = useMemo(() => {
    if (isInboxMode) return inboxData?.meetings ?? [];
    if (!personDetail) return [];
    if (filter === "all") return personDetail.meetings;
    return personDetail.meetings.filter(
      (m) => m.source === (filter === "notes" ? "inline" : "granola")
    );
  }, [isInboxMode, inboxData, personDetail, filter]);

  // Build the synthetic "Next" entry (person mode only)
  const nextEntry = useMemo((): PersonMeeting | null => {
    if (isInboxMode || !personDetail) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (personDetail.meetings.length > 0 && personDetail.meetings[0].date === today) {
      return null;
    }
    const hasContent = !!personDetail.nextRaw;
    const lastDate = personDetail.lastMeetingDate;
    const stale = !lastDate || lastDate < today;
    if (!hasContent && !stale) return null;

    return {
      source: "next",
      date: "",
      title: "Next",
      notes: personDetail.nextRaw,
    };
  }, [isInboxMode, personDetail]);

  // Display meetings: Next pinned at top + filtered historical meetings
  const displayMeetings = useMemo(() => {
    const list: PersonMeeting[] = [];
    if (nextEntry) list.push(nextEntry);
    list.push(...filteredMeetings);
    return list;
  }, [nextEntry, filteredMeetings]);

  // Meeting selection — index into displayMeetings
  const [selectedMeetingIdx, setSelectedMeetingIdx] = useState<number | null>(
    null
  );

  // Auto-select first meeting when person/inbox changes or data loads
  useEffect(() => {
    if (displayMeetings.length > 0) {
      setSelectedMeetingIdx(0);
    } else {
      setSelectedMeetingIdx(null);
    }
  }, [selectedSlug, personDetail, inboxData]); // eslint-disable-line react-hooks/exhaustive-deps

  // Clamp selection when filter changes
  useEffect(() => {
    if (selectedMeetingIdx !== null && selectedMeetingIdx >= displayMeetings.length) {
      setSelectedMeetingIdx(displayMeetings.length > 0 ? 0 : null);
    }
  }, [displayMeetings.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset filter when person changes
  useEffect(() => {
    setFilter("all");
  }, [selectedSlug]);

  const selectedMeeting =
    selectedMeetingIdx !== null ? displayMeetings[selectedMeetingIdx] ?? null : null;

  // Auto-focus the editor when the topmost meeting is selected and is editable
  const shouldAutoFocus =
    !isInboxMode &&
    selectedMeetingIdx === 0 &&
    selectedMeeting !== null &&
    (selectedMeeting.source === "next" || selectedMeeting.source === "inline");

  const vaultPath = isInboxMode
    ? inboxData?.vaultPath
    : personDetail?.personFilePath
      ? personDetail.personFilePath.replace(/\/people\/[^/]+$/, "")
      : undefined;

  const handleDeleteMeeting = useCallback(() => {
    mutatePersonDetail();
    setSelectedMeetingIdx(displayMeetings.length > 1 ? 0 : null);
  }, [mutatePersonDetail, displayMeetings.length]);

  const handleSelect = useCallback(
    (person: BridgePerson) => {
      if (selectedSlug === person.slug) {
        navigateTo("people", "");
      } else {
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

  const handleClose = useCallback(() => {
    navigateTo("people", "");
  }, [navigateTo]);

  // Mobile: track navigation depth for stacked screens
  const [mobileShowMeeting, setMobileShowMeeting] = useState(false);

  const handleMobileSelectMeeting = useCallback((idx: number) => {
    setSelectedMeetingIdx(idx);
    setMobileShowMeeting(true);
  }, []);

  const handleMobileBackFromMeeting = useCallback(() => {
    setMobileShowMeeting(false);
  }, []);

  // Determine if middle column has data to show
  const hasMiddleContent = isInboxMode
    ? !!inboxData
    : !!(personSlug && personDetail);

  // Loading state
  if (isLoading && !data) {
    return (
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  // Empty state
  if (!data || filteredPeople.length === 0) {
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
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="flex-shrink-0 px-3 py-2 border-b border-[var(--border-default)]">
            <button
              onClick={handleMobileBackFromMeeting}
              className="text-sm text-[var(--text-accent)]"
            >
              &larr; Back
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            <MeetingEntry
              meeting={selectedMeeting}
              slug={isInboxMode ? "" : (personSlug ?? "")}
              vaultPath={vaultPath}
              autoFocus={shouldAutoFocus}
              onDelete={isInboxMode ? undefined : handleDeleteMeeting}
            />
          </div>
        </div>
      );
    }

    // Level 2: Meeting list (person or inbox)
    if (selectedSlug && hasMiddleContent) {
      return (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <PersonMeetingList
              slug={selectedSlug}
              person={isInboxMode ? null : personDetail!}
              displayMeetings={displayMeetings}
              filter={filter}
              onFilterChange={setFilter}
              selectedMeetingIndex={selectedMeetingIdx}
              onSelectMeeting={handleMobileSelectMeeting}
              vaultPath={vaultPath}
              onClose={handleClose}
              inboxMode={isInboxMode}
              totalCount={inboxData?.totalCount}
            />
          </div>
        </div>
      );
    }

    // Level 1: Person list
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4">
          {/* Inbox card */}
          <InboxCard selected={isInboxMode} onClick={handleInboxSelect} stats={data.inboxStats} />
          {/* Saved divider */}
          {filteredPeople.length > 0 && (
            <div className="flex items-center gap-3 pt-2">
              <div className="flex-1 border-t border-[var(--border-default)]" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                Saved
              </span>
              <div className="flex-1 border-t border-[var(--border-default)]" />
            </div>
          )}
          {filteredPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              onClick={handleSelect}
            />
          ))}
          {/* Suggested meetings */}
          {data.suggestedMeetings && data.suggestedMeetings.length > 0 && (
            <>
              <div className="flex items-center gap-3 pt-2">
                <div className="flex-1 border-t border-[var(--border-default)]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Suggested
                </span>
                <div className="flex-1 border-t border-[var(--border-default)]" />
              </div>
              {data.suggestedMeetings.map((sm) => (
                <SuggestedMeetingCard key={sm.name} meeting={sm} onClick={handleInboxSelect} />
              ))}
            </>
          )}
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
          {/* Inbox card */}
          <InboxCard compact selected={isInboxMode} onClick={handleInboxSelect} stats={data.inboxStats} />
          {/* Saved divider */}
          {filteredPeople.length > 0 && (
            <div className="flex items-center gap-3 pt-1">
              <div className="flex-1 border-t border-[var(--border-default)]" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                Saved
              </span>
              <div className="flex-1 border-t border-[var(--border-default)]" />
            </div>
          )}
          {filteredPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              compact
              selected={person.slug === selectedSlug}
              onClick={handleSelect}
            />
          ))}
          {/* Suggested meetings */}
          {data.suggestedMeetings && data.suggestedMeetings.length > 0 && (
            <>
              <div className="flex items-center gap-3 pt-1">
                <div className="flex-1 border-t border-[var(--border-default)]" />
                <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">
                  Suggested
                </span>
                <div className="flex-1 border-t border-[var(--border-default)]" />
              </div>
              {data.suggestedMeetings.map((sm) => (
                <SuggestedMeetingCard key={sm.name} meeting={sm} compact onClick={handleInboxSelect} />
              ))}
            </>
          )}
        </div>
      </div>

      {/* Middle: Meeting feed */}
      {hasMiddleContent ? (
        <div className="w-80 flex-shrink-0 border-r border-[var(--border-default)] overflow-hidden">
          <PersonMeetingList
            slug={selectedSlug!}
            person={isInboxMode ? null : personDetail!}
            displayMeetings={displayMeetings}
            filter={filter}
            onFilterChange={setFilter}
            selectedMeetingIndex={selectedMeetingIdx}
            onSelectMeeting={setSelectedMeetingIdx}
            vaultPath={vaultPath}
            inboxMode={isInboxMode}
            totalCount={inboxData?.totalCount}
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
              slug={isInboxMode ? "" : (personSlug ?? "")}
              vaultPath={vaultPath}
              autoFocus={shouldAutoFocus}
              onDelete={isInboxMode ? undefined : handleDeleteMeeting}
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
      className={`rounded-lg border bg-[var(--bg-secondary)] ${compact ? "px-2.5 pt-1.5 pb-3" : "px-3 pt-2 pb-3.5"} cursor-pointer transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] ${
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
          <div className="text-xs text-[var(--text-secondary)] mt-1 truncate">
            Last: {stats.lastMeetingTitle || "Unknown"}
          </div>
          <div className="flex items-center gap-3 mt-1.5">
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
  onClick,
}: {
  meeting: SuggestedMeeting;
  compact?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`rounded-lg border border-dashed bg-[var(--bg-secondary)] ${compact ? "px-2.5 pt-1.5 pb-3" : "px-3 pt-2 pb-3.5"} cursor-pointer transition-all duration-150 ease-out hover:shadow-sm hover:border-[var(--border-hover)] border-[var(--border-default)]`}
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
      <div className="flex items-center gap-3 mt-1.5">
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
