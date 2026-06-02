import * as crypto from "crypto";
import ICAL from "ical.js";
import { CALENDAR_SOURCE_CONFIGS, type CalendarSourceConfig } from "./config";
import { extractCalendarJoinLinks, htmlToText } from "./links";
import type { CalendarEventInput, CalendarFieldCoverage, CalendarParticipant } from "./types";

interface ParseWindow {
  start: Date;
  end: Date;
}

export interface ParsedCalendarFeed {
  calendarName: string;
  coverage: CalendarFieldCoverage;
  events: CalendarEventInput[];
}

export function parseIcsFeed(source: CalendarSourceConfig, icsText: string, window: ParseWindow): ParsedCalendarFeed {
  const parsed = ICAL.parse(icsText);
  const calendar = new ICAL.Component(parsed);
  const calendarName = stringValue(calendar.getFirstPropertyValue("x-wr-calname")) || stringValue(calendar.getFirstPropertyValue("name")) || source.label;
  const components = calendar.getAllSubcomponents("vevent");
  const baseEvents = components.map((component) => new ICAL.Event(component)).filter((event) => !event.isRecurrenceException());
  const events: CalendarEventInput[] = [];

  for (const event of baseEvents) {
    events.push(...expandEvent(source, event, window));
  }

  return {
    calendarName,
    coverage: summarizeFeed(components, events),
    events: ensureUniqueEventIds(events),
  };
}

function ensureUniqueEventIds(events: CalendarEventInput[]): CalendarEventInput[] {
  const seen = new Map<string, number>();
  return events.map((event) => {
    const count = seen.get(event.id) ?? 0;
    seen.set(event.id, count + 1);
    if (count === 0) return event;
    return {
      ...event,
      id: `${event.id}_${count}`,
    };
  });
}

function expandEvent(source: CalendarSourceConfig, event: ICAL.Event, window: ParseWindow): CalendarEventInput[] {
  if (event.isRecurring()) {
    return expandRecurringEvent(source, event, window);
  }
  const input = eventToInput(source, event, null, event.startDate, event.endDate);
  return eventAllowedForSource(source, input) && eventIntersectsWindow(input, window) ? [input] : [];
}

function expandRecurringEvent(source: CalendarSourceConfig, event: ICAL.Event, window: ParseWindow): CalendarEventInput[] {
  const inputs: CalendarEventInput[] = [];
  const iterator = event.iterator();
  let occurrence: ICAL.Time | null;
  let guard = 0;
  while ((occurrence = iterator.next())) {
    if (guard++ > 20000) break;
    const details = event.getOccurrenceDetails(occurrence);
    const input = eventToInput(source, details.item, occurrence.toICALString(), details.startDate, details.endDate);
    if (input.sortStart > window.end.getTime()) break;
    if (eventAllowedForSource(source, input) && eventIntersectsWindow(input, window)) inputs.push(input);
  }
  return inputs;
}

function eventAllowedForSource(source: CalendarSourceConfig, event: CalendarEventInput): boolean {
  if (source.id !== "us-holidays") return true;
  return event.allDay && /\bpublic holiday\b/i.test(event.description || "");
}

function eventToInput(
  source: CalendarSourceConfig,
  event: ICAL.Event,
  recurrenceId: string | null,
  start: ICAL.Time,
  end: ICAL.Time,
): CalendarEventInput {
  const component = event.component;
  const summary = eventTitle(event);
  const description = mergedDescription(component, event);
  const location = normalizeText(stringValue(component.getFirstPropertyValue("location")) || event.location);
  const url = normalizeText(stringValue(component.getFirstPropertyValue("url")));
  const uid = event.uid || stringValue(component.getFirstPropertyValue("uid"));
  const status = normalizeText(stringValue(component.getFirstPropertyValue("status")));
  const attendees = component.getAllProperties("attendee").map(participantFromProperty).filter(Boolean) as CalendarParticipant[];
  const organizer = organizerFromComponent(component, event);
  const rules = component.getAllProperties("rrule").map((property) => String(property.getFirstValue())).filter(Boolean);
  const joinLinks = extractCalendarJoinLinks({ description, location, url });
  const allDay = Boolean(start.isDate);
  const startValue = timeToStorage(start);
  const endValue = timeToStorage(end);
  const sortStart = timeToSort(start);
  const sortEnd = Math.max(timeToSort(end), sortStart + (allDay ? 86_400_000 : 60_000));
  const calendarId = `${source.id}:primary`;
  const dedupeKey = buildDedupeKey(uid, summary, startValue, endValue);
  const sourceKey = `${source.id}:${uid || summary}:${recurrenceId || start.toICALString()}:${end.toICALString()}`;

  return {
    id: `cal_${shortHash(sourceKey)}`,
    sourceId: source.id,
    calendarId,
    uid,
    recurrenceId,
    dedupeKey,
    title: summary,
    start: startValue,
    end: endValue,
    sortStart,
    sortEnd,
    allDay,
    description,
    location,
    joinLinks,
    attendees,
    organizer,
    recurrence: {
      recurring: event.isRecurring(),
      recurrenceId,
      rules,
    },
    status,
    providerUrl: url || joinLinks[0]?.url || null,
    raw: {
      uid,
      sourceId: source.id,
      recurrenceId,
      status,
      hasDescription: Boolean(description),
      hasLocation: Boolean(location),
      attendeeCount: attendees.length,
      organizer: organizer?.email || organizer?.name || null,
    },
  };
}

