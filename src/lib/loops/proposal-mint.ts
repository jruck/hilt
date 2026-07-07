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
import path from "path";
import { createProposalIn, proposalsDir } from "../tasks/store";
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
}

/**
 * Mint one proposal file from a ledger entry, stamping `entry.task_id` (in memory — the caller's
 * ledger write persists it). Returns the minted TaskFile, or null when the entry already carries
 * a `task_id` (never re-mint: the stamp survives loop re-runs AND deliberate file deletion).
 *
 * Mapping: action → title; first citation's anchor+source → provenance { quote, source };
 * meeting path + ledger id + loop id → origin; due carries when present.
 */
export function mintProposalFromLedgerEntry(entry: LedgerEntry, options: MintProposalOptions): TaskFile | null {
  if (entry.task_id) return null;

  const rawDue = (entry.due ?? "").trim();
  const isoDue = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : null;
  const statedDue = rawDue && !isoDue ? rawDue : null;

  const origin: TaskOrigin = {
    loop: options.loopId,
    meeting: entry.opened_from,
    item_id: entry.id,
  };
  const citation = entry.citations[0];
  const provenance: TaskProvenance | undefined = citation?.anchor
    ? { quote: citation.anchor, source: citation.source }
    : undefined;

  const task = createProposalIn(
    options.sink.dir,
    {
      title: entry.action,
      // Extractor dues are free text ~15% of the time ("next sprint", "Q3 2026"). The task
      // contract expects YYYY-MM-DD in `due` (line renders, date badges); non-ISO stated dues
      // land in the body instead so the information survives without corrupting the field.
      ...(isoDue ? { due: isoDue } : {}),
      ...(statedDue ? { body: `Due (as stated): ${statedDue}\n` } : {}),
      origin,
      ...(provenance ? { provenance } : {}),
      ...(options.now ? { created_at: options.now } : {}),
    },
    { collisionBaseDir: options.vaultPath },
  );
  entry.task_id = task.id;
  return task;
}
