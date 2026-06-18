import type { PersonCalendarCandidate } from "../types";

export type CalendarSourceId = "personal" | "priceless" | "evercommerce" | string;

export interface CalendarParticipant {
  name: string | null;
  email: string | null;
  responseStatus?: string | null;
}

export interface CalendarJoinLink {
  kind: "teams" | "meet" | "zoom" | "web";
  url: string;
  label: string;
}

export interface CalendarResourceLink {
  kind: "doc" | "sheet" | "slide" | "office" | "sharepoint" | "web";
  url: string;
  label: string;
}

export interface CalendarEventNoteTarget {
  kind: "person-next";
  slug: string;
  name: string;
  personType: "person" | "group";
  candidate: PersonCalendarCandidate;
  confidence: number;
  historicalCount: number;
  lastSeenAt: string | null;
  reason: string;
}

export interface CalendarFieldCoverage {
  event_count: number;
  unique_uid_count: number;
  with_summary: number;
  with_description: number;
  with_location: number;
  with_url: number;
  with_organizer: number;
  with_attendee: number;
  recurring: number;
  cancelled: number;
  likely_meeting_links: {
    teams: number;
    google_meet: number;
    zoom: number;
    generic_web: number;
  };
  date_span: {
    first: string | null;
    last: string | null;
  };
}

export interface CalendarSource {
  id: CalendarSourceId;
  label: string;
  providerHint: "google" | "outlook" | "fixture" | "ics";
  accountHint: string;
  readOnly: boolean;
  configured: boolean;
  urlConfigured: boolean;
  color: string;
  lastSyncAt: string | null;
  lastError: string | null;
  lastFetchMs: number | null;
  lastEventCount: number;
  coverage: CalendarFieldCoverage | null;
}

export interface CalendarDefinition {
  id: string;
  sourceId: CalendarSourceId;
  name: string;
  color: string;
  selected: boolean;
  readOnly: boolean;
}

export interface CalendarHealth {
  sources: CalendarSource[];
  calendars: CalendarDefinition[];
  stale: boolean;
  generatedAt: string;
}

export interface CalendarEvent {
  id: string;
  sourceIds: CalendarSourceId[];
  calendarId: string;
  sourceId: CalendarSourceId;
  uid: string | null;
  title: string;
  start: string;
  end: string;
  sortStart: number;
  sortEnd: number;
  allDay: boolean;
  description: string | null;
  location: string | null;
  joinLinks: CalendarJoinLink[];
  resourceLinks: CalendarResourceLink[];
  attendees: CalendarParticipant[];
  organizer: CalendarParticipant | null;
  recurrence: {
    recurring: boolean;
    recurrenceId: string | null;
    rules: string[];
  };
  status: string | null;
  providerUrl: string | null;
  readOnly: boolean;
  duplicateSourceCount: number;
  meetingNotes?: Array<{
    granolaId: string;
    title: string;
    notePath: string | null;
    transcriptPath: string | null;
    granolaUrl: string | null;
    meetingEndCount: number | null;
    calendarMatchMethod: string | null;
    calendarMatchConfidence: number | null;
  }>;
  noteTargets?: CalendarEventNoteTarget[];
}

export interface CalendarSyncSourceResult {
  sourceId: string;
  label: string;
  configured: boolean;
  ok: boolean;
  fetched: number;
  stored: number;
  hiddenDuplicates: number;
  error: string | null;
  coverage: CalendarFieldCoverage | null;
  fetchMs: number | null;
}

export interface CalendarSyncReport {
  startedAt: string;
  finishedAt: string;
  sources: CalendarSyncSourceResult[];
  visibleEvents: number;
  hiddenDuplicates: number;
}

export interface CalendarEventInput {
  id: string;
  sourceId: string;
  calendarId: string;
  uid: string | null;
  recurrenceId: string | null;
  dedupeKey: string;
  title: string;
  start: string;
  end: string;
  sortStart: number;
  sortEnd: number;
  allDay: boolean;
  description: string | null;
  location: string | null;
  joinLinks: CalendarJoinLink[];
  resourceLinks?: CalendarResourceLink[];
  attendees: CalendarParticipant[];
  organizer: CalendarParticipant | null;
  recurrence: CalendarEvent["recurrence"];
  status: string | null;
  providerUrl: string | null;
  raw: Record<string, unknown>;
}
