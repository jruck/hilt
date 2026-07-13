/**
 * Task file store — CRUD parameterized by base dir (vault root), shared by loop scripts and
 * API routes alike. Task files live at `<baseDir>/tasks/<id>.md`; proposals at
 * `<baseDir>/tasks/.proposals/<id>.md` (files from birth; approve renames into `tasks/`).
 */
import fs from "fs";
import path from "path";
import { atomicWriteFile, ensureDir } from "../library/utils";
import { reserveTaskId, reserveTaskIdAcross, taskIdSequencePath } from "./ids";
import { applyStatusTransition } from "./status";
import { parseTaskFile, serializeTaskFile } from "./task-file";
import type { TaskFile, TaskOrigin, TaskProvenance, TaskStatus } from "./types";

export function tasksDir(baseDir: string): string {
  return path.join(baseDir, "tasks");
}

export function proposalsDir(baseDir: string): string {
  return path.join(tasksDir(baseDir), ".proposals");
}

// Id validation lives in the pure task-id module (client components import it too);
// re-exported here so store consumers keep one import site.
import { isValidTaskId } from "./task-id";
export { isValidTaskId };

function assertValidTaskId(id: string): void {
  if (!isValidTaskId(id)) throw new Error(`invalid task id: ${JSON.stringify(id).slice(0, 80)}`);
}

export function taskPath(baseDir: string, id: string): string {
  assertValidTaskId(id);
  return path.join(tasksDir(baseDir), `${id}.md`);
}

export function proposalPath(baseDir: string, id: string): string {
  assertValidTaskId(id);
  return path.join(proposalsDir(baseDir), `${id}.md`);
}

/**
 * Parse every task file in a directory, sorted by filename (= by id). Unparseable files are
 * skipped — per-file degradation is the read-side contract (hydrate handles the weekly view) —
 * but never silently: each bad file warns once so corruption is visible in logs. Files whose
 * frontmatter id disagrees with the filename stem are skipped too (a copied/renamed file would
 * otherwise surface the same id twice).
 */
