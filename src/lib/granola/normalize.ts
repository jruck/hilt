import type {
  GranolaCalendarEvent,
  GranolaDocument,
  GranolaPerson,
  GranolaTranscriptEntry,
} from "./types";

export function normalizeGranolaDocument(raw: Record<string, unknown>, transcriptRaw: unknown = []): GranolaDocument {
  const id = stringValue(raw.id) || stringValue(raw.document_id) || "";
  if (!id) throw new Error("Granola document is missing id");

  const title = stringValue(raw.title) || stringValue(raw.name) || "Untitled";
  const people = normalizePeople(raw);
  const calendarEvent = normalizeCalendarEvent(raw);
  const attendees = mergePeople(people, calendarEvent?.attendees ?? []);

  return {
    id,
    title,
    createdAt: stringValue(raw.created_at) || stringValue(raw.createdAt),
    updatedAt: stringValue(raw.updated_at) || stringValue(raw.updatedAt),
    granolaUrl: stringValue(raw.web_url) || stringValue(raw.url) || `https://app.granola.ai/d/${id}`,
    attendees,
    folders: normalizeFolders(raw),
    notesMarkdown: stringValue(raw.notes_markdown),
    panelContent: valuePath(raw, ["last_viewed_panel", "content"]) ?? raw.notes ?? null,
    privateNotesMarkdown: stringValue(raw.notes_markdown),
    calendarEvent,
    transcript: normalizeTranscript(transcriptRaw),
    raw,
  };
}

export function normalizeGranolaDocuments(payload: unknown): GranolaDocument[] {
  const docs = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { docs?: unknown[] })?.docs)
      ? (payload as { docs: unknown[] }).docs
      : [];
  return docs
    .filter((doc): doc is Record<string, unknown> => Boolean(doc) && typeof doc === "object" && !Array.isArray(doc))
    .map((doc) => normalizeGranolaDocument(doc));
}

export function normalizeCalendarEvent(raw: Record<string, unknown>): GranolaCalendarEvent | null {
  const candidate =
    objectValue(raw.google_calendar_event) ||
    objectValue(raw.calendar_event) ||
    objectValue(raw.calendarEvent) ||
    objectValue(valuePath(raw, ["metadata", "calendar_event"])) ||
    objectValue(valuePath(raw, ["calendar", "event"]));

  if (!candidate) return null;

  const startValue = objectValue(candidate.start);
  const endValue = objectValue(candidate.end);
  const start = stringValue(startValue?.dateTime) || stringValue(startValue?.date) || stringValue(candidate.start) || stringValue(candidate.scheduled_start_time);
  const end = stringValue(endValue?.dateTime) || stringValue(endValue?.date) || stringValue(candidate.end) || stringValue(candidate.scheduled_end_time);
  const organizer = normalizePerson(candidate.organizer) || normalizePerson(candidate.organiser);

  return {
    id: stringValue(candidate.id) || stringValue(candidate.calendar_event_id) || stringValue(candidate.event_id),
    iCalUID: stringValue(candidate.iCalUID) || stringValue(candidate.ical_uid) || stringValue(candidate.iCalUid) || stringValue(candidate.uid),
    calendarId: stringValue(candidate.calendarId) || stringValue(candidate.calendar_id),
    title: stringValue(candidate.summary) || stringValue(candidate.event_title) || stringValue(candidate.title),
    start,
    end,
    htmlLink: stringValue(candidate.htmlLink) || stringValue(candidate.html_link) || stringValue(candidate.url),
    organizer,
    attendees: normalizeCalendarAttendees(candidate.attendees ?? candidate.invitees),
    raw: candidate,
  };
}

function normalizePeople(raw: Record<string, unknown>): GranolaPerson[] {
  const fromPeople = valuePath(raw, ["people", "attendees"]);
  const fromAttendees = raw.attendees;
  return mergePeople(normalizeCalendarAttendees(fromPeople), normalizeCalendarAttendees(fromAttendees));
}

function normalizeCalendarAttendees(value: unknown): GranolaPerson[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizePerson).filter((person): person is GranolaPerson => Boolean(person));
}

function normalizePerson(value: unknown): GranolaPerson | null {
  if (!value) return null;
  if (typeof value === "string") return { name: value, email: null };
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const email = stringValue(record.email) || stringValue(record.mail) || null;
  const name = stringValue(record.name) || stringValue(record.displayName) || email || "";
  if (!name && !email) return null;
  return { name: name || email || "", email };
}

function normalizeFolders(raw: Record<string, unknown>): string[] {
  const values = [
    raw.folders,
    raw.folder_paths,
    raw.folderNames,
    raw.document_lists,
    raw._hilt_folders,
  ];
  const folders = new Set<string>();
  for (const value of values) {
    if (!Array.isArray(value)) continue;
    for (const item of value) {
      if (typeof item === "string" && item.trim()) folders.add(item.trim());
      else if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        const name = stringValue(record.title) || stringValue(record.name) || stringValue(record.path);
        if (name) folders.add(name);
      }
    }
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b));
}

function normalizeTranscript(raw: unknown): GranolaTranscriptEntry[] {
  const entries = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { transcript?: unknown[] })?.transcript)
      ? (raw as { transcript: unknown[] }).transcript
      : [];

  return entries
    .filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry))
    .map((entry) => ({
      source: stringValue(entry.source) || stringValue(entry.speaker_source) || "",
      text: stringValue(entry.text) || stringValue(entry.content) || "",
      startTimestamp: stringValue(entry.start_timestamp) || stringValue(entry.startTimestamp) || stringValue(entry.start),
      endTimestamp: stringValue(entry.end_timestamp) || stringValue(entry.endTimestamp) || stringValue(entry.end),
      speaker: stringValue(entry.speaker) || stringValue(entry.speaker_name),
      raw: entry,
    }))
    .filter((entry) => entry.text.trim());
}

function mergePeople(...groups: GranolaPerson[][]): GranolaPerson[] {
  const byKey = new Map<string, GranolaPerson>();
  for (const group of groups) {
    for (const person of group) {
      const key = (person.email || person.name).trim().toLowerCase();
      if (key && !byKey.has(key)) byKey.set(key, person);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.name.localeCompare(b.name));
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function valuePath(root: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = root;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return null;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
