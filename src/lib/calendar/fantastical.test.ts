import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import { closeCalendarDbForTests, getCalendarDb, replaceSourceEvents } from "./db";
import {
  enrichEverCommerceEventsFromFantastical,
  participantFromFantasticalArchive,
  type FantasticalCalendarRecord,
} from "./fantastical";
import type { CalendarEventInput, CalendarParticipant } from "./types";

const originalCalendarDbPath = process.env.HILT_CALENDAR_DB_PATH;

afterEach(() => {
  closeCalendarDbForTests();
  if (originalCalendarDbPath === undefined) delete process.env.HILT_CALENDAR_DB_PATH;
  else process.env.HILT_CALENDAR_DB_PATH = originalCalendarDbPath;
});

describe("Fantastical calendar enrichment", () => {
  test("applies a recurring series roster to every matching ICS occurrence", async () => {
    await withTempCalendar(() => {
      const firstStart = Date.parse("2026-07-20T14:00:00.000Z");
      const secondStart = Date.parse("2026-07-27T14:00:00.000Z");
      replaceSourceEvents("evercommerce", [
        eventInput("weekly@example.com", firstStart, "weekly-1"),
        eventInput("weekly@example.com", secondStart, "weekly-2"),
      ]);

      const report = enrichEverCommerceEventsFromFantastical({
        calendarDb: getCalendarDb(),
        records: [record(10, "WEEKLY@example.com", firstStart, [participant("Avery", "avery@example.com", "accepted")], true)],
        now: new Date("2026-07-17T18:00:00.000Z"),
      });

      assert.equal(report.enrichedEvents, 2);
      assert.equal(report.exactMatches, 1);
      assert.equal(report.seriesMatches, 1);
      assert.deepEqual(storedAttendeeNames(), ["Avery", "Avery"]);
    });
  });

  test("prefers an exact recurrence exception roster over the series roster", async () => {
    await withTempCalendar(() => {
      const firstStart = Date.parse("2026-07-20T14:00:00.000Z");
      const secondStart = Date.parse("2026-07-27T15:00:00.000Z");
      replaceSourceEvents("evercommerce", [
        eventInput("weekly@example.com", firstStart, "weekly-1"),
        eventInput("weekly@example.com", secondStart, "weekly-2"),
      ]);

      const series = record(10, "weekly@example.com", firstStart, [participant("Avery", "avery@example.com")], true);
      const exception = record(11, "weekly@example.com", secondStart, [participant("Blair", "blair@example.com", "tentative")], true);
      exception.recurrenceInstanceMs = secondStart;
      const report = enrichEverCommerceEventsFromFantastical({ calendarDb: getCalendarDb(), records: [series, exception] });

      assert.equal(report.exactMatches, 2);
      assert.deepEqual(storedAttendeeNames(), ["Avery", "Blair"]);
    });
  });

  test("preserves attendee data supplied by ICS while filling a missing organizer", async () => {
    await withTempCalendar(() => {
      const start = Date.parse("2026-07-20T14:00:00.000Z");
      const input = eventInput("one-off@example.com", start, "one-off");
      input.attendees = [participant("ICS attendee", "ics@example.com", "accepted")];
      replaceSourceEvents("evercommerce", [input]);
      const cacheRecord = record(12, "one-off@example.com", start, [participant("Cache attendee", "cache@example.com")]);
      cacheRecord.organizer = participant("Organizer", "organizer@example.com");

      const report = enrichEverCommerceEventsFromFantastical({ calendarDb: getCalendarDb(), records: [cacheRecord] });
      const row = getCalendarDb().prepare("SELECT attendees_json, organizer_json FROM calendar_events").get() as {
        attendees_json: string;
        organizer_json: string;
      };

      assert.equal(report.enrichedEvents, 1);
      assert.equal((JSON.parse(row.attendees_json) as CalendarParticipant[])[0].name, "ICS attendee");
      assert.equal((JSON.parse(row.organizer_json) as CalendarParticipant).name, "Organizer");
    });
  });

  test("normalizes Fantastical participant response status", () => {
    assert.deepEqual(participantFromFantasticalArchive({
      displayName: "Alex Example",
      email: "mailto:Alex@Example.com",
      status: 2,
    }), {
      name: "Alex Example",
      email: "alex@example.com",
      responseStatus: "accepted",
    });
  });
});

async function withTempCalendar(run: () => void | Promise<void>): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), "hilt-fantastical-test-"));
  closeCalendarDbForTests();
  process.env.HILT_CALENDAR_DB_PATH = join(dir, "calendar.sqlite");
  try {
    await run();
  } finally {
    closeCalendarDbForTests();
    rmSync(dir, { recursive: true, force: true });
  }
}

function eventInput(uid: string, startMs: number, id: string): CalendarEventInput {
  const start = new Date(startMs).toISOString();
  const end = new Date(startMs + 30 * 60_000).toISOString();
  return {
    id,
    sourceId: "evercommerce",
    calendarId: "evercommerce:primary",
    uid,
    recurrenceId: null,
    dedupeKey: `uid:${uid.toLowerCase()}:${start}`,
    title: "Weekly meeting",
    start,
    end,
    sortStart: startMs,
    sortEnd: startMs + 30 * 60_000,
    allDay: false,
    description: null,
    location: null,
    joinLinks: [],
    resourceLinks: [],
    attendees: [],
    organizer: null,
    recurrence: { recurring: true, recurrenceId: null, rules: ["FREQ=WEEKLY"] },
    status: "CONFIRMED",
    providerUrl: null,
    raw: { source: "ics" },
  };
}

function record(
  rowId: number,
  uid: string,
  startMs: number,
  attendees: CalendarParticipant[],
  recurring = false,
): FantasticalCalendarRecord {
  return {
    rowId,
    uid,
    startMs,
    recurrenceInstanceMs: null,
    recurring,
    attendees,
    organizer: null,
  };
}

function participant(name: string, email: string, responseStatus: string | null = null): CalendarParticipant {
  return { name, email, responseStatus };
}

function storedAttendeeNames(): Array<string | null> {
  const rows = getCalendarDb().prepare("SELECT attendees_json FROM calendar_events ORDER BY sort_start").all() as Array<{ attendees_json: string }>;
  return rows.map((row) => (JSON.parse(row.attendees_json) as CalendarParticipant[])[0]?.name ?? null);
}
