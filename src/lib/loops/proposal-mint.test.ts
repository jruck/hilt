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
import { mintProposalFromLedgerEntry, resolveProposalSink } from "./proposal-mint";
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

test("free-text due goes to the body, never the due field (Invalid Date crash guard)", () => {
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
  assert.match(task!.body, /Due \(as stated\): beginning of next week/);

  const iso = makeEntry({ id: "ma-2026-07-05-061", due: "2026-07-14" });
  const isoTask = mintProposalFromLedgerEntry(iso, {
    sink: { dir, kind: "explicit" },
    loopId: "meeting-actions",
    vaultPath: dir,
    now: "2026-07-07T09:00:00.000Z",
  });
  assert.equal(isoTask!.due, "2026-07-14");
});