function eventTitle(event: ICAL.Event): string {
  return normalizeText(stringValue(event.component.getFirstPropertyValue("summary")) || event.summary) || "Untitled event";
}

function summarizeFeed(components: ICAL.Component[], events: CalendarEventInput[]): CalendarFieldCoverage {
  const uniqueUids = new Set<string>();
  const dates = events.map((event) => event.start).sort();
  const countProp = (name: string) => components.filter((component) => Boolean(component.getFirstPropertyValue(name))).length;
  const recurring = components.filter((component) => component.hasProperty("rrule") || component.hasProperty("rdate") || component.hasProperty("recurrence-id")).length;
  const cancelled = components.filter((component) => String(component.getFirstPropertyValue("status") || "").toUpperCase() === "CANCELLED").length;
  for (const component of components) {
    const uid = stringValue(component.getFirstPropertyValue("uid"));
    if (uid) uniqueUids.add(uid);
  }
  const meetingLinks = {
    teams: events.filter((event) => event.joinLinks.some((link) => link.kind === "teams")).length,
    google_meet: events.filter((event) => event.joinLinks.some((link) => link.kind === "meet")).length,
    zoom: events.filter((event) => event.joinLinks.some((link) => link.kind === "zoom")).length,
    generic_web: events.filter((event) => event.joinLinks.length > 0).length,
  };
  return {
    event_count: events.length,
    unique_uid_count: uniqueUids.size,
    with_summary: countProp("summary"),
    with_description: components.filter((component) => Boolean(component.getFirstPropertyValue("description") || component.getFirstPropertyValue("x-alt-desc"))).length,
    with_location: countProp("location"),
    with_url: countProp("url"),
    with_organizer: countProp("organizer"),
    with_attendee: components.filter((component) => component.getAllProperties("attendee").length > 0).length,
    recurring,
    cancelled,
    likely_meeting_links: meetingLinks,
    date_span: {
      first: dates[0] || null,
      last: dates[dates.length - 1] || null,
    },
  };
}

function mergedDescription(component: ICAL.Component, event: ICAL.Event): string | null {
  const text = normalizeText(stringValue(component.getFirstPropertyValue("description")) || event.description);
  const html = htmlToText(stringValue(component.getFirstPropertyValue("x-alt-desc")));
  if (text && html && !text.includes(html)) return `${text}\n\n${html}`.trim();
  return text || html;
}

function organizerFromComponent(component: ICAL.Component, event: ICAL.Event): CalendarParticipant | null {
  const property = component.getFirstProperty("organizer");
  const raw = stringValue(property?.getFirstValue()) || event.organizer;
  if (!raw && !property) return null;
  return {
    name: normalizeText(property?.getFirstParameter("cn")) || null,
    email: emailFromCalendarUri(raw),
  };
}

function participantFromProperty(property: ICAL.Property): CalendarParticipant | null {
  const raw = stringValue(property.getFirstValue());
  const name = normalizeText(property.getFirstParameter("cn"));
  const email = emailFromCalendarUri(raw);
  if (!name && !email) return null;
  return {
    name: name || email,
    email,
    responseStatus: normalizeText(property.getFirstParameter("partstat"))?.toLowerCase() || null,
  };
}

function buildDedupeKey(uid: string | null, title: string, start: string, end: string): string {
  if (uid) return `uid:${uid.toLowerCase()}:${start}`;
  return `shape:${normalizeForKey(title)}:${start}:${end}`;
}

function eventIntersectsWindow(event: CalendarEventInput, window: ParseWindow): boolean {
  return event.sortEnd >= window.start.getTime() && event.sortStart <= window.end.getTime();
}

function timeToStorage(time: ICAL.Time): string {
  if (time.isDate) return `${time.year}-${pad(time.month)}-${pad(time.day)}`;
  return time.toJSDate().toISOString();
}

function timeToSort(time: ICAL.Time): number {
  if (time.isDate) {
    return new Date(time.year, time.month - 1, time.day).getTime();
  }
  return time.toJSDate().getTime();
}

function normalizeText(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/[ \t]+\n/g, "\n").trim();
  return normalized || null;
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return null;
  return String(value);
}

function emailFromCalendarUri(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const mailto = trimmed.match(/^mailto:(.+)$/i);
  return (mailto ? mailto[1] : trimmed).toLowerCase() || null;
}

function normalizeForKey(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").replace(/[^\w\s:-]/g, "").trim();
}

function shortHash(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 18);
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

export function sourcePriority(sourceId: string): number {
  return CALENDAR_SOURCE_CONFIGS.find((source) => source.id === sourceId)?.priority ?? 99;
}
