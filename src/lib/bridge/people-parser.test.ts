import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { getPersonDetail, updatePersonNext } from "./people-parser";

const tempDirs: string[] = [];

function makeVault(): string {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-people-"));
  tempDirs.push(vaultPath);
  fs.mkdirSync(path.join(vaultPath, "people"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "meetings"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "people", "index.md"), "# People\n", "utf-8");
  return vaultPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("people parser meeting notes", () => {
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
});
