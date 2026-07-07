import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// The library read path lazily writes a baseline read-state file under DATA_DIR — point it at a
// scratch dir BEFORE importing the resolver chain so tests never touch the repo's data/.
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-objects-data-"));

import { resolveObjectRef, formatMeetingTimeRange } from "./resolvers";
import { createTask } from "@/lib/tasks/store";
import { hashId } from "@/lib/library/utils";

function makeVault(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-objects-vault-"));
}

function write(vaultPath: string, relPath: string, content: string): void {
  const target = path.join(vaultPath, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content, "utf-8");
}

// --- meeting ---------------------------------------------------------------------------------

const MEETING_REL = "meetings/2026-07-05/Floyds Standup-2026-07-05 @ 14-00-00.md";

function writeMeetingNote(vaultPath: string, extraFrontmatter = ""): void {
  write(vaultPath, MEETING_REL, `---
granola_id: granola-abc-123
granola_url: https://notes.granola.ai/d/granola-abc-123
title: Floyds Standup
type: note
created: 2026-07-05T17:55:00.000Z
attendees:
  - Justin Ruckman
  - Art Vandelay
transcript: "[[meetings/transcripts/2026-07-05/Floyds Standup (transcript).md]]"
calendar_start: 2026-07-05T18:00:00.000Z
calendar_end: 2026-07-05T18:30:00.000Z
${extraFrontmatter}---

# Floyds Standup
`);
}

test("meeting: resolves card + people-inbox nav from frontmatter", () => {
  const vaultPath = makeVault();
  writeMeetingNote(vaultPath);

  const resolved = resolveObjectRef(vaultPath, { kind: "meeting", id: MEETING_REL });
  assert.ok(resolved);
  assert.equal(resolved.kind, "meeting");
  assert.deepEqual(resolved.card, {
    kind: "meeting",
    title: "Floyds Standup",
    date: "2026-07-05", // 18:00Z = 2:00 PM America/New_York
    timeRange: "2:00–2:30 PM",
    attendees: ["Justin Ruckman", "Art Vandelay"],
    granolaUrl: "https://notes.granola.ai/d/granola-abc-123",
    hasTranscript: true,
  });
  assert.deepEqual(resolved.nav, { view: "people", scope: "/__inbox__/meeting/granola-abc-123" });
});

test("meeting: no granola_id → card resolves but nav is null", () => {
  const vaultPath = makeVault();
  write(vaultPath, "meetings/2026-07-06/Manual Note.md", `---
title: Manual Note
created: 2026-07-06T12:00:00.000Z
---

# Manual Note
`);

  const resolved = resolveObjectRef(vaultPath, { kind: "meeting", id: "meetings/2026-07-06/Manual Note.md" });
  assert.ok(resolved);
  assert.equal(resolved.card.kind, "meeting");
  assert.equal(resolved.card.kind === "meeting" && resolved.card.title, "Manual Note");
  assert.equal(resolved.nav, null);
});

test("meeting: missing file → null; traversal outside the vault → null", () => {
  const vaultPath = makeVault();
  assert.equal(resolveObjectRef(vaultPath, { kind: "meeting", id: "meetings/2026-07-05/nope.md" }), null);
  assert.equal(resolveObjectRef(vaultPath, { kind: "meeting", id: "../../etc/passwd.md" }), null);
});

test("formatMeetingTimeRange: shared meridiem elides, crossing spells both, no end degrades", () => {
  assert.equal(formatMeetingTimeRange("2026-07-05T18:00:00.000Z", "2026-07-05T18:30:00.000Z"), "2:00–2:30 PM");
  assert.equal(formatMeetingTimeRange("2026-07-05T15:30:00.000Z", "2026-07-05T17:00:00.000Z"), "11:30 AM – 1:00 PM");
  assert.equal(formatMeetingTimeRange("2026-07-05T18:00:00.000Z", null), "2:00 PM");
  assert.equal(formatMeetingTimeRange(null, "2026-07-05T18:30:00.000Z"), null);
  assert.equal(formatMeetingTimeRange("not a date", null), null);
});

// --- task ------------------------------------------------------------------------------------

test("task: resolves an accepted task from tasks/ with bridge nav", () => {
  const vaultPath = makeVault();
  const task = createTask(vaultPath, { title: "Ship the resolver", created_at: "2026-07-05T12:00:00.000Z" });

  const resolved = resolveObjectRef(vaultPath, { kind: "task", id: task.id });
  assert.ok(resolved);
  assert.equal(resolved.card.kind, "task");
  if (resolved.card.kind === "task") {
    assert.equal(resolved.card.store, "tasks");
    assert.equal(resolved.card.task.id, task.id);
    assert.equal(resolved.card.task.title, "Ship the resolver");
  }
  assert.deepEqual(resolved.nav, { view: "bridge", scope: "" });
});

