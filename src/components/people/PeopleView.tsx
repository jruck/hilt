"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useBridgePeople } from "@/hooks/useBridgePeople";
import { usePersonDetail } from "@/hooks/usePersonDetail";
import { useIsMobile } from "@/hooks/useIsMobile";
import { useScope } from "@/contexts/ScopeContext";
import { PersonCard } from "./PersonCard";
import { PersonMeetingList } from "./PersonMeetingList";
import { MeetingEntry } from "./MeetingEntry";
import type { MeetingFilter } from "./PersonMeetingList";
import type { BridgePerson, PersonMeeting } from "@/lib/types";

interface PeopleViewProps {
  searchQuery?: string;
}

export function PeopleView({ searchQuery = "" }: PeopleViewProps) {
  const { data, isLoading } = useBridgePeople();
  const isMobile = useIsMobile();
  const { scopePath, navigateTo } = useScope();

  // Derive selected slug from URL scope: "/amrit" → "amrit"
  const selectedSlug =
    scopePath && scopePath.startsWith("/")
      ? scopePath.slice(1) || null
      : scopePath || null;

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

  // Person detail — fetched here so both middle and right columns share data
  const { data: personDetail, mutate: mutatePersonDetail } = usePersonDetail(selectedSlug);

  // Meeting filter
  const [filter, setFilter] = useState<MeetingFilter>("all");

  const filteredMeetings = useMemo(() => {
    if (!personDetail) return [];
    if (filter === "all") return personDetail.meetings;
    return personDetail.meetings.filter(
      (m) => m.source === (filter === "notes" ? "inline" : "granola")
    );
  }, [personDetail, filter]);

  // Build the synthetic "Next" entry
  const nextEntry = useMemo((): PersonMeeting | null => {
    if (!personDetail) return null;
    const today = new Date().toISOString().slice(0, 10);
    // If the most recent meeting is from today, don't show Next
    if (personDetail.meetings.length > 0 && personDetail.meetings[0].date === today) {
      return null;
    }
    // Show Next if: there's nextRaw content, or last meeting > 1 day ago, or no meetings
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
  }, [personDetail]);

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

  // Auto-select first meeting when person changes or data loads
  useEffect(() => {
    if (displayMeetings.length > 0) {
      setSelectedMeetingIdx(0);
    } else {
      setSelectedMeetingIdx(null);
    }
  }, [selectedSlug, personDetail]); // eslint-disable-line react-hooks/exhaustive-deps

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
    selectedMeetingIdx === 0 &&
    selectedMeeting !== null &&
    (selectedMeeting.source === "next" || selectedMeeting.source === "inline");

  const vaultPath = personDetail?.personFilePath
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
      <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
        <p>{q ? "No matching people" : "No people found"}</p>
      </div>
    );
  }

  // ─── Mobile Layout ─── stacked navigation
  if (isMobile) {
    // Level 3: Meeting content
    if (selectedSlug && mobileShowMeeting && selectedMeeting && personDetail) {
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
              slug={selectedSlug}
              vaultPath={vaultPath}
              autoFocus={shouldAutoFocus}
              onDelete={handleDeleteMeeting}
            />
          </div>
        </div>
      );
    }

    // Level 2: Person meeting list
    if (selectedSlug && personDetail) {
      return (
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 overflow-hidden">
            <PersonMeetingList
              slug={selectedSlug}
              person={personDetail}
              displayMeetings={displayMeetings}
              filter={filter}
              onFilterChange={setFilter}
              selectedMeetingIndex={selectedMeetingIdx}
              onSelectMeeting={handleMobileSelectMeeting}
              vaultPath={vaultPath}
              onClose={handleClose}
            />
          </div>
        </div>
      );
    }

    // Level 1: Person list
    return (
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 py-4 space-y-4">
          {filteredPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              onClick={handleSelect}
            />
          ))}
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
          {filteredPeople.map((person) => (
            <PersonCard
              key={person.slug}
              person={person}
              compact
              selected={person.slug === selectedSlug}
              onClick={handleSelect}
            />
          ))}
        </div>
      </div>

      {/* Middle: Person meeting feed */}
      {selectedSlug && personDetail ? (
        <div className="w-80 flex-shrink-0 border-r border-[var(--border-default)] overflow-hidden">
          <PersonMeetingList
            slug={selectedSlug}
            person={personDetail}
            displayMeetings={displayMeetings}
            filter={filter}
            onFilterChange={setFilter}
            selectedMeetingIndex={selectedMeetingIdx}
            onSelectMeeting={setSelectedMeetingIdx}
            vaultPath={vaultPath}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-[var(--text-tertiary)]">
          <p className="text-sm">Select a person</p>
        </div>
      )}

      {/* Right: Meeting content */}
      {selectedSlug && personDetail && (
        <div className="flex-1 overflow-y-auto">
          {selectedMeeting ? (
            <MeetingEntry
              meeting={selectedMeeting}
              slug={selectedSlug}
              vaultPath={vaultPath}
              autoFocus={shouldAutoFocus}
              onDelete={handleDeleteMeeting}
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