export function readTaskDir(dir: string): TaskFile[] {
  if (!fs.existsSync(dir)) return [];
  const tasks: TaskFile[] = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".md") || name.startsWith(".")) continue;
    const filePath = path.join(dir, name);
    try {
      const task = parseTaskFile(fs.readFileSync(filePath, "utf-8"));
      if (task.id !== name.slice(0, -3)) {
        console.warn(`[tasks] skipping ${filePath}: frontmatter id "${task.id}" does not match filename`);
        continue;
      }
      tasks.push(task);
    } catch (err) {
      // skip: a corrupt file must not take down the whole list — but say so
      console.warn(`[tasks] skipping unparseable file ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return tasks;
}

export function listTasks(baseDir: string): TaskFile[] {
  return readTaskDir(tasksDir(baseDir));
}

/** Read one accepted task by id. Missing OR unparseable file → null (proposals live in
 * proposals.ts). Corrupt degrades like the list path (readTaskDir) — "reads degrade to
 * missing, mutations throw" is the store contract; a bricked file must answer 404, not 500 —
 * but never silently: the warn makes corruption visible in logs (A7 degradation sweep). */
export function readTask(baseDir: string, id: string): TaskFile | null {
  const filePath = taskPath(baseDir, id);
  if (!fs.existsSync(filePath)) return null;
  try {
    return parseTaskFile(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.warn(`[tasks] treating unparseable file as missing ${filePath}: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
}

export function writeTask(baseDir: string, task: TaskFile): void {
  atomicWriteFile(taskPath(baseDir, task.id), serializeTaskFile(task));
}

/** Serialize will terminate the file with a newline anyway (an empty body still becomes one
 * blank line); normalizing up front keeps `parse(serialize(x))` an exact identity. */
function normalizeBody(body: string): string {
  return body.endsWith("\n") ? body : `${body}\n`;
}

/** A task can only be BORN proposed or accepted — done/dropped/in-progress are reached via
 * transitions (history discipline). */
export type CreatableTaskStatus = "proposed" | "accepted-me" | "accepted-agent";

const CREATABLE_STATUSES: readonly CreatableTaskStatus[] = ["proposed", "accepted-me", "accepted-agent"];

export interface CreateTaskInput {
  title: string;
  /** Default `accepted-me`. `proposed` writes into `tasks/.proposals/` (files from birth). */
  status?: CreatableTaskStatus;
  due?: string;
  projects?: string[];
  origin?: TaskOrigin;
  provenance?: TaskProvenance;
  body?: string;
  /** Injectable for deterministic tests; also seeds the id date. */
  created_at?: string;
}

export function createTask(baseDir: string, input: CreateTaskInput): TaskFile {
  if (typeof input.title !== "string" || !input.title.trim()) {
    throw new Error("task title must be a non-empty string");
  }
  const created_at = input.created_at ?? new Date().toISOString();
  const status = input.status ?? "accepted-me";
  if (!CREATABLE_STATUSES.includes(status)) {
    throw new Error(`task cannot be created with status "${status}" (allowed: ${CREATABLE_STATUSES.join(", ")})`);
  }
  // Reserve first: the high-water state survives proposal dismissal and serializes concurrent
  // creators. The task write stays EXCLUSIVE as defense against legacy/external writers.
  for (let attempt = 0; attempt < 10; attempt++) {
    const task: TaskFile = {
      id: reserveTaskId(baseDir, created_at.slice(0, 10)),
      title: input.title,
      status,
      created_at,
      body: normalizeBody(input.body ?? ""),
    };
    if (input.due !== undefined) task.due = input.due;
    if (input.projects !== undefined) task.projects = input.projects;
    if (input.origin !== undefined) task.origin = input.origin;
    if (input.provenance !== undefined) task.provenance = input.provenance;
    const filePath = status === "proposed" ? proposalPath(baseDir, task.id) : taskPath(baseDir, task.id);
    ensureDir(path.dirname(filePath));
    try {
      fs.writeFileSync(filePath, serializeTaskFile(task), { encoding: "utf-8", flag: "wx" });
      return task;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`could not mint a free task id in ${baseDir} after 10 attempts`);
}

/** A proposal is born `proposed` by definition — the input shape drops the status choice. */
export type CreateProposalInput = Omit<CreateTaskInput, "status">;

/**
 * Mint a proposal task file into an ARBITRARY sink dir (v3 unit A6): loop scripts write
 * proposals into shadow/eval sinks that are not the vault's canonical layout. The id is
 * collision-checked against the sink dir itself AND — when `collisionBaseDir` is given —
 * that base dir's canonical `tasks/` + `tasks/.proposals/`, so an id minted outside the
 * vault stays free inside it (graduation/approve never collides). Same exclusive-create
 * (`wx` + re-mint on EEXIST) discipline as createTask. Always status `proposed`.
 *
 * `createTask(baseDir, { status: "proposed", … })` remains the way to mint into the vault's
 * own `.proposals/`; this primitive exists for every OTHER sink.
 */
export function createProposalIn(
  dir: string,
  input: CreateProposalInput,
  options: { collisionBaseDir?: string; idDate?: string } = {},
): TaskFile {
  if (typeof input.title !== "string" || !input.title.trim()) {
    throw new Error("task title must be a non-empty string");
  }
  const created_at = input.created_at ?? new Date().toISOString();
  const collisionDirs = [dir];
  if (options.collisionBaseDir) {
    collisionDirs.push(tasksDir(options.collisionBaseDir), proposalsDir(options.collisionBaseDir));
  }
  const sequencePath = options.collisionBaseDir
    ? taskIdSequencePath(options.collisionBaseDir)
    : path.join(dir, ".id-sequences.json");
  for (let attempt = 0; attempt < 10; attempt++) {
    const task: TaskFile = {
      id: reserveTaskIdAcross(collisionDirs, sequencePath, options.idDate ?? created_at.slice(0, 10)),
      title: input.title,
      status: "proposed",
      created_at,
      body: normalizeBody(input.body ?? ""),
    };
    if (input.due !== undefined) task.due = input.due;
    if (input.projects !== undefined) task.projects = input.projects;
    if (input.origin !== undefined) task.origin = input.origin;
    if (input.provenance !== undefined) task.provenance = input.provenance;
    ensureDir(dir);
    try {
      fs.writeFileSync(path.join(dir, `${task.id}.md`), serializeTaskFile(task), { encoding: "utf-8", flag: "wx" });
      return task;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
    }
  }
  throw new Error(`could not mint a free proposal id in ${dir} after 10 attempts`);
}

/** Status changes must go through applyStatusTransition (history discipline), so `status` is
 * excluded here; identity fields likewise. Set a key to undefined to clear it. */
export type TaskPatch = Partial<Omit<TaskFile, "id" | "status" | "created_at">>;

/** Apply an ordinary editable-field patch without changing identity or lifecycle state. Shared
 * by accepted tasks and proposals so both use exactly the same title/body validation. */
export function applyTaskPatch(task: TaskFile, patch: TaskPatch): TaskFile {
  // A cleared/garbage title writes an unparseable file — the task bricks (reads degrade to
  // missing, mutations throw). Reject at the truth store, not just at polite callers.
  if ("title" in patch && (typeof patch.title !== "string" || !patch.title.trim())) {
    throw new Error(`task title must be a non-empty string (patching ${task.id})`);
  }
  const updated: TaskFile = { ...task, ...patch };
  if (patch.body !== undefined) updated.body = normalizeBody(patch.body);
  // Drop keys explicitly cleared via undefined so the object matches its parsed form exactly
  for (const key of Object.keys(updated) as (keyof TaskFile)[]) {
    if (updated[key] === undefined) delete updated[key];
  }
  return updated;
}

export function updateTask(baseDir: string, id: string, patch: TaskPatch): TaskFile {
  const task = readTask(baseDir, id);
  if (!task) throw new Error(`task not found: ${id}`);
  const updated = applyTaskPatch(task, patch);
  writeTask(baseDir, updated);
  return updated;
}

/**
 * The one status-change dance for accepted tasks (`tasks/` only — proposals go through
 * proposals.ts): read → applyStatusTransition (history line appended) → write. Consumers
 * (checkbox mirror, task PUT, verdict apply) must use this rather than re-implementing it,
 * so no path can forget the history line. `at` is injectable for deterministic tests.
 */
export function transitionTask(
  baseDir: string,
  id: string,
  next: TaskStatus,
  via: string,
  at?: string,
): TaskFile {
  const task = readTask(baseDir, id);
  if (!task) throw new Error(`task not found: ${id}`);
  const updated = applyStatusTransition(task, next, via, at);
  writeTask(baseDir, updated);
  return updated;
}
