/**
 * The task status machine. Every transition appends a body ledger line under `## History`
 * (created at the body end when absent) — the task file carries its own audit trail.
 */
import type { TaskFile, TaskStatus } from "./types";

/**
 * Allowed transitions. `done → in-progress` is the reopen path (the weekly v2 checkbox
 * mirror: unchecking a done task). `dropped` is terminal; dismissed proposals are deleted,
 * not transitioned, so `proposed → dropped` exists only for ledger-side bookkeeping.
 *
 * `accepted-* → done` (skipping `in-progress`) is a DELIBERATE deviation from a strict
 * linear machine: the weekly checkbox marks an accepted task done directly — nobody flips
 * a task to in-progress before ticking it off.
 */
export const TASK_TRANSITIONS: Record<TaskStatus, readonly TaskStatus[]> = {
  proposed: ["accepted-me", "accepted-agent", "dropped"],
  "accepted-me": ["in-progress", "done", "dropped"],
  "accepted-agent": ["in-progress", "done", "dropped"],
  "in-progress": ["done", "dropped"],
  done: ["in-progress"],
  dropped: [],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/**
 * Append a ledger line to the `## History` section, creating the section at the body end
 * when absent. Inserts at the end of the section (before any later `##` heading), leaving
 * the rest of the body byte-untouched.
 */
function appendHistoryLine(body: string, line: string): string {
  const lines = body.split("\n");
  let headingIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s+History\s*$/.test(lines[i])) {
      headingIdx = i;
      break;
    }
  }
  if (headingIdx === -1) {
    const base = body.replace(/\s+$/, "");
    return base ? `${base}\n\n## History\n\n${line}\n` : `## History\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // Walk back over trailing blank lines so the entry lands after the last existing one
  let insert = end;
  while (insert > headingIdx + 1 && lines[insert - 1].trim() === "") insert--;
  const inserted = insert === headingIdx + 1 ? ["", line] : [line];
  lines.splice(insert, 0, ...inserted);
  return lines.join("\n");
}

/**
 * Apply a status transition, returning a new TaskFile with the history line
 * `- <ISO8601> status: <a> → <b> (via <via>)` appended. Illegal transitions throw.
 * `at` is injectable for deterministic tests.
 */
export function applyStatusTransition(
  task: TaskFile,
  next: TaskStatus,
  via: string,
  at: string = new Date().toISOString(),
): TaskFile {
  if (!canTransition(task.status, next)) {
    throw new Error(`illegal task status transition for ${task.id}: ${task.status} → ${next}`);
  }
  const line = `- ${at} status: ${task.status} → ${next} (via ${via})`;
  return { ...task, status: next, body: appendHistoryLine(task.body, line) };
}
