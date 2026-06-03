import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { buildHudAgendaItems, hudAgendaConflictPositions, selectHudNextEventGroup } from "./hud-agenda";
import type { CalendarEvent } from "./types";

function calendarEvent(id: string, title: string, start: string, end: string): CalendarEvent {
  return {
    id,
    sourceIds: ["test"],
    calendarId: "test-calendar",
    sourceId: "test",
    uid: id,
    title,
    start,
    end,
    sortStart: new Date(start).getTime(),
    sortEnd: new Date(end).getTime(),
    allDay: false,
    description: null,
    location: null,
    joinLinks: [],
    attendees: [],
    organizer: null,
    recurrence: { recurring: false, recurrenceId: null, rules: [] },
    status: null,
    providerUrl: null,
    readOnly: true,
    duplicateSourceCount: 1,
  };
}

describe("HUD agenda", () => {
  test("keeps events that are contained inside a longer overlapping event", () => {
    const now = new Date("2026-06-02T12:00:00.000Z");
    const events = [
      calendarEvent("insights", "Insights upcoming releases", "2026-06-03T17:00:00.000Z", "2026-06-03T18:00:00.000Z"),
      calendarEvent("fftc", "FFTC Forward meeting", "2026-06-03T17:00:00.000Z", "2026-06-03T17:30:00.000Z"),
      calendarEvent("design", "Design review", "2026-06-03T17:30:00.000Z", "2026-06-03T18:00:00.000Z"),
      calendarEvent("handoff", "Handoff review", "2026-06-03T17:45:00.000Z", "2026-06-03T18:15:00.000Z"),
    ];

    const items = buildHudAgendaItems(events, now, null, { freeBlockMinutes: 30, maxItems: 28 });
    const eventIds = items.filter((item) => item.kind === "event").map((item) => item.event.id);
    const positions = Object.fromEntries(hudAgendaConflictPositions(items));

    assert.deepEqual(eventIds, ["fftc", "insights", "design", "handoff"]);
    assert.deepEqual(positions, {
      fftc: "start",
      insights: "middle",
      design: "middle",
      handoff: "end",
    });
  });

  test("keeps the next exact-start group in the agenda alongside later overlaps", () => {
    const now = new Date("2026-06-03T16:30:00.000Z");
    const insights = calendarEvent("insights", "Insights upcoming releases", "2026-06-03T17:00:00.000Z", "2026-06-03T18:00:00.000Z");
    const fftc = calendarEvent("fftc", "FFTC Forward meeting", "2026-06-03T17:00:00.000Z", "2026-06-03T17:30:00.000Z");
    const design = calendarEvent("design", "Design review", "2026-06-03T17:30:00.000Z", "2026-06-03T18:00:00.000Z");
    const handoff = calendarEvent("handoff", "Handoff review", "2026-06-03T17:45:00.000Z", "2026-06-03T18:15:00.000Z");
    const events = [insights, fftc, design, handoff];

    const nextEvents = selectHudNextEventGroup(events, null, now);
    const items = buildHudAgendaItems(events, now, null, { freeBlockMinutes: 30, maxItems: 28 });
    const eventIds = items.filter((item) => item.kind === "event").map((item) => item.event.id);

    assert.deepEqual(nextEvents.map((event) => event.id), ["fftc", "insights"]);
    assert.deepEqual(eventIds, ["fftc", "insights", "design", "handoff"]);
  });
});
