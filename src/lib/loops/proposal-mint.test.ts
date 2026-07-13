/**
 * Behavioral spec for A6 proposal minting: LedgerEntry → proposal file mapping fidelity,
 * task_id-stamp idempotency (survives loop re-runs AND deliberate file deletion), sink
 * precedence as a pure function, cross-dir id collision checking, and the registry
 * `proposal_sink` key validation.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { LedgerEntry } from "./meeting-ledger";
import { mintProposalFromLedgerEntry, resolveProposalSink, restoreProposalFromLedgerEntry } from "./proposal-mint";
import { parseRegistry } from "./registry";
import { parseTaskFile } from "../tasks/task-file";
import { proposalsDir, tasksDir } from "../tasks/store";

function tmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "hilt-proposal-mint-"));
}

function makeEntry(overrides: Partial<LedgerEntry> = {}): LedgerEntry {
  return {
    id: "ma-2026-07-05-002",
    action: "Send Sarah the pricing sheet",
    owner: "justin",
    due: "2026-07-10",
    citations: [{
      source: "meetings/2026-07-05/floyds-sync-2026-07-05.md",
      date: "2026-07-05",
      anchor: "I'll get you pricing before Thursday — promise",
    }],
    confidence: 0.9,
    source: "extractor",
    status: "open",
    opened_at: "2026-07-05T19:30:00.000Z",
    opened_from: "meetings/2026-07-05/floyds-sync-2026-07-05.md",
    status_history: [{ at: "2026-07-05T19:30:00.000Z", from: null, to: "open" }],
    sightings: [],
    ...overrides,
  };
}

// ── Sink precedence (pure) ───────────────────────────────────────────────────────────────────

test("resolveProposalSink: --proposals-dir beats everything", () => {
  const sink = resolveProposalSink({
    proposalsDirFlag: "/explicit/sink",
    ledgerHomeFlag: "/eval/home",
    registryProposalSink: "vault",
    vaultPath: "/vault",
    loopHome: "/loop/home",
  });
  assert.deepEqual(sink, { dir: "/explicit/sink", kind: "explicit" });
});

test("resolveProposalSink: --ledger-home beats registry (eval-harness isolation)", () => {
  const sink = resolveProposalSink({
    ledgerHomeFlag: "/eval/home",
    registryProposalSink: "vault",
    vaultPath: "/vault",
    loopHome: "/eval/home",
  });
  assert.deepEqual(sink, { dir: path.join("/eval/home", "proposals"), kind: "ledger-home" });
});

test("resolveProposalSink: registry proposal_sink vault → <vault>/tasks/.proposals/", () => {
  const sink = resolveProposalSink({
    registryProposalSink: "vault",
    vaultPath: "/vault",
    loopHome: "/loop/home",
  });
  assert.deepEqual(sink, { dir: path.join("/vault", "tasks", ".proposals"), kind: "vault" });
});

test("resolveProposalSink: shadow default is <loopHome>/proposals/", () => {
  const sink = resolveProposalSink({ vaultPath: "/vault", loopHome: "/loop/home" });
  assert.deepEqual(sink, { dir: path.join("/loop/home", "proposals"), kind: "loop-home" });
});

// ── Mapping fidelity ─────────────────────────────────────────────────────────────────────────

test("mintProposalFromLedgerEntry maps entry → proposal file and stamps task_id", () => {
  const vault = tmpdir();
  const entry = makeEntry();
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: "/unused" });

  const minted = mintProposalFromLedgerEntry(entry, {
    sink,
    loopId: "meeting-actions",
    vaultPath: vault,
    now: "2026-07-07T19:30:00.000Z",
  });

  assert.ok(minted);
  assert.equal(entry.task_id, minted.id);
  const filePath = path.join(sink.dir, `${minted.id}.md`);
  assert.ok(fs.existsSync(filePath));

  const onDisk = parseTaskFile(fs.readFileSync(filePath, "utf-8"));
  assert.equal(onDisk.title, "Send Sarah the pricing sheet");
  assert.equal(onDisk.status, "proposed");
  assert.equal(onDisk.due, "2026-07-10");
  assert.equal(onDisk.created_at, "2026-07-07T19:30:00.000Z");
  assert.deepEqual(onDisk.origin, {
    loop: "meeting-actions",
    meeting: "meetings/2026-07-05/floyds-sync-2026-07-05.md",
    item_id: "ma-2026-07-05-002",
  });
  assert.deepEqual(onDisk.provenance, {
    quote: "I'll get you pricing before Thursday — promise",
    source: "meetings/2026-07-05/floyds-sync-2026-07-05.md",
  });
});

test("meeting proposal ids use the local loop date across UTC midnight", () => {
  const vault = tmpdir();
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: "/unused" });
  const entry = makeEntry({ id: "ma-2026-07-12-090" });
  const minted = mintProposalFromLedgerEntry(entry, {
    sink,
    loopId: "meeting-actions",
    vaultPath: vault,
    now: "2026-07-13T00:15:00.000Z",
    idDate: "2026-07-12",
  });
  assert.match(minted!.id, /^t-20260712-/);
  assert.equal(minted!.created_at, "2026-07-13T00:15:00.000Z");
});

test("no due / no citation anchor → keys simply absent, mint still succeeds", () => {
  const vault = tmpdir();
  const entry = makeEntry({ id: "ma-2026-07-05-003", citations: [], due: undefined });
  delete entry.due;
  const sink = { dir: path.join(vault, "sink"), kind: "explicit" as const };

  const minted = mintProposalFromLedgerEntry(entry, { sink, loopId: "meeting-actions", vaultPath: vault, now: "2026-07-07T19:30:00.000Z" });

  assert.ok(minted);
  const onDisk = parseTaskFile(fs.readFileSync(path.join(sink.dir, `${minted.id}.md`), "utf-8"));
  assert.equal(onDisk.due, undefined);
  assert.equal(onDisk.provenance, undefined);
  assert.equal(onDisk.origin?.item_id, "ma-2026-07-05-003");
});

// ── Idempotency ──────────────────────────────────────────────────────────────────────────────

test("an entry with task_id NEVER re-mints — even after the file is deleted (dismiss)", () => {
  const vault = tmpdir();
  const entry = makeEntry();
  const sink = { dir: path.join(vault, "sink"), kind: "explicit" as const };
  const opts = { sink, loopId: "meeting-actions", vaultPath: vault, now: "2026-07-07T19:30:00.000Z" };

  const first = mintProposalFromLedgerEntry(entry, opts);
  assert.ok(first);

  // Re-run: stamped → null, no second file.
  assert.equal(mintProposalFromLedgerEntry(entry, opts), null);
  assert.equal(fs.readdirSync(sink.dir).length, 1);

  // Deliberate deletion (a dismiss) must not resurrect the proposal on the next run.
  fs.unlinkSync(path.join(sink.dir, `${first.id}.md`));
  assert.equal(mintProposalFromLedgerEntry(entry, opts), null);
  assert.ok(!fs.existsSync(path.join(sink.dir, `${first.id}.md`)));
});

test("an interrupted file-first mint is reconciled by stable ledger origin without a duplicate", () => {
  const vault = tmpdir();
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: "/unused" });
  const firstEntry = makeEntry();
  const options = { sink, loopId: "meeting-actions", vaultPath: vault, now: "2026-07-07T19:30:00.000Z" };
  const first = mintProposalFromLedgerEntry(firstEntry, options);
  assert.ok(first);

  // Simulate a crash after the proposal file landed but before SQLite stored task_id.
  const recoveredEntry = makeEntry();
  const recovered = mintProposalFromLedgerEntry(recoveredEntry, options);
  assert.equal(recovered?.id, first.id);
  assert.equal(recoveredEntry.task_id, first.id);
  assert.deepEqual(fs.readdirSync(sink.dir).filter((name) => name.endsWith(".md")), [`${first.id}.md`]);
});

test("restoreProposalFromLedgerEntry recreates the same id and provenance without reminting", () => {
  const vault = tmpdir();
  const entry = makeEntry({ context: "The response-rate review left one decision open." });
  const sink = resolveProposalSink({ registryProposalSink: "vault", vaultPath: vault, loopHome: "/unused" });
  const minted = mintProposalFromLedgerEntry(entry, {
    sink,
    loopId: "meeting-actions",
    vaultPath: vault,
    now: "2026-07-07T19:30:00.000Z",
  });
  assert.ok(minted);
  fs.unlinkSync(path.join(sink.dir, `${minted.id}.md`));
  entry.status = "dropped";
  entry.verdict = { verdict: "dismiss", at: "2026-07-08T10:00:00.000Z" };

  const restored = restoreProposalFromLedgerEntry(entry, {
    vaultPath: vault,
    loopId: "meeting-actions",
    now: "2026-07-09T12:00:00.000Z",
  });
  assert.equal(restored.created, true);
  assert.equal(restored.task.id, minted.id);
  assert.equal(restored.task.created_at, entry.opened_at);
  assert.deepEqual(restored.task.origin, minted.origin);
  assert.deepEqual(restored.task.provenance, minted.provenance);
  assert.doesNotMatch(restored.task.body, /The response-rate review left one decision open\./);
  assert.match(restored.task.body, /restored to proposed \(via dismissed recovery\)/);

  const repeated = restoreProposalFromLedgerEntry(entry, { vaultPath: vault, loopId: "meeting-actions" });
  assert.equal(repeated.created, false);
  assert.equal(repeated.task.id, minted.id);
});

// ── Cross-dir collision checking ─────────────────────────────────────────────────────────────

test("minted ids are collision-checked against the sink AND the vault canonical dirs", () => {
  const vault = tmpdir();
  const sink = { dir: path.join(vault, "shadow-sink"), kind: "loop-home" as const };
  // 001 taken in the vault's tasks/, 002 taken in the vault's .proposals/, 003 taken in the sink.
  fs.mkdirSync(tasksDir(vault), { recursive: true });
  fs.mkdirSync(proposalsDir(vault), { recursive: true });
  fs.mkdirSync(sink.dir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir(vault), "t-20260707-001.md"), "x");
  fs.writeFileSync(path.join(proposalsDir(vault), "t-20260707-002.md"), "x");
  fs.writeFileSync(path.join(sink.dir, "t-20260707-003.md"), "x");

  const minted = mintProposalFromLedgerEntry(makeEntry(), {
    sink, loopId: "meeting-actions", vaultPath: vault, now: "2026-07-07T19:30:00.000Z",
  });
  assert.ok(minted);
  assert.equal(minted.id, "t-20260707-004");
});

// ── Registry key ─────────────────────────────────────────────────────────────────────────────

test("parseRegistry accepts proposal_sink: vault and rejects anything else", () => {
  const base = [
    "loops:",
    "  - id: meeting-actions",
    "    domain: meetings",
    "    cadence: daily",
    "    enabled: true",
    "    phase: shadow",
  ];
  const ok = parseRegistry([...base, "    proposal_sink: vault", ""].join("\n"));
  assert.equal(ok.loops[0].proposal_sink, "vault");

  const okAbsent = parseRegistry([...base, ""].join("\n"));
  assert.equal(okAbsent.loops[0].proposal_sink, undefined);

  assert.throws(
    () => parseRegistry([...base, "    proposal_sink: shadow", ""].join("\n")),
    /proposal_sink must be "vault"/,
  );
});

test("free-text due stays on the ledger record, never the task due field or notes", () => {
  const dir = tmpdir();
  const entry = makeEntry({ id: "ma-2026-07-05-060", due: "beginning of next week" });
  const task = mintProposalFromLedgerEntry(entry, {
    sink: { dir, kind: "explicit" },
    loopId: "meeting-actions",
    vaultPath: dir,
    now: "2026-07-07T09:00:00.000Z",
  });
  assert.ok(task);
  assert.equal(task!.due, undefined);
  assert.equal(task!.body, "\n");

  const iso = makeEntry({ id: "ma-2026-07-05-061", due: "2026-07-14" });
  const isoTask = mintProposalFromLedgerEntry(iso, {
    sink: { dir, kind: "explicit" },
    loopId: "meeting-actions",
    vaultPath: dir,
    now: "2026-07-07T09:00:00.000Z",
  });
  assert.equal(isoTask!.due, "2026-07-14");
  assert.equal(isoTask!.body, "\n");
});

// ── Context remains canonical on the meeting action ─────────────────────────────────────────

const CONTEXT = "Sarah asked about volume pricing for the Q3 rollout and Justin offered to pull current numbers.";

test("entry context is not copied into the proposal's user-editable notes", () => {
  const dir = tmpdir();
  const opts = { sink: { dir, kind: "explicit" as const }, loopId: "meeting-actions", vaultPath: dir, now: "2026-07-08T09:00:00.000Z" };

  const alone = mintProposalFromLedgerEntry(makeEntry({ id: "ma-2026-07-05-070", context: CONTEXT }), opts);
  assert.equal(alone!.body, "\n");

  const both = mintProposalFromLedgerEntry(
    makeEntry({ id: "ma-2026-07-05-071", context: CONTEXT, due: "next sprint" }),
    opts,
  );
  assert.equal(both!.body, "\n");

  // The persisted task stays blank; the pane joins the canonical ledger entry at read time.
  const onDisk = parseTaskFile(fs.readFileSync(path.join(dir, `${both!.id}.md`), "utf-8"));
  assert.equal(onDisk.body, "\n");
});

test("all generated meeting proposals start with blank notes", () => {
  const dir = tmpdir();
  const opts = { sink: { dir, kind: "explicit" as const }, loopId: "meeting-actions", vaultPath: dir, now: "2026-07-08T09:00:00.000Z" };

  // makeEntry has NO context key — the production ledger's existing entry shape.
  const bare = mintProposalFromLedgerEntry(makeEntry({ id: "ma-2026-07-05-072" }), opts);
  assert.equal(bare!.body, "\n"); // empty body normalized, exactly as before

  const statedDue = mintProposalFromLedgerEntry(makeEntry({ id: "ma-2026-07-05-073", due: "next sprint" }), opts);
  assert.equal(statedDue!.body, "\n");

  // Whitespace-only context degrades to no-context, never an empty leading paragraph.
  const blank = mintProposalFromLedgerEntry(makeEntry({ id: "ma-2026-07-05-074", context: "   " }), opts);
  assert.equal(blank!.body, "\n");
});
