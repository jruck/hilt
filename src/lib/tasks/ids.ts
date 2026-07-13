/**
 * Task id minting: `t-YYYYMMDD-NNN`, collision-checked across BOTH `tasks/` and
 * `tasks/.proposals/` of the given base dir. A durable per-date high-water mark keeps an id
 * reserved after its proposal file is dismissed, so stable identities can never be recycled.
 */
import fs from "fs";
import path from "path";
import { isValidTaskId } from "./task-id";

const SEQUENCE_VERSION = 1 as const;
const LOCK_TIMEOUT_MS = 2_000;
const LOCK_STALE_MS = 30_000;
const LOCK_POLL_MS = 10;

export interface TaskIdSequenceState {
  version: typeof SEQUENCE_VERSION;
  updated_at: string;
  high_water: Record<string, number>;
}

function emptyState(): TaskIdSequenceState {
  return { version: SEQUENCE_VERSION, updated_at: new Date(0).toISOString(), high_water: {} };
}

export function taskIdSequencePath(baseDir: string): string {
  return path.join(baseDir, "tasks", ".id-sequences.json");
}

function dateKey(date: Date | string): string {
  const iso = date instanceof Date ? date.toISOString().slice(0, 10) : date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) throw new Error(`invalid task id date: ${date}`);
  return iso.replace(/-/g, "");
}

function taskSequence(id: string): { date: string; sequence: number } | null {
  const match = id.match(/^t-(\d{8})-(\d{3,})$/);
  if (!match) return null;
  return { date: match[1], sequence: Number(match[2]) };
}

// Paths computed locally rather than imported from store.ts to avoid a module cycle
// (store imports mintTaskId).
function takenIdsInDirs(dirs: string[]): Set<string> {
  const taken = new Set<string>();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      if (name.endsWith(".md")) taken.add(name.slice(0, -3));
    }
  }
  return taken;
}

function readSequenceFile(filePath: string): TaskIdSequenceState {
  if (!fs.existsSync(filePath)) return emptyState();
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8")) as Partial<TaskIdSequenceState>;
  if (parsed.version !== SEQUENCE_VERSION || !parsed.high_water || typeof parsed.high_water !== "object") {
    throw new Error(`invalid task id sequence state: ${filePath}`);
  }
  const highWater: Record<string, number> = {};
  for (const [date, value] of Object.entries(parsed.high_water)) {
    if (!/^\d{8}$/.test(date) || !Number.isSafeInteger(value) || value < 0) {
      throw new Error(`invalid task id sequence entry ${date}: ${String(value)}`);
    }
    highWater[date] = value;
  }
  return {
    version: SEQUENCE_VERSION,
    updated_at: typeof parsed.updated_at === "string" ? parsed.updated_at : new Date(0).toISOString(),
    high_water: highWater,
  };
}

export function readTaskIdSequenceState(baseDir: string): TaskIdSequenceState {
  return readSequenceFile(taskIdSequencePath(baseDir));
}

function maxTakenSequence(dirs: string[], date: string): number {
  let max = 0;
  for (const id of takenIdsInDirs(dirs)) {
    const parsed = taskSequence(id);
    if (parsed?.date === date) max = Math.max(max, parsed.sequence);
  }
  return max;
}

function atomicWriteSequence(filePath: string, state: TaskIdSequenceState): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf-8", flag: "wx" });
    fs.renameSync(temp, filePath);
  } finally {
    try { fs.unlinkSync(temp); } catch { /* rename succeeded or another cleanup won */ }
  }
}

function processIsRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lockCanBeCleared(lockPath: string): boolean {
  try {
    const stat = fs.statSync(lockPath);
    if (Date.now() - stat.mtimeMs >= LOCK_STALE_MS) return true;
    const parsed = JSON.parse(fs.readFileSync(lockPath, "utf-8")) as { pid?: unknown };
    return typeof parsed.pid === "number" && !processIsRunning(parsed.pid);
  } catch {
    return true;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function withSequenceLock<T>(sequencePath: string, run: () => T): T {
  const lockPath = `${sequencePath}.lock`;
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (true) {
    try {
      fs.writeFileSync(lockPath, `${JSON.stringify({ pid: process.pid, started_at: new Date().toISOString() })}\n`, {
        encoding: "utf-8",
        flag: "wx",
      });
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (lockCanBeCleared(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch { /* lost the cleanup race */ }
        continue;
      }
      if (Date.now() - started >= LOCK_TIMEOUT_MS) throw new Error(`task id allocator is locked: ${sequencePath}`);
      sleepSync(LOCK_POLL_MS);
    }
  }
  try {
    return run();
  } finally {
    try { fs.unlinkSync(lockPath); } catch { /* a stale-lock cleanup already removed it */ }
  }
}

/**
 * Mint the next free task id treating EVERY given dir as taken-id territory. The A6 proposal
 * sinks use this: a shadow/eval sink dir plus the vault's canonical `tasks/` + `tasks/.proposals/`
 * (an id minted outside the vault must still be free inside it, so graduation never collides).
 */
export function mintTaskIdAcross(dirs: string[], date: Date | string = new Date()): string {
  const ymd = dateKey(date);
  const taken = takenIdsInDirs(dirs);
  let seq = 1;
  // Padding widens past 999 rather than failing (a 1000-task day is a data bug, not a crash)
  while (taken.has(`t-${ymd}-${String(seq).padStart(3, "0")}`)) seq++;
  return `t-${ymd}-${String(seq).padStart(3, "0")}`;
}

/** Mint the next free task id for the given date (YYYY-MM-DD or Date; defaults to today). */
export function mintTaskId(baseDir: string, date: Date | string = new Date()): string {
  const tasksDir = path.join(baseDir, "tasks");
  const dirs = [tasksDir, path.join(tasksDir, ".proposals")];
  const ymd = dateKey(date);
  const state = readTaskIdSequenceState(baseDir);
  const next = Math.max(state.high_water[ymd] ?? 0, maxTakenSequence(dirs, ymd)) + 1;
  return `t-${ymd}-${String(next).padStart(3, "0")}`;
}

/** Atomically advance a durable sequence and return the permanently reserved id. */
export function reserveTaskIdAcross(
  dirs: string[],
  sequencePath: string,
  date: Date | string = new Date(),
): string {
  const ymd = dateKey(date);
  return withSequenceLock(sequencePath, () => {
    const state = readSequenceFile(sequencePath);
    const next = Math.max(state.high_water[ymd] ?? 0, maxTakenSequence(dirs, ymd)) + 1;
    state.high_water[ymd] = next;
    state.updated_at = new Date().toISOString();
    atomicWriteSequence(sequencePath, state);
    return `t-${ymd}-${String(next).padStart(3, "0")}`;
  });
}

export function reserveTaskId(baseDir: string, date: Date | string = new Date()): string {
  const root = path.join(baseDir, "tasks");
  return reserveTaskIdAcross([root, path.join(root, ".proposals")], taskIdSequencePath(baseDir), date);
}

/** Seed/migrate the high-water state from identities that may no longer have files. */
export function seedTaskIdSequences(
  baseDir: string,
  ids: Iterable<string>,
  at = new Date().toISOString(),
): TaskIdSequenceState {
  const sequencePath = taskIdSequencePath(baseDir);
  return withSequenceLock(sequencePath, () => {
    const state = readSequenceFile(sequencePath);
    for (const id of ids) {
      if (!isValidTaskId(id)) throw new Error(`invalid task id while seeding sequences: ${id}`);
      const parsed = taskSequence(id)!;
      state.high_water[parsed.date] = Math.max(state.high_water[parsed.date] ?? 0, parsed.sequence);
    }
    state.updated_at = at;
    atomicWriteSequence(sequencePath, state);
    return state;
  });
}
