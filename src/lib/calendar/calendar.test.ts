import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { NextRequest } from "next/server";
import { CALENDAR_SOURCE_CONFIGS } from "./config";
import { CALENDAR_FIXTURE_ICS } from "./fixtures";
import { parseIcsFeed } from "./ics";
import { extractCalendarJoinLinks, extractJoinLinks } from "./links";
import { closeCalendarDbForTests, listCalendarSources, listCalendars, queryCalendarAvailabilityBlocks, queryCalendarEvents, queryCalendarHolidayEvents, replaceSourceEvents, upsertCalendar } from "./db";
import { calendarSetupStatus, syncCalendarSources } from "./sync";

const envKeys = [
  "DATA_DIR",
  "HILT_CALENDAR_DB_PATH",
  "HILT_CALENDAR_FIXTURE_MODE",
  "HILT_CALENDAR_SYNC_PAST_DAYS",
  "HILT_CALENDAR_SYNC_FUTURE_DAYS",
  "HILT_CALENDAR_ICS_PERSONAL_URL",
  "HILT_CALENDAR_ICS_PRICELESS_URL",
  "HILT_CALENDAR_ICS_EVERCOMMERCE_URL",
  "HILT_CALENDAR_ICS_US_HOLIDAYS_URL",
] as const;

