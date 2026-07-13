/**
 * Proposal lifecycle (scope §3 storage truth): a proposal is a task file from birth in
 * `tasks/.proposals/`. Approve = status transition + MOVE into `tasks/` (dest written first,
 * then src unlinked — the id is stable). Dismiss = unlink; the caller's loop ledger remembers.
 * Revise = note appended, file stays proposed.
 */
import fs from "fs";
import { atomicWriteFile } from "../library/utils";
import { applyStatusTransition } from "./status";
import { parseTaskFile, serializeTaskFile } from "./task-file";
import { applyTaskPatch, proposalPath, proposalsDir, readTaskDir, taskPath } from "./store";
import type { TaskPatch } from "./store";
import type { TaskFile } from "./types";

export function listProposals(baseDir: string): TaskFile[] {
  return readTaskDir(proposalsDir(baseDir));
}

/** Read one proposal by id. Missing OR unparseable file → null — same degrade-with-a-warn
 * contract as store.readTask (A7 degradation sweep: a corrupt proposal must not 500 the
 * `/api/tasks/[id]` probe or flip notFoundResponse's 409 into a crash). */
export function readProposal(baseDir: string, id: string): TaskFile | null {
  const filePath = proposalPath(baseDir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseTaskFile(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`[tasks] treating unparseable proposal as missing ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

/** Write one proposal without changing its lifecycle state. Exported for guarded maintenance
 * tools that operate on task Markdown while preserving proposal identity. */
export function writeProposal(baseDir: string, task: TaskFile): void {
  if (task.status !== "proposed") {
    throw new Error(`cannot write non-proposed task to proposal store: ${task.id}`);
  }
  atomicWriteFile(proposalPath(baseDir, task.id), serializeTaskFile(task));
}

/** Proposals are real task files, so their title and freeform notes stay editable before a
 * verdict. Lifecycle changes still belong exclusively to approve/dismiss/revise. */
export function updateProposal(baseDir: string, id: string, patch: TaskPatch): TaskFile {
  const task = readProposal(baseDir, id);
  if (!task) throw new Error(`proposal not found: ${id}`);
  const updated = applyTaskPatch(task, patch);
  writeProposal(baseDir, updated);
  return updated;
}

export interface ApproveOptions {
  status: "accepted-me" | "accepted-agent";
  via: string;
  /** Injectable history timestamp for deterministic tests. */
  at?: string;
}

/**
 * Approve: transition + rename into `tasks/`. Throws when the proposal is missing or the
 * target id already exists in `tasks/` — callers wanting idempotency check first (A6's
 * `file_effect: already-applied`).
 */
export function approveProposal(baseDir: string, id: string, options: ApproveOptions): TaskFile {
  const src = proposalPath(baseDir, id);
  if (!fs.existsSync(src)) throw new Error(`proposal not found: ${id}`);
  const dest = taskPath(baseDir, id);
  if (fs.existsSync(dest)) throw new Error(`task already exists, cannot approve proposal: ${id}`);
  const task = parseTaskFile(fs.readFileSync(src, "utf-8"));
  const updated = applyStatusTransition(task, options.status, options.via, options.at);
  // Crash-safe order: land the TRANSITIONED content at the dest first, then remove the src.
  // (The old write-src-then-rename order could crash in between, wedging an accepted-* file
  // in .proposals/ where re-approve throws an illegal transition forever. With this order a
  // crash between the two steps leaves src still `proposed` + dest present — re-approve hits
  // the already-exists precheck above, which callers treat as already-applied.)
  atomicWriteFile(dest, serializeTaskFile(updated));
  fs.unlinkSync(src);
  return updated;
}

/** Dismiss: unlink the file (the ledger is the memory). Returns false when already gone. */
export function dismissProposal(baseDir: string, id: string): boolean {
  const src = proposalPath(baseDir, id);
  if (!fs.existsSync(src)) return false;
  fs.unlinkSync(src);
  return true;
}

/** Revise: append the note to the body; the file stays proposed, in place. */
export function reviseProposal(baseDir: string, id: string, note: string): TaskFile {
  const src = proposalPath(baseDir, id);
  if (!fs.existsSync(src)) throw new Error(`proposal not found: ${id}`);
  const task = parseTaskFile(fs.readFileSync(src, "utf-8"));
  const base = task.body.replace(/\s+$/, "");
  const body = base ? `${base}\n\n${note.trim()}\n` : `${note.trim()}\n`;
  const updated: TaskFile = { ...task, body };
  atomicWriteFile(src, serializeTaskFile(updated));
  return updated;
}
