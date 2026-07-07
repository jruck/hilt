/**
 * v1 weekly-list golden lock (v3 unit A3). The goldens are byte-exact copies of REAL
 * historical weekly lists (provenance: ~/work/bridge/lists/now/ — 2026-01-27 small legacy
 * `## Tasks` file with 2-space details; 2026-03-02 new-format file with NO `## Tasks`
 * wrapper, `## Accomplishments`, and 8 `###` groups; 2026-03-16 large file with the
 * `## Tasks` wrapper, 4 groups, due dates, tab details, and accomplishments prose).
 *
 * The lock: every exported weekly mutator, applied to each golden with fixed inputs,
 * must produce EXACTLY the bytes it produced before the v2 work landed (sha-256 manifest
 * generated against the pre-A3 parser). v1 is Justin's daily-driver surface — any drift
 * here is a user-facing regression, not a refactor.
 *
 * Note the manifest locks *outputs of mutators*, not parse-then-serialize identity:
 * the pre-existing serializer intentionally normalizes some whitespace (blank line before
 * section headings, trailing newline), so real at-rest files are not fixed points. What
 * must never change is the byte behavior of each operation.
 *
 * Regenerate (ONLY when a v1 behavior change is deliberate):
 *   UPDATE_WEEKLY_GOLDENS=1 npx tsx --test src/lib/bridge/weekly-goldens.test.ts
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  addTask,
  deleteTask,
  parseWeeklyFile,
  reorderTasks,
  updateAccomplishments,
  updateNotes,
  updateTask,
} from "./weekly-parser";
import type { BridgeTask } from "../types";

const FIXTURES_DIR = path.join(__dirname, "__fixtures__", "weekly-v1");
const MANIFEST_PATH = path.join(FIXTURES_DIR, "golden-manifest.json");
const GOLDENS = ["2026-01-27.md", "2026-03-02.md", "2026-03-16.md"];

function sha256(text: string): string {
  return crypto.createHash("sha256").update(text, "utf-8").digest("hex");
}

/**
 * Fixed projection of the parse result — exactly the v1 fields. Additive fields the v2
 * work introduces (listFormat, taskPath, …) are deliberately excluded so the lock tests
 * "v1 data unchanged", not "no fields were ever added". needsRecycle is excluded because
 * it depends on the wall clock.
 */
function parseProjection(content: string, filename: string): string {
  const parsed = parseWeeklyFile(content, filename);
  const tasks = parsed.tasks.map((t: BridgeTask) => ({
    id: t.id,
    title: t.title,
    done: t.done,
    details: t.details,
    rawLines: t.rawLines,
    startLine: t.startLine,
    projectPath: t.projectPath,
    projectPaths: t.projectPaths,
    dueDate: t.dueDate,
    group: t.group,
  }));
  return JSON.stringify({
    filename: parsed.filename,
    week: parsed.week,
    sectionOrder: parsed.sectionOrder,
    accomplishments: parsed.accomplishments,
    notes: parsed.notes,
    tasks,
  });
}

/** Every scenario is a deterministic function of the golden's bytes. */
function scenarios(content: string, filename: string): Record<string, string> {
  const parsed = parseWeeklyFile(content, filename);
  const ids = parsed.tasks.map((t) => t.id);
  const first = parsed.tasks[0];
  const out: Record<string, string> = {
    parse: parseProjection(content, filename),
    addTask: addTask(content, "Golden probe task"),
    addTaskWithProject: addTask(content, "Golden probe task", "projects/golden-probe"),
    deleteFirst: deleteTask(content, ids[0]),
    reorderIdentity: reorderTasks(content, ids),
    reorderReversed: reorderTasks(content, [...ids].reverse()),
    updateNoop: updateTask(content, first.id, {}),
    updateToggleDone: updateTask(content, first.id, { done: !first.done }),
    updateTitle: updateTask(content, first.id, { title: "Golden retitled task" }),
    updateDue: updateTask(content, first.id, { dueDate: "2030-01-15" }),
    updateDetails: updateTask(content, first.id, { details: ["golden detail line", "second line"] }),
    updateProjects: updateTask(content, first.id, { projectPaths: ["projects/golden-probe"] }, { "projects/golden-probe": "Golden Probe" }),
    updateNotesSame: updateNotes(content, parsed.notes),
    updateNotesReplaced: updateNotes(content, "Golden replaced notes."),
    updateAccomplishmentsSame: updateAccomplishments(content, parsed.accomplishments),
    updateAccomplishmentsReplaced: updateAccomplishments(content, "Golden replaced accomplishments."),
  };
  // Toggle applied then reverted. NOTE: this is NOT byte-equal to updateNoop — the
  // pre-existing serializer's whitespace normalization is cumulative across rewrites
  // (one extra blank line per group boundary per rewrite). The manifest locks the real
  // (cumulative) bytes; "fixing" that normalization would itself be v1 drift.
  const toggled = updateTask(content, first.id, { done: !first.done });
  out.toggleRoundTrip = updateTask(toggled, first.id, { done: first.done });
  return out;
}

type Manifest = Record<string, Record<string, string>>;

function buildManifest(): Manifest {
  const manifest: Manifest = {};
  for (const name of GOLDENS) {
    const content = fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
    manifest[name] = { __input: sha256(content) };
    for (const [scenario, output] of Object.entries(scenarios(content, name))) {
      manifest[name][scenario] = sha256(output);
    }
  }
  return manifest;
}

if (process.env.UPDATE_WEEKLY_GOLDENS) {
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(buildManifest(), null, 2) + "\n", "utf-8");
  console.log(`[weekly-goldens] manifest regenerated at ${MANIFEST_PATH}`);
}

describe("weekly v1 goldens (byte lock)", () => {
  const manifest: Manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf-8"));

  for (const name of GOLDENS) {
    it(`locks every mutator's bytes on ${name}`, () => {
      const content = fs.readFileSync(path.join(FIXTURES_DIR, name), "utf-8");
      const expected = manifest[name];
      assert.ok(expected, `manifest missing golden ${name}`);
      assert.equal(sha256(content), expected.__input, `golden fixture ${name} was modified`);
      const actual = scenarios(content, name);
      for (const [scenario, output] of Object.entries(actual)) {
        assert.equal(
          sha256(output),
          expected[scenario],
          `v1 byte drift: ${name} / ${scenario} no longer produces its locked bytes`
        );
      }
      // And nothing silently dropped from the manifest
      for (const scenario of Object.keys(expected)) {
        if (scenario === "__input") continue;
        assert.ok(scenario in actual, `scenario ${scenario} disappeared from the golden suite`);
      }
    });
  }
});
