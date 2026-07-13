/**
 * Proposal minting (v3 unit A6): a meeting-loop ask becomes a task PROPOSAL FILE at escalation
 * time — full task-file format, status `proposed`, living in whichever sink the run resolves.
 *
 * Two jobs, both pure of loop specifics:
 *  - resolveProposalSink: the ONE precedence rule for where proposal files land. CLI flags beat
 *    the registry beats the shadow default, so the eval harness (`--ledger-home`) is isolated
 *    with zero changes and the registry `proposal_sink: "vault"` flip is the auditable
 *    graduation of just this one write.
 *  - mintProposalFromLedgerEntry: LedgerEntry → proposal file. Idempotency is the ledger's
 *    `task_id` stamp — an entry that has one NEVER re-mints (loop re-runs are free; a dismissed
 *    proposal's deleted file must not resurrect).
 *
 * Single-writer map: this module WRITES proposal files only at mint time (via the tasks store);
 * every later file effect (approve/dismiss/revise) belongs to the verdict route. The ledger
 * stamp rides the loop's own ledger persistence — this module only mutates the in-memory entry.
 */
import fs from "fs";
import path from "path";
import { readProposal } from "../tasks/proposals";
import { serializeTaskFile } from "../tasks/task-file";
import { createProposalIn, listTasks, proposalPath, proposalsDir, readTaskDir, taskPath } from "../tasks/store";
import type { TaskFile, TaskOrigin, TaskProvenance } from "../tasks/types";
import type { LedgerEntry } from "./meeting-ledger";

export type ProposalSinkKind = "explicit" | "ledger-home" | "vault" | "loop-home";

export interface ProposalSink {
  /** Absolute dir proposal files are written into. */
  dir: string;
  /** Which precedence rung resolved it (surfaced in run output for auditability). */
  kind: ProposalSinkKind;
}

export interface ResolveProposalSinkInput {
  /** `--proposals-dir` flag — explicit, beats everything. */
  proposalsDirFlag?: string | null;
  /** `--ledger-home` flag — eval/sandbox isolation: proposals ride under the same home. */
  ledgerHomeFlag?: string | null;
  /** The registry loop's `proposal_sink` key ("vault" is the only recognized value). */
  registryProposalSink?: string;
  vaultPath: string;
  /** The loop's resolved home (sandbox or vault) — the shadow default sink's parent. */
  loopHome: string;
}

/**
 * Sink precedence (implementation plan A6, exactly):
 *   1. `--proposals-dir <dir>`            → that dir
 *   2. `--ledger-home <home>` given       → `<home>/proposals/`
 *   3. registry `proposal_sink: "vault"`  → `<vault>/tasks/.proposals/`
 *   4. otherwise                          → `<loopHome>/proposals/` (shadow default)
 */
export function resolveProposalSink(input: ResolveProposalSinkInput): ProposalSink {
  if (input.proposalsDirFlag) {
    return { dir: input.proposalsDirFlag, kind: "explicit" };
  }
  if (input.ledgerHomeFlag) {
    return { dir: path.join(input.ledgerHomeFlag, "proposals"), kind: "ledger-home" };
  }
  if (input.registryProposalSink === "vault") {
    return { dir: proposalsDir(input.vaultPath), kind: "vault" };
  }
  return { dir: path.join(input.loopHome, "proposals"), kind: "loop-home" };
}

export interface MintProposalOptions {
  sink: ProposalSink;
  /** The emitting loop's id — becomes `origin.loop`. */
  loopId: string;
  /** Collision-check base: ids minted into ANY sink stay free in the vault's canonical dirs. */
  vaultPath: string;
  /** Injectable created_at (the run's `now`) for deterministic tests. */
  now?: string;
  /** Local loop date used by the task identity; timestamps remain UTC. */
  idDate?: string;
}

function proposalFieldsFromLedgerEntry(entry: LedgerEntry, loopId: string): {
  title: string;
  due?: string;
  origin: TaskOrigin;
  provenance?: TaskProvenance;
} {
  const rawDue = (entry.due ?? "").trim();
  const isoDue = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : null;
  const citation = entry.citations[0];
  return {
    title: entry.action,
    ...(isoDue ? { due: isoDue } : {}),
    origin: { loop: loopId, meeting: entry.opened_from, item_id: entry.id },
    ...(citation?.anchor ? { provenance: { quote: citation.anchor, source: citation.source } } : {}),
  };
}

