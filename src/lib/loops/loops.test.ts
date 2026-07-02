/**
 * Behavioral spec for the loop contract IO (Phase 1 gate). These tests are Fable-authored and
 * NORMATIVE — the implementation (artifacts.ts / registry.ts / stores.ts) is built to make them
 * pass and MUST NOT modify this file or types.ts. See docs/plans/briefings-v2-implementation.md §3.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LoopArtifactFrontmatter, LoopItem, RegistryLoop } from "./types";
import {
  LoopContractError,
  artifactRelPath,
  parseLoopArtifact,
  renderEscalationsSection,
  renderLoopHealthSection,
  resolveArtifactWritePath,
  serializeLoopArtifact,
  validateLoopArtifactFrontmatter,
  writeLoopArtifact,
} from "./artifacts";
import { REGISTRY_REL_PATH, latestArtifactPath, loadRegistry, loopHome, parseRegistry } from "./registry";
import {
  appendFeedback,
  appendVerdict,
  markFeedbackProcessed,
  markVerdictsActed,
  readFeedback,
  readSurfacingState,
  readUnactedVerdicts,
  readUnprocessedFeedback,
  readVerdicts,
  writeSurfacingState,
} from "./stores";

// ── Fixtures ──────────────────────────────────────────────────────────────────────────────────

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-loops-"));
}

const INSIGHT: LoopItem = {
  id: "ma-2026-07-06-001",
  loop: "meeting-actions",
  kind: "insight",
  title: "Big presentation tomorrow — protect the evening",
  citations: [{ source: "meetings/2026-07-05/prep.md", date: "2026-07-05" }],
  escalated: { reason: "time-sensitive: presentation is tomorrow 9am" },
};

const ACTION: LoopItem = {
  id: "ma-2026-07-06-002",
  loop: "meeting-actions",
  kind: "action",
  title: "Send Sarah the pricing sheet",
  detail: "Committed in the Floyd's call; she needs it before Thursday.",
  citations: [{ source: "meetings/2026-07-05/floyds.md", date: "2026-07-05", anchor: "I'll get you pricing" }],
  confidence: 0.9,
  owner: "justin",
  allowed_verdicts: ["approve", "dismiss", "assign_to_me", "assign_to_agent", "revise"],
};

const QUIET_ACTION: LoopItem = {
  id: "ma-2026-07-06-003",
  loop: "meeting-actions",
  kind: "action",
  title: "Low-confidence: maybe revisit the onboarding doc",
  citations: [{ source: "meetings/2026-07-05/floyds.md" }],
  confidence: 0.3,
  allowed_verdicts: ["approve", "dismiss", "revise"],
};

function validFm(): LoopArtifactFrontmatter {
  return {
    loop: "meeting-actions",
    run_at: "2026-07-06T05:15:00.000Z",
    cadence: "daily",
    items: [INSIGHT, ACTION, QUIET_ACTION],
    health: { ok: true, attempted: 3, succeeded: 3, coverage: 1, notes: "clean run" },
  };
}

const LOOP_SHADOW: RegistryLoop = {
  id: "meeting-actions", domain: "meetings", cadence: "daily", enabled: true, phase: "shadow",
};
const LOOP_LIVE: RegistryLoop = { ...LOOP_SHADOW, phase: "live" };

const REGISTRY_YAML = `loops:
  - id: library
    domain: references
    cadence: daily
    enabled: true
    phase: live
  - id: meeting-actions
    domain: meetings
    cadence: daily
    enabled: true
    phase: shadow
    published_surfaces: ["/briefings", "People view"]
  - id: people-projections
    domain: people
    cadence: daily
    enabled: true
    phase: shadow
    writer: meeting-actions
`;

// ── Artifact round-trip & validation ─────────────────────────────────────────────────────────

test("artifact round-trips: serialize → parse preserves frontmatter and body", () => {
  const fm = validFm();
  const body = "## Ledger deltas\n\n- opened 2, closed 1\n\n## Escalations\n\n- stub\n\n## Loop health\n\n- ok\n";
  const md = serializeLoopArtifact(fm, body);
  const parsed = parseLoopArtifact(md);
  assert.deepEqual(parsed.frontmatter.items, fm.items);
  assert.equal(parsed.frontmatter.loop, "meeting-actions");
  assert.equal(parsed.frontmatter.cadence, "daily");
  assert.deepEqual(parsed.frontmatter.health, fm.health);
  assert.ok(parsed.body.includes("## Ledger deltas"));
});

test("validation: a valid frontmatter has zero problems", () => {
  assert.deepEqual(validateLoopArtifactFrontmatter(validFm()), []);
});

test("validation collects ALL problems, fail-loud, with specifics", () => {
  const bad = {
    loop: "meeting-actions",
    // run_at missing
    cadence: "hourly", // invalid enum
    items: [
      { id: "x1", loop: "other-loop", kind: "insight", title: "", citations: [] }, // loop mismatch + empty title
      { id: "x1", loop: "meeting-actions", kind: "wish", title: "dup id + bad kind", citations: [{ source: "a.md" }] },
      { id: "x2", loop: "meeting-actions", kind: "insight", title: "conf on insight", citations: [{ source: "a.md" }], confidence: 0.5 },
      { id: "x3", loop: "meeting-actions", kind: "action", title: "bad verdict", citations: [{ source: "a.md" }], allowed_verdicts: ["approve", "yeet"] },
      { id: "x4", loop: "meeting-actions", kind: "insight", title: "empty escalation reason", citations: [{ source: "a.md" }], escalated: { reason: "" } },
    ],
    // health missing
  };
  const problems = validateLoopArtifactFrontmatter(bad);
  assert.ok(problems.length >= 7, `expected ≥7 problems, got ${problems.length}: ${problems.join(" | ")}`);
  const blob = problems.join(" ~ ");
  for (const needle of ["run_at", "cadence", "health", "x1", "kind", "confidence", "yeet", "reason"]) {
    assert.ok(blob.includes(needle), `problems should mention "${needle}": ${blob}`);
  }
});

test("parseLoopArtifact throws LoopContractError on invalid frontmatter", () => {
  const md = serializeLoopArtifact(validFm(), "body\n");
  const broken = md.replace("cadence: daily", "cadence: hourly");
  assert.throws(() => parseLoopArtifact(broken), LoopContractError);
});

// ── View rendering ───────────────────────────────────────────────────────────────────────────

test("renderEscalationsSection: only escalated items, with reason + citation; asks name verdicts", () => {
  const section = renderEscalationsSection([INSIGHT, ACTION, QUIET_ACTION]);
  assert.ok(section.includes("Big presentation tomorrow"), "escalated insight present");
  assert.ok(section.includes("time-sensitive"), "reason present");
  assert.ok(section.includes("meetings/2026-07-05/prep.md"), "citation present");
  assert.ok(!section.includes("Send Sarah"), "non-escalated action must NOT appear");
  const escalatedAsk: LoopItem = { ...ACTION, escalated: { reason: "due Thursday" } };
  const withAsk = renderEscalationsSection([escalatedAsk]);
  assert.ok(withAsk.includes("approve"), "ask escalation names its verdicts");
});

test("renderEscalationsSection returns empty string when nothing is escalated", () => {
  assert.equal(renderEscalationsSection([ACTION, QUIET_ACTION]), "");
});

test("renderLoopHealthSection renders ok state and metrics; FAILING when not ok", () => {
  const ok = renderLoopHealthSection({ ok: true, attempted: 3, succeeded: 3 });
  assert.ok(/ok/i.test(ok));
  assert.ok(ok.includes("3"));
  const failing = renderLoopHealthSection({ ok: false, notes: "claude binary rejected flags" });
  assert.ok(/FAILING/.test(failing));
  assert.ok(failing.includes("claude binary rejected flags"));
});

// ── Write guard ──────────────────────────────────────────────────────────────────────────────

test("artifactRelPath is meta/loops/<domain>/reports/<date>.md", () => {
  assert.equal(artifactRelPath(LOOP_SHADOW, "2026-07-06"), "meta/loops/meetings/reports/2026-07-06.md");
});

test("write guard: shadow loop goes to the sandbox; live loop goes to the vault", () => {
  const vault = tmpdir(); const sandbox = tmpdir();
  const shadowPath = resolveArtifactWritePath({ vaultPath: vault, sandboxDir: sandbox, loop: LOOP_SHADOW, fm: validFm(), date: "2026-07-06" });
  assert.ok(shadowPath.startsWith(sandbox), `shadow must write under sandbox, got ${shadowPath}`);
  const livePath = resolveArtifactWritePath({ vaultPath: vault, sandboxDir: sandbox, loop: LOOP_LIVE, fm: validFm(), date: "2026-07-06" });
  assert.ok(livePath.startsWith(vault), `live must write under vault, got ${livePath}`);
});

test("write guard: as_of (backtest) ALWAYS goes to the sandbox, even for a live loop", () => {
  const vault = tmpdir(); const sandbox = tmpdir();
  const fm = { ...validFm(), as_of: "2026-06-01" };
  const p = resolveArtifactWritePath({ vaultPath: vault, sandboxDir: sandbox, loop: LOOP_LIVE, fm, date: "2026-06-01" });
  assert.ok(p.startsWith(sandbox), `as_of must force sandbox, got ${p}`);
});

test("write guard: sandbox required but missing → throws; loop/fm id mismatch → throws", () => {
  const vault = tmpdir();
  assert.throws(
    () => resolveArtifactWritePath({ vaultPath: vault, loop: LOOP_SHADOW, fm: validFm(), date: "2026-07-06" }),
    LoopContractError,
  );
  const fm = { ...validFm(), loop: "some-other-loop" };
  assert.throws(
    () => resolveArtifactWritePath({ vaultPath: vault, sandboxDir: tmpdir(), loop: LOOP_LIVE, fm, date: "2026-07-06" }),
    LoopContractError,
  );
});

test("writeLoopArtifact writes through the guard and round-trips from disk", () => {
  const vault = tmpdir(); const sandbox = tmpdir();
  const written = writeLoopArtifact({
    vaultPath: vault, sandboxDir: sandbox, loop: LOOP_SHADOW, fm: validFm(),
    body: "## Deltas\n\n- x\n", date: "2026-07-06",
  });
  assert.ok(written.startsWith(sandbox));
  const parsed = parseLoopArtifact(fs.readFileSync(written, "utf-8"));
  assert.equal(parsed.frontmatter.items.length, 3);
});

// ── Registry ─────────────────────────────────────────────────────────────────────────────────

test("registry parses, validates, and exposes homes", () => {
  const reg = parseRegistry(REGISTRY_YAML);
  assert.equal(reg.loops.length, 3);
  const ma = reg.loops.find((l) => l.id === "meeting-actions")!;
  assert.equal(ma.phase, "shadow");
  const pp = reg.loops.find((l) => l.id === "people-projections")!;
  assert.equal(pp.writer, "meeting-actions");
  assert.equal(loopHome("/vault", ma), path.join("/vault", "meta/loops/meetings"));
});

test("registry: duplicate ids and bad enums are contract errors", () => {
  const dup = REGISTRY_YAML + `  - id: library\n    domain: references\n    cadence: daily\n    enabled: true\n    phase: live\n`;
  assert.throws(() => parseRegistry(dup), LoopContractError);
  assert.throws(() => parseRegistry(REGISTRY_YAML.replace("cadence: daily", "cadence: hourly")), LoopContractError);
  assert.throws(() => parseRegistry(REGISTRY_YAML.replace("phase: shadow", "phase: beta")), LoopContractError);
});

test("loadRegistry reads meta/loops/registry.yml from the vault; missing file throws", () => {
  const vault = tmpdir();
  fs.mkdirSync(path.join(vault, path.dirname(REGISTRY_REL_PATH)), { recursive: true });
  fs.writeFileSync(path.join(vault, REGISTRY_REL_PATH), REGISTRY_YAML, "utf-8");
  assert.equal(loadRegistry(vault).loops.length, 3);
  assert.throws(() => loadRegistry(tmpdir()));
});

test("latestArtifactPath: greatest date wins; asOf bounds it; none → null", () => {
  const base = tmpdir();
  const dir = path.join(base, "meta/loops/meetings/reports");
  fs.mkdirSync(dir, { recursive: true });
  for (const d of ["2026-07-01", "2026-07-03", "2026-07-06"]) fs.writeFileSync(path.join(dir, `${d}.md`), "x");
  assert.equal(latestArtifactPath(base, LOOP_SHADOW), path.join(dir, "2026-07-06.md"));
  assert.equal(latestArtifactPath(base, LOOP_SHADOW, "2026-07-04"), path.join(dir, "2026-07-03.md"));
  assert.equal(latestArtifactPath(base, LOOP_SHADOW, "2026-07-03"), path.join(dir, "2026-07-03.md"), "asOf is inclusive");
  assert.equal(latestArtifactPath(tmpdir(), LOOP_SHADOW), null);
});

// ── Stores ───────────────────────────────────────────────────────────────────────────────────

test("feedback store: append, read, unprocessed filter, processed stamping", () => {
  const home = tmpdir();
  assert.deepEqual(readFeedback(home), []);
  appendFeedback(home, {
    id: "fb-1", author: "justin", created_at: "2026-07-06T12:00:00Z",
    target: { loop: "meeting-actions", level: "item", item_id: "ma-2026-07-06-002" },
    text: "this action is scoped badly",
  });
  appendFeedback(home, {
    id: "fb-2", author: "claude-sim", created_at: "2026-07-06T12:01:00Z",
    target: { loop: "meeting-actions", level: "section" },
    text: "section is bloated",
  });
  assert.equal(readFeedback(home).length, 2);
  assert.equal(readUnprocessedFeedback(home).length, 2);
  markFeedbackProcessed(home, ["fb-1"], { at: "2026-07-07T05:15:00Z", run_at: "2026-07-07T05:15:00Z" });
  const un = readUnprocessedFeedback(home);
  assert.equal(un.length, 1);
  assert.equal(un[0].id, "fb-2");
  assert.equal(readFeedback(home).find((r) => r.id === "fb-1")!.processed!.at, "2026-07-07T05:15:00Z");
});

test("verdict store: append, unacted filter, acted stamping; author preserved", () => {
  const home = tmpdir();
  appendVerdict(home, {
    id: "v-1", author: "justin", created_at: "2026-07-06T12:00:00Z",
    loop: "meeting-actions", item_id: "ma-2026-07-06-002", verdict: "approve",
  });
  appendVerdict(home, {
    id: "v-2", author: "claude-sim", created_at: "2026-07-06T12:02:00Z",
    loop: "meeting-actions", item_id: "ma-2026-07-06-003", verdict: "revise", note: "tighten the scope",
  });
  assert.equal(readVerdicts(home).length, 2);
  assert.equal(readUnactedVerdicts(home).length, 2);
  markVerdictsActed(home, ["v-1"], { at: "2026-07-07T05:15:00Z", run_at: "2026-07-07T05:15:00Z" });
  assert.deepEqual(readUnactedVerdicts(home).map((v) => v.id), ["v-2"]);
  assert.equal(readVerdicts(home).find((v) => v.id === "v-2")!.author, "claude-sim");
});

test("surfacing state round-trips; missing file → empty", () => {
  const home = tmpdir();
  assert.deepEqual(readSurfacingState(home), {});
  writeSurfacingState(home, {
    "ma-2026-07-06-002": { first_surfaced: "2026-07-06", last_surfaced: "2026-07-08", times_surfaced: 3 },
  });
  const s = readSurfacingState(home);
  assert.equal(s["ma-2026-07-06-002"].times_surfaced, 3);
});