const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  closeCalendarDbForTests();
  for (const key of envKeys) {
    const value = originalEnv[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

async function withTempCalendar(run: () => void | Promise<void>, fixtureMode = true) {
  const dir = mkdtempSync(join(tmpdir(), "hilt-calendar-test-"));
  closeCalendarDbForTests();
  process.env.DATA_DIR = dir;
  process.env.HILT_CALENDAR_DB_PATH = join(dir, "calendar.sqlite");
  process.env.HILT_CALENDAR_SYNC_PAST_DAYS = "30";
  process.env.HILT_CALENDAR_SYNC_FUTURE_DAYS = "90";
  if (fixtureMode) process.env.HILT_CALENDAR_FIXTURE_MODE = "1";
  else delete process.env.HILT_CALENDAR_FIXTURE_MODE;
  try {
    await run();
  } finally {
    closeCalendarDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("calendar ICS parsing", () => {
  test("expands recurring events and extracts meeting links", () => {
    const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
    const parsed = parseIcsFeed(source, CALENDAR_FIXTURE_ICS.evercommerce, {
      start: new Date("2026-05-28T00:00:00.000Z"),
      end: new Date("2026-07-15T23:59:59.999Z"),
    });

    assert.equal(parsed.calendarName, "EverCommerce Fixture");
    assert.equal(parsed.events.filter((event) => event.title === "Platform standup").length, 6);
    assert.equal(parsed.events.some((event) => event.joinLinks.some((link) => link.kind === "teams")), true);
    assert.equal(parsed.events.some((event) => event.joinLinks.some((link) => link.kind === "zoom")), true);
    assert.equal(parsed.coverage.recurring, 1);
  });

  test("normalizes attendees, organizer, all-day events, and links", () => {
    const priceless = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "priceless")!;
    const personal = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "personal")!;
    const window = {
      start: new Date("2026-05-28T00:00:00.000Z"),
      end: new Date("2026-06-03T23:59:59.999Z"),
    };

    const clientReview = parseIcsFeed(priceless, CALENDAR_FIXTURE_ICS.priceless, window).events[0];
    const focusDay = parseIcsFeed(personal, CALENDAR_FIXTURE_ICS.personal, window).events.find((event) => event.title === "Focus day")!;

    assert.equal(clientReview.organizer?.email, "justin@pricelessmisc.com");
    assert.equal(clientReview.attendees[0].responseStatus, "accepted");
    assert.equal(clientReview.joinLinks[0].kind, "meet");
    assert.equal(focusDay.allDay, true);
    assert.equal(focusDay.start, "2026-05-31");
  });

  test("applies recurrence exceptions", () => {
    const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
    const parsed = parseIcsFeed(source, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:recurrence-exception@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T130000Z
DTEND:20260529T140000Z
RRULE:FREQ=DAILY;COUNT=2
SUMMARY:Base event
END:VEVENT
BEGIN:VEVENT
UID:recurrence-exception@example.com
RECURRENCE-ID:20260530T130000Z
DTSTAMP:20260520T120000Z
DTSTART:20260530T150000Z
DTEND:20260530T160000Z
SUMMARY:Moved event
END:VEVENT
END:VCALENDAR`, {
      start: new Date("2026-05-29T00:00:00.000Z"),
      end: new Date("2026-05-31T00:00:00.000Z"),
    });

    assert.deepEqual(parsed.events.map((event) => [event.title, event.start]), [
      ["Base event", "2026-05-29T13:00:00.000Z"],
      ["Moved event", "2026-05-30T15:00:00.000Z"],
    ]);
  });

  test("keeps punctuation-only blocker titles during parsing", () => {
    const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "personal")!;
    const parsed = parseIcsFeed(source, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:blocker-bang@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T130000Z
DTEND:20260529T140000Z
SUMMARY:!
END:VEVENT
BEGIN:VEVENT
UID:blocker-dash@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T150000Z
DTEND:20260529T160000Z
SUMMARY: -
END:VEVENT
BEGIN:VEVENT
UID:visible-dash-title@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T170000Z
DTEND:20260529T180000Z
SUMMARY:Project - planning
END:VEVENT
END:VCALENDAR`, {
      start: new Date("2026-05-29T00:00:00.000Z"),
      end: new Date("2026-05-30T00:00:00.000Z"),
    });

    assert.deepEqual(parsed.events.map((event) => event.title), ["!", "-", "Project - planning"]);
  });

  test("rejects malformed feeds", () => {
    const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
    assert.throws(() => parseIcsFeed(source, "not a calendar", {
      start: new Date("2026-05-29T00:00:00.000Z"),
      end: new Date("2026-05-31T00:00:00.000Z"),
    }));
  });

  test("classifies common meeting URLs", () => {
    const links = extractJoinLinks(
      "https://teams.microsoft.com/l/meetup-join/example",
      "https://meet.google.com/abc-defg-hij",
      "https://zoom.us/j/123",
    );

    assert.deepEqual(links.map((link) => link.kind), ["teams", "meet", "zoom"]);
    assert.deepEqual(extractJoinLinks("https://example.com/room").map((link) => link.kind), ["web"]);
  });

  test("deduplicates equivalent meeting URLs and keeps the richest join link", () => {
    const links = extractJoinLinks(
      "Join https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0",
      "Join with context https://teams.microsoft.com/l/meetup-join/19%3ameeting_ABC%40thread.v2/0?context=%7B%22Tid%22%3A%22tenant%22%7D",
      "Safe link https://nam12.safelinks.protection.outlook.com/?url=https%3A%2F%2Fteams.microsoft.com%2Fl%2Fmeetup-join%2F19%253ameeting_ABC%2540thread.v2%2F0%3Fcontext%3D%257B%2522Tid%2522%253A%2522tenant%2522%257D&data=ignored",
      "Launcher https://teams.microsoft.com/dl/launcher/launcher.html?url=%2F_%23%2Fl%2Fmeetup-join%2F19%253ameeting_ABC%2540thread.v2%2F0%3Fcontext%3D%257B%2522Tid%2522%253A%2522tenant%2522%257D&type=meetup-join",
      "Meeting options https://teams.microsoft.com/meetingOptions/?threadId=19%3ameeting_ABC%40thread.v2",
    );

    assert.equal(links.length, 1);
    assert.equal(links[0].kind, "teams");
    assert.match(links[0].url, /context=/);
  });

  test("deduplicates Zoom and Google Meet variants and suppresses generic web noise", () => {
    const links = extractJoinLinks(
      "https://zoom.us/j/123456789",
      "https://zoom.us/j/123456789?pwd=secret",
      "https://meet.google.com/abc-defg-hij",
      "https://meet.google.com/abcdefghij",
      "https://example.com/room",
      "https://example.com/room",
      "https://example.com/agenda",
    );

    assert.deepEqual(links.map((link) => link.kind), ["zoom", "meet"]);
    assert.match(links[0].url, /pwd=secret/);
  });

  test("keeps distinct generic web links when no provider meeting link is present", () => {
    const links = extractJoinLinks(
      "https://example.com/room",
      "https://example.com/room",
      "https://example.com/agenda",
    );

    assert.deepEqual(links.map((link) => link.kind), ["web", "web"]);
    assert.deepEqual(links.map((link) => link.url), ["https://example.com/room", "https://example.com/agenda"]);
  });

  test("prefers location meeting links over noisy description links", () => {
    const links = extractCalendarJoinLinks({
      location: "Microsoft Teams Meeting https://teams.microsoft.com/l/meetup-join/19%3ameeting_PRIMARY%40thread.v2/0?context=%7B%22Tid%22%3A%22tenant%22%7D",
      description: [
        "Join the meeting now https://teams.microsoft.com/l/meetup-join/19%3ameeting_DESCRIPTION%40thread.v2/0",
        "Meeting options https://teams.microsoft.com/meetingOptions/?threadId=19%3ameeting_DESCRIPTION%40thread.v2",
        "Microsoft Teams Need help? https://aka.ms/JoinTeamsMeeting",
        "Agenda https://example.com/agenda",
        "Duplicate https://teams.microsoft.com/l/meetup-join/19%3ameeting_PRIMARY%40thread.v2/0",
      ].join("\n"),
    });

    assert.equal(links.length, 1);
    assert.equal(links[0].kind, "teams");
    assert.match(links[0].url, /meeting_PRIMARY/);
  });

  test("keeps only public holidays from the US holidays source", () => {
    const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "us-holidays")!;
    const parsed = parseIcsFeed(source, CALENDAR_FIXTURE_ICS["us-holidays"], {
      start: new Date("2026-05-24T00:00:00.000Z"),
      end: new Date("2026-05-30T23:59:59.999Z"),
    });

    assert.deepEqual(parsed.events.map((event) => event.title), ["Memorial Day"]);
    assert.equal(parsed.events[0].allDay, true);
  });
});

describe("calendar setup, storage, and APIs", () => {
  test("reports missing configuration without exposing feed values", async () => {
    await withTempCalendar(() => {
      delete process.env.HILT_CALENDAR_ICS_PERSONAL_URL;
      delete process.env.HILT_CALENDAR_ICS_PRICELESS_URL;
      delete process.env.HILT_CALENDAR_ICS_EVERCOMMERCE_URL;
      delete process.env.HILT_CALENDAR_ICS_US_HOLIDAYS_URL;

      const status = calendarSetupStatus();
      assert.equal(status.configured, false);
      assert.equal(status.sources.filter((source) => source.id !== "us-holidays").every((source) => !source.urlConfigured && !source.configured), true);
      assert.equal(status.sources.find((source) => source.id === "us-holidays")?.configured, true);
      assert.equal(JSON.stringify(status).includes("http"), false);
    }, false);
  });

  test("syncs fixture sources idempotently and preserves duplicate provenance", async () => {
    await withTempCalendar(async () => {
      const first = await syncCalendarSources();
      const second = await syncCalendarSources();
      assert.equal(first.sources.every((source) => source.ok), true);
      assert.equal(second.visibleEvents, first.visibleEvents);

      const events = queryCalendarEvents({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });
      const reviews = events.filter((event) => event.title === "Client review");
      assert.equal(reviews.length, 1);
      assert.equal(reviews[0].duplicateSourceCount, 2);

      const sources = listCalendarSources();
      const calendars = listCalendars();
      assert.equal(sources.find((source) => source.id === "priceless")?.color, "#059669");
      assert.equal(sources.find((source) => source.id === "personal")?.color, "#dc2626");
      assert.equal(sources.find((source) => source.id === "us-holidays")?.color, "#7c3aed");
      assert.equal(calendars.find((calendar) => calendar.sourceId === "priceless")?.color, "#059669");
      assert.equal(calendars.find((calendar) => calendar.sourceId === "personal")?.color, "#dc2626");
      assert.equal(calendars.find((calendar) => calendar.sourceId === "us-holidays")?.color, "#7c3aed");
    });
  });

  test("preserves imported EverCommerce history across ICS replacements", async () => {
    await withTempCalendar(() => {
      const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
      upsertCalendar(source.id, "EverCommerce", source.color);
      replaceSourceEvents(source.id, [{
        id: "cal_imported_history",
        sourceId: source.id,
        calendarId: "evercommerce:primary",
        uid: "imported-history@example.com",
        recurrenceId: null,
        dedupeKey: "uid:imported-history@example.com:2026-05-20T13:00:00.000Z",
        title: "Imported history",
        start: "2026-05-20T13:00:00.000Z",
        end: "2026-05-20T14:00:00.000Z",
        sortStart: Date.parse("2026-05-20T13:00:00.000Z"),
        sortEnd: Date.parse("2026-05-20T14:00:00.000Z"),
        allDay: false,
        description: null,
        location: null,
        joinLinks: [],
        attendees: [],
        organizer: null,
        recurrence: { recurring: false, recurrenceId: null, rules: [] },
        status: null,
        providerUrl: null,
        raw: { hiltImported: true, hiltImportKind: "fantastical-cache" },
      }]);

      const parsed = parseIcsFeed(source, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:live-feed@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T170000Z
DTEND:20260529T180000Z
SUMMARY:Live feed event
END:VEVENT
END:VCALENDAR`, {
        start: new Date("2026-05-01T00:00:00.000Z"),
        end: new Date("2026-06-01T00:00:00.000Z"),
      });
      replaceSourceEvents(source.id, parsed.events);

      const events = queryCalendarEvents({
        start: new Date("2026-05-01T00:00:00.000Z"),
        end: new Date("2026-06-01T00:00:00.000Z"),
      });
      assert.deepEqual(events.map((event) => event.title), ["Imported history", "Live feed event"]);
      assert.equal(events.every((event) => event.sourceId === "evercommerce"), true);
      assert.equal(events.every((event) => event.calendarId === "evercommerce:primary"), true);
    });
  });

  test("query hides punctuation-only blocker and canceled titles", async () => {
    await withTempCalendar(() => {
      const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "personal")!;
      const parsed = parseIcsFeed(source, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:blocker-bang@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T130000Z
DTEND:20260529T140000Z
SUMMARY:!
END:VEVENT
BEGIN:VEVENT
UID:blocker-dash@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T150000Z
DTEND:20260529T160000Z
SUMMARY: -
END:VEVENT
BEGIN:VEVENT
UID:visible-dash-title@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T170000Z
DTEND:20260529T180000Z
SUMMARY:Project - planning
END:VEVENT
BEGIN:VEVENT
UID:canceled-showcase@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T190000Z
DTEND:20260529T200000Z
SUMMARY:Canceled: Claude Code showcase
END:VEVENT
BEGIN:VEVENT
UID:canceled-dash-showcase@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T200000Z
DTEND:20260529T210000Z
SUMMARY:Canceled - Design review
END:VEVENT
END:VCALENDAR`, {
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-30T00:00:00.000Z"),
      });
      upsertCalendar(source.id, parsed.calendarName, source.color);
      replaceSourceEvents(source.id, parsed.events);

      const events = queryCalendarEvents({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });
      const availabilityBlocks = queryCalendarAvailabilityBlocks({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });
      const holidayEvents = queryCalendarHolidayEvents({
        start: new Date("2026-05-24T00:00:00.000Z"),
        end: new Date("2026-05-30T23:59:59.999Z"),
      });

      assert.deepEqual(events.map((event) => event.title), ["Project - planning"]);
      assert.deepEqual(availabilityBlocks.map((event) => event.title), []);
      assert.deepEqual(holidayEvents.map((event) => event.title), []);
    });
  });

  test("query exposes hidden EverCommerce punctuation blocks as availability blocks", async () => {
    await withTempCalendar(() => {
      const source = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
      const parsed = parseIcsFeed(source, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:blocker-bang@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T130000Z
DTEND:20260529T140000Z
SUMMARY:!
END:VEVENT
BEGIN:VEVENT
UID:blocker-dash@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T150000Z
DTEND:20260529T160000Z
SUMMARY: -
END:VEVENT
BEGIN:VEVENT
UID:visible-standup@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T170000Z
DTEND:20260529T180000Z
SUMMARY:Visible standup
END:VEVENT
END:VCALENDAR`, {
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-30T00:00:00.000Z"),
      });
      upsertCalendar(source.id, parsed.calendarName, source.color);
      replaceSourceEvents(source.id, parsed.events);

      const events = queryCalendarEvents({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });
      const availabilityBlocks = queryCalendarAvailabilityBlocks({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });

      assert.deepEqual(events.map((event) => event.title), ["Visible standup"]);
      assert.deepEqual(availabilityBlocks.map((event) => event.title), ["!", "-"]);
    });
  });

  test("query hides exact Walt blocks from EverCommerce only", async () => {
    await withTempCalendar(() => {
      const evercommerce = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "evercommerce")!;
      const personal = CALENDAR_SOURCE_CONFIGS.find((item) => item.id === "personal")!;
      const window = {
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-30T00:00:00.000Z"),
      };
      const everParsed = parseIcsFeed(evercommerce, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:ever-walt@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T130000Z
DTEND:20260529T140000Z
SUMMARY:👦🏼 Walt
END:VEVENT
BEGIN:VEVENT
UID:ever-walt-timed@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T133000Z
DTEND:20260529T143000Z
SUMMARY:👦🏼 Walt (7:45-8:15)
END:VEVENT
BEGIN:VEVENT
UID:ever-walt-details@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T143000Z
DTEND:20260529T153000Z
SUMMARY:👦🏼 Walt with dad
END:VEVENT
END:VCALENDAR`, window);
      const personalParsed = parseIcsFeed(personal, `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:personal-walt@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T150000Z
DTEND:20260529T160000Z
SUMMARY:👦🏼 Walt
END:VEVENT
BEGIN:VEVENT
UID:personal-visible-family@example.com
DTSTAMP:20260520T120000Z
DTSTART:20260529T170000Z
DTEND:20260529T180000Z
SUMMARY:Family logistics
END:VEVENT
END:VCALENDAR`, window);
      upsertCalendar(evercommerce.id, everParsed.calendarName, evercommerce.color);
      upsertCalendar(personal.id, personalParsed.calendarName, personal.color);
      replaceSourceEvents(evercommerce.id, everParsed.events);
      replaceSourceEvents(personal.id, personalParsed.events);

      const events = queryCalendarEvents({
        start: new Date("2026-05-29T00:00:00.000Z"),
        end: new Date("2026-05-29T23:59:59.999Z"),
      });

      assert.deepEqual(events.map((event) => [event.sourceId, event.title]), [
        ["evercommerce", "👦🏼 Walt with dad"],
        ["personal", "👦🏼 Walt"],
        ["personal", "Family logistics"],
      ]);
    });
  });

  test("calendar event APIs return filtered metadata and honor toggles", async () => {
    await withTempCalendar(async () => {
      await syncCalendarSources();
      const { GET: eventsGET } = await import("../../app/api/calendar/events/route");
      const { GET: detailGET } = await import("../../app/api/calendar/events/[id]/route");
      const { PATCH: calendarPATCH } = await import("../../app/api/calendar/calendars/[id]/route");

      const response = await eventsGET(new NextRequest("http://hilt.test/api/calendar/events?start=2026-05-24T00:00:00.000Z&end=2026-05-30T23:59:59.999Z"));
      const data = await response.json() as {
        events: Array<{ id: string; title: string; joinLinks: Array<{ kind: string }> }>;
        availabilityBlocks: Array<{ title: string }>;
        holidayEvents: Array<{ title: string }>;
      };
      assert.equal(response.status, 200);
      assert.equal(data.events.some((event) => event.title === "Platform standup"), true);
      assert.equal(data.events.some((event) => event.title === "Memorial Day"), true);
      assert.equal(data.events.some((event) => event.title === "National Tuba Day"), false);
      assert.equal(data.availabilityBlocks.some((event) => event.title === "!"), true);
      assert.deepEqual(data.holidayEvents.map((event) => event.title), ["Memorial Day"]);

      const eventWithLink = data.events.find((event) => event.joinLinks.length > 0)!;
      const detail = await detailGET(new Request(`http://hilt.test/api/calendar/events/${eventWithLink.id}`), {
        params: Promise.resolve({ id: eventWithLink.id }),
      });
      const detailData = await detail.json() as { event: { readOnly: boolean; joinLinks: Array<{ kind: string }> } };
      assert.equal(detailData.event.readOnly, true);
      assert.equal(detailData.event.joinLinks.length > 0, true);

      const everCalendar = listCalendarSources().find((source) => source.id === "evercommerce");
      assert.equal(everCalendar?.configured, true);
      const patch = await calendarPATCH(new NextRequest("http://hilt.test/api/calendar/calendars/evercommerce%3Aprimary", {
        method: "PATCH",
        body: JSON.stringify({ selected: false }),
      }), {
        params: Promise.resolve({ id: "evercommerce%3Aprimary" }),
      });
      assert.equal(patch.status, 200);

      const filtered = await eventsGET(new NextRequest("http://hilt.test/api/calendar/events?start=2026-05-29T00:00:00.000Z&end=2026-05-29T23:59:59.999Z"));
      const filteredData = await filtered.json() as { events: Array<{ title: string }> };
      assert.equal(filteredData.events.some((event) => event.title === "Platform standup"), false);
    });
  });
});
