import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { closeCalendarDbForTests, replaceSourceEvents, upsertCalendar } from "../calendar/db";
import type { CalendarEvent, CalendarEventInput } from "../calendar/types";
import { attachGranolaMeetingNotes, findHiltCalendarMatch } from "./calendar-links";
import { closeGranolaSyncDbForTests, upsertGranolaDocument } from "./db";
import { augmentExistingMarkdown, buildNoteMarkdown, buildTranscriptMarkdown, computeMeetingPaths } from "./markdown";
import { normalizeGranolaDocument } from "./normalize";

let tempDir = "";

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-granola-test-"));
  process.env.HILT_GRANOLA_SYNC_DB_PATH = path.join(tempDir, "granola.sqlite");
  process.env.HILT_CALENDAR_DB_PATH = path.join(tempDir, "calendar.sqlite");
});

afterEach(() => {
  closeGranolaSyncDbForTests();
  closeCalendarDbForTests();
  delete process.env.HILT_GRANOLA_SYNC_DB_PATH;
  delete process.env.HILT_CALENDAR_DB_PATH;
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("Granola normalization", () => {
  it("extracts Google calendar metadata from raw Granola documents", () => {
    const doc = normalizeGranolaDocument({
      id: "doc_1",
      title: "Roadmap Sync",
      created_at: "2026-05-20T14:00:00.000Z",
      updated_at: "2026-05-20T15:00:00.000Z",
      last_viewed_panel: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Summary" }] }] } },
      people: { attendees: [{ name: "Ava", email: "ava@example.com" }] },
      google_calendar_event: {
        id: "google_event_1",
        iCalUID: "abc@example.com",
        summary: "Roadmap Sync",
        start: { dateTime: "2026-05-20T14:00:00.000Z" },
        end: { dateTime: "2026-05-20T15:00:00.000Z" },
        htmlLink: "https://calendar.example/event",
      },
    });

    assert.equal(doc.calendarEvent?.id, "google_event_1");
    assert.equal(doc.calendarEvent?.iCalUID, "abc@example.com");
    assert.equal(doc.attendees[0]?.email, "ava@example.com");
  });
});

describe("Granola markdown", () => {
  it("adds Hilt calendar fields without replacing the body", () => {
    const content = [
      "---",
      "granola_id: doc_1",
      "title: Existing",
      "type: note",
      "---",
      "",
      "Existing body",
      "",
    ].join("\n");
    const result = augmentExistingMarkdown(content, {
      hilt_calendar_event_id: "cal_123",
      calendar_ical_uid: "abc@example.com",
    });

    assert.equal(result.changed, true);
    assert.match(result.content, /hilt_calendar_event_id: cal_123/);
    assert.match(result.content, /Existing body/);
  });

  it("generates current Bridge note paths and calendar frontmatter", () => {
    const doc = normalizeGranolaDocument(
      {
        id: "doc_2",
        title: "Design Review",
        created_at: "2026-05-21T13:30:12.000Z",
        updated_at: "2026-05-21T14:00:00.000Z",
        folders: [{ name: "Team meetings" }],
        last_viewed_panel: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Looks good." }] }] } },
        calendar_event: {
          calendar_event_id: "evt_2",
          event_title: "Design Review",
          scheduled_start_time: "2026-05-21T13:30:00.000Z",
          scheduled_end_time: "2026-05-21T14:00:00.000Z",
        },
      },
      [{ text: "Transcript body", speaker: "Ava", start_timestamp: "2026-05-21T13:31:00.000Z" }],
    );
    const paths = computeMeetingPaths(tempDir, doc);
    const markdown = buildNoteMarkdown(doc, paths, {
      hiltCalendarEventId: "cal_2",
      method: "icaluid",
      confidence: 1,
      reason: "test",
    });

    assert.match(paths.noteRelativePath, /^meetings\/2026-05-21\/Design Review-2026-05-21 @ /);
    assert.match(markdown || "", /calendar_event_id: evt_2/);
    assert.match(markdown || "", /hilt_calendar_event_id: cal_2/);
    assert.match(markdown || "", /folders:\n  - Team meetings/);

    const transcript = buildTranscriptMarkdown(doc, paths, {
      hiltCalendarEventId: "cal_2",
      method: "icaluid",
      confidence: 1,
      reason: "test",
    });
    assert.match(transcript || "", /folders:\n  - Team meetings/);
  });
});

describe("Granola calendar links", () => {
  it("matches by iCalUID and attaches meeting notes to calendar API events", () => {
    upsertCalendar("personal", "Personal", "#dc2626");
    const event: CalendarEventInput = {
      id: "cal_exact",
      sourceId: "personal",
      calendarId: "personal:primary",
      uid: "abc@example.com",
      recurrenceId: null,
      dedupeKey: "uid:abc@example.com:2026-05-20T14:00:00.000Z",
      title: "Roadmap Sync",
      start: "2026-05-20T14:00:00.000Z",
      end: "2026-05-20T15:00:00.000Z",
      sortStart: Date.parse("2026-05-20T14:00:00.000Z"),
      sortEnd: Date.parse("2026-05-20T15:00:00.000Z"),
      allDay: false,
      description: null,
      location: null,
      joinLinks: [],
      attendees: [],
      organizer: null,
      recurrence: { recurring: false, recurrenceId: null, rules: [] },
      status: null,
      providerUrl: null,
      raw: { uid: "abc@example.com" },
    };
    replaceSourceEvents("personal", [event]);

    const doc = normalizeGranolaDocument({
      id: "doc_3",
      title: "Roadmap Sync",
      created_at: "2026-05-20T14:00:00.000Z",
      updated_at: "2026-05-20T15:00:00.000Z",
      last_viewed_panel: { content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Summary" }] }] } },
      google_calendar_event: { iCalUID: "abc@example.com", start: { dateTime: "2026-05-20T14:00:00.000Z" } },
    });
    const match = findHiltCalendarMatch(doc);
    assert.equal(match.hiltCalendarEventId, "cal_exact");
    assert.equal(match.method, "icaluid");

    upsertGranolaDocument({
      doc,
      notePath: "/tmp/note.md",
      transcriptPath: null,
      calendarMatch: match,
      syncedAt: "2026-05-20T15:01:00.000Z",
    });
    const calendarEvent: CalendarEvent = { ...event, sourceIds: ["personal"], duplicateSourceCount: 1, readOnly: true };
    const linked = attachGranolaMeetingNotes([calendarEvent]);
    assert.equal(linked[0].meetingNotes?.[0]?.granolaId, "doc_3");
  });
});
