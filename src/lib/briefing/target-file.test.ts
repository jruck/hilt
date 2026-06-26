import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveBriefingTarget, weekendSaturday } from "./target-file";

const V = "/Users/jruck/work/bridge";

test("daily target is briefings/<date>.md", () => {
  const t = resolveBriefingTarget(V, "daily", "2026-06-26");
  assert.equal(t.relPath, "briefings/2026-06-26.md");
  assert.equal(t.absPath, `${V}/briefings/2026-06-26.md`);
  assert.equal(t.targetDate, "2026-06-26");
  assert.equal(t.dateRange, undefined);
});

test("weekend Saturday anchors itself; Sunday anchors the same Saturday file", () => {
  const sat = resolveBriefingTarget(V, "weekend", "2026-06-20"); // Saturday
  assert.equal(sat.relPath, "briefings/weekend/2026-06-20.md");
  assert.deepEqual(sat.dateRange, { start: "2026-06-20", end: "2026-06-21" });

  const sun = resolveBriefingTarget(V, "weekend", "2026-06-21"); // Sunday → same Saturday file
  assert.equal(sun.relPath, "briefings/weekend/2026-06-20.md");
  assert.equal(sun.targetDate, "2026-06-20");
});

test("weekend on a weekday anchors the upcoming Saturday", () => {
  assert.equal(weekendSaturday("2026-06-22"), "2026-06-27"); // Mon → Sat
  assert.equal(weekendSaturday("2026-06-24"), "2026-06-27"); // Wed → Sat
  assert.equal(weekendSaturday("2026-06-26"), "2026-06-27"); // Fri → Sat
  assert.equal(weekendSaturday("2026-06-20"), "2026-06-20"); // Sat → itself
  assert.equal(weekendSaturday("2026-06-21"), "2026-06-20"); // Sun → prev Sat
});

test("output override wins over the computed path", () => {
  const t = resolveBriefingTarget(V, "daily", "2026-06-26", "/tmp/scratch/brief.md");
  assert.equal(t.absPath, "/tmp/scratch/brief.md");
  assert.equal(t.relPath, "briefings/2026-06-26.md"); // relPath still reflects the canonical target
});

test("invalid date is rejected", () => {
  assert.throws(() => resolveBriefingTarget(V, "daily", "2026/06/26"));
  assert.throws(() => weekendSaturday("nope"));
});
