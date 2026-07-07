/**
 * Weekly list v2 — the list is a VIEW over task files (v3 unit A3).
 *
 * Read side: hydrate parsed v2 task lines from their task files — title/status/due/projects
 * come from the FILE when present; a missing/unreadable file degrades to the raw line's own
 * data with `missing: true`, never dropping the line.
 *
 * Write side: surgical single-line replacement in the weekly content (mirror a checkbox,
 * re-render a title line). The task file is written FIRST by the caller; these helpers only
 * touch the one mirrored line — a failed mirror is cosmetic and self-heals on the next
 * hydrated read, because the file is the source of truth.
 */
import path from "path";
import { hydrateWeeklyV2Line } from "../tasks/hydrate";
import { isValidTaskId } from "../tasks/store";
import { parseWeeklyV2Line } from "../tasks/weekly-v2";
import type { BridgeTask } from "../types";

/**
 * The task-store id for a weekly line's taskPath, or null when the line doesn't point into
 * the canonical store (`tasks/<t-…>.md`). Mutations require a store-resolvable path — the
 * store's own id validation is the path-traversal guard.
 */
export function taskIdFromTaskPath(taskPath: string | null | undefined): string | null {
  if (!taskPath) return null;
  const normalized = path.posix.normalize(taskPath.replace(/\\/g, "/"));
  const match = normalized.match(/^tasks\/([^/]+)\.md$/);
  if (!match || !isValidTaskId(match[1])) return null;
  return match[1];
}

/**
 * Join parsed v2 weekly tasks with their task files. File wins for title/done/due/projects;
 * per-line degradation (missing/unreadable/linkless line) keeps the parser's own line data
 * and flags `missing: true`. Purely additive to the v1 response shape.
 */
export function hydrateWeeklyTasks(baseDir: string, tasks: BridgeTask[]): BridgeTask[] {
  return tasks.map((task) => {
    const line = parseWeeklyV2Line(task.rawLines[0] ?? "");
    if (!line) return { ...task, missing: true };
    const hydrated = hydrateWeeklyV2Line(baseDir, line);
    if (hydrated.missing || !hydrated.task) return { ...task, missing: true };
    const file = hydrated.task;
    return {
      ...task,
      title: file.title,
      done: file.status === "done",
      dueDate: file.due ?? null,
      projectPaths: file.projects ?? [],
      projectPath: file.projects?.[0] ?? null,
      missing: false,
    };
  });
}

/**
 * Replace ONE line of the weekly content, verifying the line is where the parse said it was
 * (`expected` at 1-based `startLine`); falls back to a unique whole-line search when the
 * position is stale. Preserves the line's leading indentation. Returns null when the line
 * can't be located unambiguously — the caller treats that as a cosmetic mirror failure.
 */
export function replaceWeeklyLine(
  content: string,
  startLine: number | undefined,
  expected: string,
  replacement: string,
): string | null {
  const lines = content.split("\n");
  const index = locateWeeklyLine(lines, startLine, expected);
  if (index === null) return null;
  const indent = expected.match(/^[\t ]*/)?.[0] ?? "";
  lines[index] = indent + replacement.replace(/^[\t ]*/, "");
  return lines.join("\n");
}

/**
 * Remove a task's lines from the weekly content (v2 delete: the list is a view; the task file
 * keeps the record). Same locate-and-verify contract as replaceWeeklyLine; removes the task
 * line plus any CONSECUTIVE following lines that match the task's remaining rawLines (hand-added
 * sub-bullets ride along instead of orphaning). Returns null when the line can't be located.
 */
export function removeWeeklyLines(
  content: string,
  startLine: number | undefined,
  rawLines: string[],
): string | null {
  if (rawLines.length === 0) return null;
  const lines = content.split("\n");
  const index = locateWeeklyLine(lines, startLine, rawLines[0]);
  if (index === null) return null;
  let count = 1;
  while (count < rawLines.length && lines[index + count] === rawLines[count]) count++;
  lines.splice(index, count);
  return lines.join("\n");
}

function locateWeeklyLine(lines: string[], startLine: number | undefined, expected: string): number | null {
  if (startLine !== undefined && lines[startLine - 1] === expected) return startLine - 1;
  const matches = lines.reduce<number[]>((acc, l, i) => (l === expected ? [...acc, i] : acc), []);
  return matches.length === 1 ? matches[0] : null;
}