test("task: falls through to the proposals store", () => {
  const vaultPath = makeVault();
  const proposal = createTask(vaultPath, {
    title: "Proposed idea",
    status: "proposed",
    created_at: "2026-07-05T12:00:00.000Z",
  });

  const resolved = resolveObjectRef(vaultPath, { kind: "task", id: proposal.id });
  assert.ok(resolved);
  assert.equal(resolved.card.kind === "task" && resolved.card.store, "proposals");
});

test("task: missing id and invalid id shapes → null (no path.join on hostile ids)", () => {
  const vaultPath = makeVault();
  assert.equal(resolveObjectRef(vaultPath, { kind: "task", id: "t-20260705-999" }), null);
  assert.equal(resolveObjectRef(vaultPath, { kind: "task", id: "../../evil" }), null);
  assert.equal(resolveObjectRef(vaultPath, { kind: "task", id: "not-a-task-id" }), null);
});

// --- person ----------------------------------------------------------------------------------

test("person: resolves name, index description, and last meeting date", () => {
  const vaultPath = makeVault();
  write(vaultPath, "people/index.md", "# People\n\n- [[art-vandelay]] — Latex sales counterpart\n");
  write(vaultPath, "people/art-vandelay.md", `---
type: person
created: 2026-01-01
---

# Art Vandelay

## Notes

### 2026-06-20 Import/export sync

- talked latex
`);

  const resolved = resolveObjectRef(vaultPath, { kind: "person", id: "art-vandelay" });
  assert.ok(resolved);
  assert.deepEqual(resolved.card, {
    kind: "person",
    name: "Art Vandelay",
    description: "Latex sales counterpart",
    lastMeetingDate: "2026-06-20",
  });
  assert.deepEqual(resolved.nav, { view: "people", scope: "/art-vandelay" });
});

test("person: missing file → null; slug with a slash → null", () => {
  const vaultPath = makeVault();
  assert.equal(resolveObjectRef(vaultPath, { kind: "person", id: "nobody" }), null);
  assert.equal(resolveObjectRef(vaultPath, { kind: "person", id: "../people/art" }), null);
});

// --- project ---------------------------------------------------------------------------------

test("project: resolves title/status/description from projects/<id>/index.md", () => {
  const vaultPath = makeVault();
  write(vaultPath, "projects/everpro-migration/index.md", `---
status: doing
area: work
---

# EverPro Migration

Move the reporting stack onto the new platform.
`);

  const resolved = resolveObjectRef(vaultPath, { kind: "project", id: "projects/everpro-migration" });
  assert.ok(resolved);
  assert.deepEqual(resolved.card, {
    kind: "project",
    title: "EverPro Migration",
    status: "doing",
    description: "Move the reporting stack onto the new platform.",
  });
  assert.deepEqual(resolved.nav, { view: "bridge", scope: "" });
});

test("project: dir without index.md → null; missing dir → null", () => {
  const vaultPath = makeVault();
  fs.mkdirSync(path.join(vaultPath, "projects", "empty"), { recursive: true });
  assert.equal(resolveObjectRef(vaultPath, { kind: "project", id: "projects/empty" }), null);
  assert.equal(resolveObjectRef(vaultPath, { kind: "project", id: "projects/nope" }), null);
});

// --- library ---------------------------------------------------------------------------------

test("library: resolves via direct lib read (never the read-state-stamping route)", () => {
  const vaultPath = makeVault();
  const relPath = "references/engineering/local-first.md";
  write(vaultPath, relPath, `---
type: reference
title: Local-First Software
description: Ink & Switch essay on local-first architectures.
url: https://www.inkandswitch.com/local-first/
saved_at: 2026-06-01
---

# Local-First Software

## Summary

Ink & Switch essay on local-first architectures.
`);
  const id = hashId(relPath);

  const resolved = resolveObjectRef(vaultPath, { kind: "library", id });
  assert.ok(resolved);
  assert.deepEqual(resolved.card, {
    kind: "library",
    title: "Local-First Software",
    summary: "Ink & Switch essay on local-first architectures.",
    sourceName: "Manual",
    url: "https://www.inkandswitch.com/local-first/",
  });
  assert.deepEqual(resolved.nav, { view: "library", scope: `/item/${id}` });
});

test("library: unknown id → null", () => {
  const vaultPath = makeVault();
  assert.equal(resolveObjectRef(vaultPath, { kind: "library", id: "0123456789abcdef" }), null);
});
