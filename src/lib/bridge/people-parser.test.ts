import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  getAllPeople,
  getPersonDetail,
  hideSuggestedMeeting,
  promoteSuggestedMeeting,
  updatePersonNext,
} from "./people-parser";

const tempDirs: string[] = [];

function makeVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-people-"));
  tempDirs.push(vaultPath);
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
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

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
});
