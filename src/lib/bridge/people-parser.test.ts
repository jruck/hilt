import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  closeCalendarDbForTests,
  queryCalendarEvents,
  replaceSourceEvents,
  upsertCalendar,
} from "../calendar/db";
import type { CalendarEventInput } from "../calendar/types";
import {
  getAllPeople,
  getPersonDetail,
  addPersonResource,
  resolveCalendarEventNoteTargets,
  hideSuggestedMeeting,
  promoteSuggestedMeeting,
  attachPeopleNoteTargetsToCalendarEvents,
  removePersonResource,
  updatePersonMetadata,
  updatePersonNext,
} from "./people-parser";

const tempDirs: string[] = [];
const originalCalendarDbPath = process.env.HILT_CALENDAR_DB_PATH;
const originalDataDir = process.env.DATA_DIR;

function makeVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-people-"));
  tempDirs.push(vaultPath);
  closeCalendarDbForTests();
  process.env.DATA_DIR = vaultPath;
  process.env.HILT_CALENDAR_DB_PATH = path.join(vaultPath, ".calendar-test.sqlite");
  fs.mkdirSync(path.join(vaultPath, "people"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "meetings"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "people", "index.md"), "# People\n", "utf-8");
  return vaultPath;
}

function writeMeeting(vaultPath: string, name: string, date: string, time = "10-00-00") {
  fs.writeFileSync(
    path.join(vaultPath, "meetings", `${name}-${date} @ ${time}.md`),
    `---
title: ${name}
created: ${date}T10:00:00
---

# ${name}

Recorded summary.
`,
    "utf-8"
  );
}

