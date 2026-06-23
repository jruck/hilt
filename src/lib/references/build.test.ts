import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReference } from "./build";

// The bridge-task output MUST byte-match the original BridgeTaskPanel.copyTaskReference string — this
// is the reference users already rely on. If this breaks, the migration changed behavior.
test("bridge-task matches the original gold-standard reference verbatim", () => {
  const out = buildReference({
    kind: "bridge-task",
    absPath: "/Users/jruck/work/bridge/lists/now/2026-06-22.md",
    line: 14,
    title: "Billing audit",
    dueDate: "2026-06-22",
  });
  assert.equal(
    out,
    [
      "/Users/jruck/work/bridge/lists/now/2026-06-22.md:14",
      "",
      "Use the current file contents as source of truth. The referenced item is the top-level markdown checkbox at that line; indented lines below it are child details until the next top-level checkbox or section heading.",
      "",
      "Title: Billing audit [due:: 2026-06-22]",
    ].join("\n"),
  );
});

test("bridge-task without a line uses the title-match how-to and no :line suffix", () => {
  const out = buildReference({ kind: "bridge-task", absPath: "/v/lists/now/x.md", title: "Do thing" });
  assert.equal(out.split("\n")[0], "/v/lists/now/x.md"); // location line has no :line suffix
  assert.match(out, /Find the top-level markdown checkbox matching this title/);
  assert.match(out, /\nTitle: Do thing$/);
});

test("bridge-task with no path falls back to the title as the location", () => {
  const out = buildReference({ kind: "bridge-task", absPath: null, title: "Untracked task" });
  assert.ok(out.startsWith("Untracked task\n\n"));
});

test("library-artifact leads with absolute path and includes url in the title line", () => {
  const out = buildReference({
    kind: "library-artifact",
    absPath: "/Users/jruck/work/bridge/references/process/a.md",
    title: "Inspect at Scale",
    url: "https://x.com/i/article/123",
  });
  assert.ok(out.startsWith("/Users/jruck/work/bridge/references/process/a.md\n\n"));
  assert.match(out, /Saved Library reference/);
  assert.match(out, /\nTitle: Inspect at Scale — https:\/\/x\.com\/i\/article\/123$/);
});

test("doc omits the redundant Title line (basename == path tail)", () => {
  const out = buildReference({ kind: "doc", absPath: "/v/notes/readme.md" });
  assert.equal(out, "/v/notes/readme.md\n\nFile in the vault. Open it as the source of truth.");
  assert.ok(!out.includes("Title:"));
});

test("meeting includes Title only when present", () => {
  assert.match(buildReference({ kind: "meeting", absPath: "/v/m.md", title: "Q2 sync" }), /\nTitle: Q2 sync$/);
  assert.ok(!buildReference({ kind: "meeting", absPath: "/v/m.md" }).includes("Title:"));
});

test("person uses the name as the Title", () => {
  const out = buildReference({ kind: "person", absPath: "/v/people/art-vandelay.md", name: "Art Vandelay" });
  assert.match(out, /Person note/);
  assert.match(out, /\nTitle: Art Vandelay$/);
});

test("session leads with the id, names the provider and cwd, no file path", () => {
  const out = buildReference({
    kind: "session",
    sessionId: "abc-123",
    provider: "codex",
    cwd: "/Users/jruck/work/hilt",
    title: "Library perf",
  });
  assert.ok(out.startsWith("abc-123\n\n"));
  assert.match(out, /Coding-agent session id \(codex\)/);
  assert.match(out, /workspace: \/Users\/jruck\/work\/hilt/);
  assert.match(out, /\nTitle: Library perf$/);
});

test("briefing-item leads with the file path and uses headline as Title", () => {
  const out = buildReference({
    kind: "briefing-item",
    absPath: "/Users/jruck/work/bridge/briefings/2026-06-22.md",
    headline: "Q2 planning notes ready",
  });
  assert.ok(out.startsWith("/Users/jruck/work/bridge/briefings/2026-06-22.md\n\n"));
  assert.match(out, /find the top-level bullet matching this headline/);
  assert.match(out, /\nTitle: Q2 planning notes ready$/);
});

test("calendar-event leads with the fetch endpoint and a when/source descriptor", () => {
  const out = buildReference({
    kind: "calendar-event",
    id: "evt_9",
    uid: "ICALUID-1",
    title: "Q2 Planning Sync",
    start: "2026-06-25T14:00:00.000Z",
    end: "2026-06-25T15:00:00.000Z",
    sourceName: "Google (personal)",
  });
  assert.ok(out.startsWith("Fetch via: GET /api/calendar/events/evt_9\n\n"));
  assert.match(out, /iCal uid: ICALUID-1/);
  assert.match(out, /\nTitle: Q2 Planning Sync — 2026-06-25 14:00–15:00 — Google \(personal\)$/);
});

test("calendar-event with an all-day (date-only) start shows just the date", () => {
  const out = buildReference({ kind: "calendar-event", id: "e", title: "Holiday", start: "2026-07-04" });
  assert.match(out, /\nTitle: Holiday — 2026-07-04$/);
});