/**
 * Mint one proposal file from a ledger entry, stamping `entry.task_id` (in memory — the caller's
 * ledger write persists it). Returns the minted TaskFile, or null when the entry already carries
 * a `task_id` (never re-mint: the stamp survives loop re-runs AND deliberate file deletion).
 *
 * Mapping: action → title; first citation's anchor+source → provenance { quote, source };
 * meeting path + ledger id + loop id → origin; an ISO due date carries when present. Generated
 * context and free-text due language remain canonical on the linked meeting action instead of
 * being copied into the task's user-editable notes.
 */
export function mintProposalFromLedgerEntry(entry: LedgerEntry, options: MintProposalOptions): TaskFile | null {
  if (entry.task_id) return null;

  // Reconcile the file-first half of a prior interrupted mint before allocating another id. The
  // proposal write is necessarily external to SQLite; stable origin identity closes that crash
  // window and makes the next transaction idempotent.
  const candidates = [
    ...readTaskDir(options.sink.dir),
    ...readTaskDir(proposalsDir(options.vaultPath)),
    ...listTasks(options.vaultPath),
  ].filter((task, index, all) => all.findIndex((value) => value.id === task.id) === index)
    .filter((task) => task.origin?.loop === options.loopId && task.origin?.item_id === entry.id);
  if (candidates.length > 1) {
    throw new Error(`multiple proposal/task files claim ledger origin ${entry.id}: ${candidates.map((task) => task.id).join(", ")}`);
  }
  if (candidates[0]) {
    entry.task_id = candidates[0].id;
    return candidates[0];
  }

  const task = createProposalIn(
    options.sink.dir,
    {
      ...proposalFieldsFromLedgerEntry(entry, options.loopId),
      ...(options.now ? { created_at: options.now } : {}),
    },
    { collisionBaseDir: options.vaultPath, ...(options.idDate ? { idDate: options.idDate } : {}) },
  );
  entry.task_id = task.id;
  return task;
}

export interface RestoreProposalOptions {
  vaultPath: string;
  loopId: string;
  now?: string;
}

export interface RestoreProposalResult {
  task: TaskFile;
  created: boolean;
}

/** Recreate a dismissed proposal under its original task id. This is intentionally separate
 * from ordinary minting: the ledger's task_id idempotency stamp must remain intact. */
export function restoreProposalFromLedgerEntry(
  entry: LedgerEntry,
  options: RestoreProposalOptions,
): RestoreProposalResult {
  const id = entry.task_id;
  if (!id) throw new Error(`dismissed ledger entry has no task_id: ${entry.id}`);
  if (fs.existsSync(taskPath(options.vaultPath, id))) {
    throw new Error(`task already exists, cannot restore dismissed proposal: ${id}`);
  }

  const existing = readProposal(options.vaultPath, id);
  if (existing) {
    if (existing.origin?.loop !== options.loopId || existing.origin?.item_id !== entry.id) {
      throw new Error(`proposal id collision while restoring ${id}`);
    }
    return { task: existing, created: false };
  }

  const fields = proposalFieldsFromLedgerEntry(entry, options.loopId);
  const restoredAt = options.now ?? new Date().toISOString();
  const history = `## History\n\n- ${restoredAt} restored to proposed (via dismissed recovery)\n`;
  const task: TaskFile = {
    id,
    title: fields.title,
    status: "proposed",
    ...(fields.due ? { due: fields.due } : {}),
    origin: fields.origin,
    created_at: entry.opened_at,
    ...(fields.provenance ? { provenance: fields.provenance } : {}),
    body: history,
  };
  const filePath = proposalPath(options.vaultPath, id);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  try {
    fs.writeFileSync(filePath, serializeTaskFile(task), { encoding: "utf-8", flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const raced = readProposal(options.vaultPath, id);
    if (!raced || raced.origin?.loop !== options.loopId || raced.origin?.item_id !== entry.id) {
      throw new Error(`proposal id collision while restoring ${id}`);
    }
    return { task: raced, created: false };
  }
  return { task, created: true };
}