afterEach(() => {
  closeCalendarDbForTests();
  if (originalCalendarDbPath === undefined) delete process.env.HILT_CALENDAR_DB_PATH;
  else process.env.HILT_CALENDAR_DB_PATH = originalCalendarDbPath;
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

function seedFutureCalendarEvent(input: Partial<CalendarEventInput> = {}) {
  upsertCalendar("personal", "Personal", "#dc2626");
  const start = input.start ?? "2099-01-30T15:00:00.000Z";
  const end = input.end ?? "2099-01-30T15:30:00.000Z";
  const uid = input.uid ?? "alex-weekly@example.com";
  replaceSourceEvents("personal", [{
    id: input.id ?? "cal_alex_weekly_next",
    sourceId: "personal",
    calendarId: "personal:primary",
    uid,
    recurrenceId: input.recurrenceId ?? "20990130T150000Z",
    dedupeKey: input.dedupeKey ?? `uid:${uid}:${start}`,
    title: input.title ?? "Alex Weekly",
    start,
    end,
    sortStart: Date.parse(start),
    sortEnd: Date.parse(end),
    allDay: false,
    description: null,
    location: null,
    joinLinks: [],
    attendees: [],
    organizer: null,
    recurrence: input.recurrence ?? { recurring: true, recurrenceId: "20990130T150000Z", rules: ["FREQ=WEEKLY"] },
    status: null,
    providerUrl: null,
    raw: {},
    ...input,
  }]);
}

describe("people parser meeting notes", () => {
  it("matches transcript-only recordings to saved people", async () => {
    const vaultPath = makeVault();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );

    const transcriptDir = path.join(vaultPath, "meetings", "transcripts", "2026-05-26");
    fs.mkdirSync(transcriptDir, { recursive: true });
    const transcriptPath = path.join(transcriptDir, "Alex Weekly-2026-05-26 @ 11-32-08 (transcript).md");
    fs.writeFileSync(
      transcriptPath,
      `---
title: Alex Weekly - Transcript
type: transcript
created: 2026-05-26T15:32:08.316Z
---

# Transcript for: Alex Weekly

### Guest

Discussed launch coverage.
`,
      "utf-8"
    );

    const people = await getAllPeople(vaultPath);
    const detail = await getPersonDetail(vaultPath, "alex");

    expect(people.people.find((person) => person.slug === "alex")?.meetingCount).toBe(1);
    expect(people.people.find((person) => person.slug === "alex")?.lastMeetingDate).toBe("2026-05-26T15:32:08.316Z");
    expect(detail?.meetings).toHaveLength(1);
    expect(detail?.meetings[0]).toMatchObject({
      source: "granola",
      date: "2026-05-26",
      time: "2026-05-26T15:32:08.316Z",
      title: "Alex Weekly",
      transcriptPath,
      summary: undefined,
    });
  });

  it("does not double count transcripts when the meeting note exists", async () => {
    const vaultPath = makeVault();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );

    const dateDir = path.join(vaultPath, "meetings", "2026-05-26");
    fs.mkdirSync(dateDir, { recursive: true });
    const filename = "Alex Weekly-2026-05-26 @ 11-32-08.md";
    fs.writeFileSync(
      path.join(dateDir, filename),
      `---
title: Alex Weekly
created: 2026-05-26T15:32:08.316Z
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );

    const transcriptDir = path.join(vaultPath, "meetings", "transcripts", "2026-05-26");
    fs.mkdirSync(transcriptDir, { recursive: true });
    fs.writeFileSync(
      path.join(transcriptDir, "Alex Weekly-2026-05-26 @ 11-32-08 (transcript).md"),
      `---
title: Alex Weekly - Transcript
type: transcript
created: 2026-05-26T15:32:08.316Z
note: "[[meetings/2026-05-26/${filename}]]"
---

# Transcript for: Alex Weekly
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.meetings).toHaveLength(1);
    expect(detail?.meetings[0].summary).toContain("Recorded summary");
    expect(detail?.meetings[0].transcriptPath).toContain("meetings/transcripts/2026-05-26");
  });

  it("shows same-date written notes as a tab on the recorded meeting", async () => {
    const vaultPath = makeVault();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes

### 2026-04-28 - Weekly Sync

Bring up launch checklist.
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "alex__weekly-sync.md"),
      `---
title: Weekly Sync
created: 2026-04-28T10:00:00
---

# Weekly Sync

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.meetings).toHaveLength(1);
    expect(detail?.meetings[0].source).toBe("granola");
    expect(detail?.meetings[0].summary).toContain("Recorded summary");
    expect(detail?.meetings[0].notes).toContain("Bring up launch checklist.");
  });

  it("promotes today's Next note into the next recorded meeting and clears Next", async () => {
    const vaultPath = makeVault();
    const today = new Date().toISOString().slice(0, 10);
    const personPath = path.join(vaultPath, "people", "alex.md");
    fs.writeFileSync(
      personPath,
      `---
type: person
next_saved_at: ${today}T08:00:00
---

# Alex

## Next

- Ask about launch risks

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "alex__weekly-sync.md"),
      `---
title: Weekly Sync
created: ${today}T10:00:00
---

# Weekly Sync

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");
    const personFile = fs.readFileSync(path.join(vaultPath, "people", "alex.md"), "utf-8");

    expect(detail?.nextRaw).toBe("");
    expect(detail?.meetings[0].source).toBe("granola");
    expect(detail?.meetings[0].notes).toContain("Ask about launch risks");
    expect(personFile).toContain(`### ${today} - Weekly Sync`);
    expect(personFile).not.toContain("next_saved_at:");
    expect(personFile).not.toContain("## Next\n\n- Ask about launch risks");
  });

  it("does not promote Next into a meeting that happened before the note was saved", async () => {
    const vaultPath = makeVault();
    const today = new Date().toISOString().slice(0, 10);
    const personPath = path.join(vaultPath, "people", "alex.md");
    fs.writeFileSync(
      personPath,
      `---
type: person
next_saved_at: ${today}T12:00:00
---

# Alex

## Next

- Prep for the next meeting

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "alex__weekly-sync.md"),
      `---
title: Weekly Sync
created: ${today}T10:00:00
---

# Weekly Sync

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.nextRaw).toContain("Prep for the next meeting");
    expect(detail?.meetings[0].source).toBe("granola");
    expect(detail?.meetings[0].notes).toBeUndefined();
  });

  it("tracks when Next was saved and clears that marker with the scratchpad", () => {
    const initial = `---
type: person
---

# Alex

## Next

## Notes
`;

    const saved = updatePersonNext(initial, "- Ask about launch risks");
    expect(saved).toContain("next_saved_at:");
    expect(saved).toContain("- Ask about launch risks");

    const cleared = updatePersonNext(saved, "");
    expect(cleared).not.toContain("next_saved_at:");
  });

  it("returns future calendar links for a saved person's recurring meeting history", async () => {
    const vaultPath = makeVault();
    seedFutureCalendarEvent();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 11-32-08.md"),
      `---
title: Alex Weekly
created: 2026-05-26T15:32:08.316Z
calendar_ical_uid: alex-weekly@example.com
hilt_calendar_event_id: cal_alex_weekly_history
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.calendarLinks.primary).toMatchObject({
      eventId: "cal_alex_weekly_next",
      title: "Alex Weekly",
      uid: "alex-weekly@example.com",
      seriesKey: "icaluid:alex-weekly@example.com",
      method: "icaluid",
      historicalCount: 1,
    });
  });

  it("returns manual resources from person frontmatter and dedupes equivalent URLs", async () => {
    const vaultPath = makeVault();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
resources: [{"id":"manual_doc","label":"Agenda","url":"https://docs.google.com/document/d/example-doc-id/edit?utm_source=test","kind":"doc","createdAt":"2026-06-01T12:00:00.000Z"},{"id":"duplicate_doc","label":"Duplicate","url":"https://docs.google.com/document/d/example-doc-id/","kind":"doc","createdAt":"2026-06-02T12:00:00.000Z"},{"url":"not a url"}]
---

# Alex

## Next

## Notes
`,
      "utf-8",
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.resources).toEqual([{
      id: "manual_doc",
      label: "Agenda",
      url: "https://docs.google.com/document/d/example-doc-id/edit?utm_source=test",
      kind: "doc",
      createdAt: "2026-06-01T12:00:00.000Z",
    }]);
  });

  it("adds and removes person resources atomically with stable URL dedupe", async () => {
    const vaultPath = makeVault();
    const personPath = path.join(vaultPath, "people", "alex.md");
    fs.writeFileSync(
      personPath,
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8",
    );

    const first = addPersonResource(vaultPath, "alex", {
      url: "https://docs.google.com/document/d/example-doc-id/edit",
      label: "Weekly notes",
    });
    const second = addPersonResource(vaultPath, "alex", {
      url: "https://docs.google.com/document/d/example-doc-id/",
      label: "Renamed notes",
    });
    let detail = await getPersonDetail(vaultPath, "alex");

    expect(first.id).toBe(second.id);
    expect(detail?.resources).toHaveLength(1);
    expect(detail?.resources[0]).toMatchObject({
      id: first.id,
      label: "Renamed notes",
      kind: "doc",
    });
    expect(fs.readFileSync(personPath, "utf-8")).toContain("resources: [{");

    removePersonResource(vaultPath, "alex", first.id);
    detail = await getPersonDetail(vaultPath, "alex");
    expect(detail?.resources).toEqual([]);
  });

  it("returns active meetings with join, resource, and provider links", async () => {
    const vaultPath = makeVault();
    seedFutureCalendarEvent({
      description: [
        "Meeting notes, please add to and review as needed:",
        "https://docs.google.com/document/d/162wRZeX9CFeSvZNsUx8-qRxqGCLDyknRpfbE8br7RJ4/edit",
      ].join("\n"),
      joinLinks: [{
        kind: "teams",
        label: "Teams",
        url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_INSIGHTS%40thread.v2/0",
      }],
      providerUrl: "https://outlook.office.com/calendar/item/example",
    });
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: group
---

# Alex

## Next

## Notes
`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 11-32-08.md"),
      `---
title: Alex Weekly
created: 2026-05-26T15:32:08.316Z
calendar_ical_uid: alex-weekly@example.com
hilt_calendar_event_id: cal_alex_weekly_history
---

# Alex Weekly

Recorded summary.
`,
      "utf-8",
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.activeMeetings).toHaveLength(1);
    expect(detail?.activeMeetings[0]).toMatchObject({
      eventId: "cal_alex_weekly_next",
      title: "Alex Weekly",
      joinLinks: [{ kind: "teams", label: "Teams" }],
      resourceLinks: [{ kind: "doc", label: "Google Doc" }],
      providerUrl: "https://outlook.office.com/calendar/item/example",
    });
    expect(detail?.activeMeetings[0].resourceLinks[0].url).toContain("162wRZeX9CFeSvZNsUx8-qRxqGCLDyknRpfbE8br7RJ4");
  });

  it("resolves People Next note targets for future calendar events with saved meeting history", () => {
    const vaultPath = makeVault();
    seedFutureCalendarEvent();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 11-32-08.md"),
      `---
title: Alex Weekly
created: 2026-05-26T15:32:08.316Z
calendar_ical_uid: alex-weekly@example.com
hilt_calendar_event_id: cal_alex_weekly_history
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );
    const [event] = queryCalendarEvents({
      start: new Date("2099-01-30T00:00:00.000Z"),
      end: new Date("2099-01-31T00:00:00.000Z"),
    });

    const targets = resolveCalendarEventNoteTargets(vaultPath, event, new Date("2099-01-01T00:00:00.000Z"));

    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({
      kind: "person-next",
      slug: "alex",
      name: "Alex",
      personType: "person",
      candidate: {
        eventId: "cal_alex_weekly_next",
        title: "Alex Weekly",
        uid: "alex-weekly@example.com",
        seriesKey: "icaluid:alex-weekly@example.com",
        method: "icaluid",
      },
    });
  });

  it("does not add a People prep target when the event already has recorded meeting notes", () => {
    const vaultPath = makeVault();
    seedFutureCalendarEvent();
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 11-32-08.md"),
      `---
title: Alex Weekly
created: 2026-05-26T15:32:08.316Z
calendar_ical_uid: alex-weekly@example.com
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );
    const [event] = queryCalendarEvents({
      start: new Date("2099-01-30T00:00:00.000Z"),
      end: new Date("2099-01-31T00:00:00.000Z"),
    });

    const [annotated] = attachPeopleNoteTargetsToCalendarEvents([{
      ...event,
      meetingNotes: [{
        granolaId: "granola-alex-weekly",
        title: "Alex Weekly",
        notePath: "meetings/Alex Weekly.md",
        transcriptPath: null,
        granolaUrl: null,
        meetingEndCount: 1,
        calendarMatchMethod: "icaluid",
        calendarMatchConfidence: 1,
      }],
    }], vaultPath, new Date("2099-01-01T00:00:00.000Z"));

    expect(annotated.noteTargets).toBeUndefined();
  });

  it("persists and clears Next calendar context", () => {
    const initial = `---
type: person
---

# Alex

## Next

## Notes
`;
    const saved = updatePersonNext(initial, "- Ask about launch risks", {
      calendarCandidate: {
        eventId: "cal_alex_weekly_next",
        title: "Alex Weekly",
        start: "2099-01-30T15:00:00.000Z",
        end: "2099-01-30T15:30:00.000Z",
        uid: "alex-weekly@example.com",
        seriesKey: "icaluid:alex-weekly@example.com",
        method: "icaluid",
        confidence: 1,
        historicalCount: 3,
        lastSeenAt: "2026-05-26T15:32:08.316Z",
      },
    });

    expect(saved).toContain("next_calendar_series_key: icaluid:alex-weekly@example.com");
    expect(saved).toContain("next_calendar_event_id: cal_alex_weekly_next");
    expect(saved).toContain("next_calendar_event_start: 2099-01-30T15:00:00.000Z");
    expect(saved).toContain("next_calendar_title: Alex Weekly");

    const cleared = updatePersonNext(saved, "");
    expect(cleared).not.toContain("next_calendar_series_key:");
    expect(cleared).not.toContain("next_calendar_event_id:");
    expect(cleared).not.toContain("next_calendar_event_start:");
    expect(cleared).not.toContain("next_calendar_title:");
  });

  it("keeps markdown headings inside the Next scratchpad", async () => {
    const vaultPath = makeVault();
    const nextContent = `## 1. First ask

Details for the first ask.

## 2. Second ask

Details for the second ask.

## 3. Third ask

Details for the third ask.`;

    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      updatePersonNext(
        `---
type: person
---

# Alex

## Next

## Notes
`,
        nextContent
      ),
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");

    expect(detail?.nextRaw).toContain("## 1. First ask");
    expect(detail?.nextRaw).toContain("## 2. Second ask");
    expect(detail?.nextRaw).toContain("## 3. Third ask");
  });

  it("promotes the full Next scratchpad when it contains markdown headings", async () => {
    const vaultPath = makeVault();
    const today = new Date().toISOString().slice(0, 10);
    const personPath = path.join(vaultPath, "people", "alex.md");
    fs.writeFileSync(
      personPath,
      `---
type: person
next_saved_at: ${today}T08:00:00
---

# Alex

## Next

## 1. First ask

Details for the first ask.

## 2. Second ask

Details for the second ask.

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "alex__weekly-sync.md"),
      `---
title: Weekly Sync
created: ${today}T10:00:00
---

# Weekly Sync

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");
    const personFile = fs.readFileSync(personPath, "utf-8");

    expect(detail?.nextRaw).toBe("");
    expect(detail?.meetings[0].notes).toContain("## 1. First ask");
    expect(detail?.meetings[0].notes).toContain("## 2. Second ask");
    expect(personFile).toContain("## 1. First ask");
    expect(personFile).toContain("## 2. Second ask");
    expect(personFile).toContain("### " + today + " - Weekly Sync");
  });

  it("promotes Next into the first actual recording even when calendar context points later", async () => {
    const vaultPath = makeVault();
    const today = new Date().toISOString().slice(0, 10);
    const personPath = path.join(vaultPath, "people", "alex.md");
    fs.writeFileSync(
      personPath,
      `---
type: person
next_saved_at: ${today}T08:00:00
next_calendar_series_key: icaluid:alex-weekly@example.com
next_calendar_event_id: cal_future
next_calendar_event_start: 2099-01-30T15:00:00.000Z
next_calendar_title: Alex Weekly
---

# Alex

## Next

- Bring roadmap question

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 11-32-08.md"),
      `---
title: Alex Weekly
created: ${today}T10:00:00
calendar_ical_uid: alex-weekly@example.com
hilt_calendar_event_id: cal_actual
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");
    const personFile = fs.readFileSync(personPath, "utf-8");

    expect(detail?.nextRaw).toBe("");
    expect(detail?.meetings[0].notes).toContain("Bring roadmap question");
    expect(personFile).toContain(`### ${today} - Alex Weekly`);
    expect(personFile).not.toContain("next_calendar_event_id:");
  });

  it("uses selected calendar context as a tie-breaker between simultaneous recordings", async () => {
    const vaultPath = makeVault();
    const today = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
next_saved_at: ${today}T08:00:00
next_calendar_series_key: title:alex weekly
next_calendar_event_id: cal_future
next_calendar_event_start: 2099-01-30T15:00:00.000Z
next_calendar_title: Alex Weekly
---

# Alex

## Next

- Ask about launch risks

## Notes
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Other-2026-05-26 @ 10-00-00.md"),
      `---
title: Alex Other
created: ${today}T10:00:00
---

# Alex Other

Recorded summary.
`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "meetings", "Alex Weekly-2026-05-26 @ 10-00-00.md"),
      `---
title: Alex Weekly
created: ${today}T10:00:00
---

# Alex Weekly

Recorded summary.
`,
      "utf-8"
    );

    const detail = await getPersonDetail(vaultPath, "alex");
    const weekly = detail?.meetings.find((meeting) => meeting.title === "Alex Weekly");
    const other = detail?.meetings.find((meeting) => meeting.title === "Alex Other");

    expect(weekly?.notes).toContain("Ask about launch risks");
    expect(other?.notes).toBeUndefined();
  });

  it("hides a suggested meeting until new unmatched activity appears", async () => {
    const vaultPath = makeVault();
    writeMeeting(vaultPath, "Design review", "2026-05-01");
    writeMeeting(vaultPath, "Design review", "2026-05-08");
    writeMeeting(vaultPath, "Design review", "2026-05-15");

    const beforeHide = await getAllPeople(vaultPath);
    const suggestion = beforeHide.suggestedMeetings.find((item) => item.name === "Design review");
    expect(suggestion).toEqual({ name: "Design review", count: 3, lastDate: "2026-05-15" });

    hideSuggestedMeeting(vaultPath, suggestion!);

    const afterHide = await getAllPeople(vaultPath);
    expect(afterHide.suggestedMeetings.some((item) => item.name === "Design review")).toBe(false);

    writeMeeting(vaultPath, "Design review", "2026-05-22");

    const afterNewMeeting = await getAllPeople(vaultPath);
    expect(afterNewMeeting.suggestedMeetings.find((item) => item.name === "Design review")).toEqual({
      name: "Design review",
      count: 4,
      lastDate: "2026-05-22",
    });
  });

  it("promotes a suggested meeting into a saved group and claims its history", async () => {
    const vaultPath = makeVault();
    writeMeeting(vaultPath, "Design review", "2026-05-01");
    writeMeeting(vaultPath, "Design review", "2026-05-08");
    writeMeeting(vaultPath, "Design review", "2026-05-15");

    const promoted = promoteSuggestedMeeting(vaultPath, {
      name: "Design review",
      type: "group",
      description: "Recurring design feedback",
    });

    expect(promoted.slug).toBe("design-review");
    expect(fs.readFileSync(path.join(vaultPath, "people", "design-review.md"), "utf-8")).toContain("# Design review");
    expect(fs.readFileSync(path.join(vaultPath, "people", "index.md"), "utf-8")).toContain(
      "- [[design-review]] — Recurring design feedback"
    );

    const people = await getAllPeople(vaultPath);
    expect(people.suggestedMeetings.some((item) => item.name === "Design review")).toBe(false);
    expect(people.people.find((person) => person.slug === "design-review")?.meetingCount).toBe(3);
  });

  it("does not write a default description when accepting without one", async () => {
    const vaultPath = makeVault();
    writeMeeting(vaultPath, "Insights Architecture", "2026-05-01");
    writeMeeting(vaultPath, "Insights Architecture", "2026-05-08");
    writeMeeting(vaultPath, "Insights Architecture", "2026-05-15");

    const accepted = promoteSuggestedMeeting(vaultPath, {
      name: "Insights Architecture",
      type: "group",
    });
    const indexContent = fs.readFileSync(path.join(vaultPath, "people", "index.md"), "utf-8");
    const people = await getAllPeople(vaultPath);

    expect(accepted.slug).toBe("insights-architecture");
    expect(indexContent).toContain("- [[insights-architecture]]");
    expect(indexContent).not.toContain("Promoted from suggested meetings");
    expect(people.people.find((person) => person.slug === "insights-architecture")?.description).toBe("");
  });

  it("updates saved person metadata across the person file and people index", async () => {
    const vaultPath = makeVault();
    fs.writeFileSync(
      path.join(vaultPath, "people", "index.md"),
      "# People\n\n## People\n\n- [[alex]] — Original description\n",
      "utf-8"
    );
    fs.writeFileSync(
      path.join(vaultPath, "people", "alex.md"),
      `---
type: person
aliases: ["Alex"]
---

# Alex

## Next

## Notes
`,
      "utf-8"
    );

    const updated = updatePersonMetadata(vaultPath, "alex", {
      name: "Alex Rivera",
      description: "Product lead",
      aliases: ["Alex", "AR", "Alex"],
    });
    const fileContent = fs.readFileSync(path.join(vaultPath, "people", "alex.md"), "utf-8");
    const indexContent = fs.readFileSync(path.join(vaultPath, "people", "index.md"), "utf-8");
    const detail = await getPersonDetail(vaultPath, "alex");

    expect(updated.name).toBe("Alex Rivera");
    expect(updated.description).toBe("Product lead");
    expect(updated.aliases).toEqual(["Alex", "AR"]);
    expect(fileContent).toContain("# Alex Rivera");
    expect(fileContent).toContain('aliases: ["Alex","AR"]');
    expect(indexContent).toContain("- [[alex]] — Product lead");
    expect(detail?.name).toBe("Alex Rivera");
    expect(detail?.description).toBe("Product lead");
  });
});
