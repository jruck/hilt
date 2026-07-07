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
import { hydrateWeeklyV2Line } from "../tasks/hydrate";
import { parseWeeklyV2Line, taskIdFromTaskPath } from "../tasks/weekly-v2";
import type { BridgeTask } from "../types";

// Moved to the pure weekly-v2 module (A4: client components branch on v2-ness too);
// re-exported so server-side consumers keep importing it from the view lib.
export { taskIdFromTaskPath };

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
 * Insert a new task line at the top of the weekly task section — the same spot v1's addTask
 * puts new tasks (first line under `## Tasks`, before any `###` group heading) — as a
 * SURGICAL line splice (the v1 serializer never touches v2 content). Heading-less lists
 * (new-format fallback) insert directly before the first task line or `###` group heading.
 * Returns null when no anchor exists — the caller treats that as a cosmetic mirror failure
 * (the task file, the truth, already exists).
 */
export function insertWeeklyV2Line(content: string, line: string): string | null {
  const lines = content.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end !== -1) bodyStart = end + 1;
  }
  const heading = lines.findIndex((l, i) => i >= bodyStart && l.trim() === "## Tasks");
  if (heading !== -1) {
    // Skip blank lines directly under the heading so the new task doesn't orphan a gap.
    let at = heading + 1;
    while (at < lines.length && lines[at].trim() === "") at++;
    lines.splice(at, 0, line);
    return lines.join("\n");
  }
  for (let i = bodyStart; i < lines.length; i++) {
    if (/^###\s+/.test(lines[i]) || /^- \[[ xX]\]\s/.test(lines[i])) {
      lines.splice(i, 0, line);
      return lines.join("\n");
    }
  }
  return null;
}

/**
 * Insert a new task line at the top of a `### <heading>` SECTION inside the Tasks region —
 * the "Ready for agents" splice (accepted-agent verdicts join the week toward the bottom, not
 * the top-of-Tasks spot Justin's own tasks take). Heading text matches case-insensitively.
 * Missing section → it is CREATED at the bottom of the Tasks region (before the next `## `
 * heading or EOF); content with no `## Tasks` at all degrades to appending the section at the
 * end of the body — degrade, never corrupt, so this always returns content (no null case).
 */
export function insertWeeklyV2LineInSection(content: string, line: string, heading: string): string {
  const lines = content.split("\n");
  let bodyStart = 0;
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, i) => i > 0 && l.trim() === "---");
    if (end !== -1) bodyStart = end + 1;
  }
  const tasksHeading = lines.findIndex((l, i) => i >= bodyStart && l.trim() === "## Tasks");
  const regionStart = tasksHeading !== -1 ? tasksHeading + 1 : bodyStart;
  // The Tasks region ends at the next `## ` heading; without a `## Tasks` anchor the whole
  // remaining body is the region (the fallback appends the section at the end of it).
  let regionEnd = lines.length;
  if (tasksHeading !== -1) {
    const next = lines.findIndex((l, i) => i >= regionStart && /^##\s+/.test(l) && !/^###/.test(l));
    if (next !== -1) regionEnd = next;
  }
  const wanted = heading.trim().toLowerCase();
  for (let i = regionStart; i < regionEnd; i++) {
    const match = lines[i].match(/^###\s+(.*?)\s*$/);
    if (match && match[1].toLowerCase() === wanted) {
      // Section exists: splice at its top, skipping blank lines under the heading (same
      // no-orphaned-gap convention as insertWeeklyV2Line).
      let at = i + 1;
      while (at < regionEnd && lines[at].trim() === "") at++;
      lines.splice(at, 0, line);
      return lines.join("\n");
    }
  }
  // Section missing: create it at the bottom of the region, before any trailing blank lines
  // (so the file's trailing newline convention survives untouched).
  let insertAt = regionEnd;
  while (insertAt > regionStart && lines[insertAt - 1].trim() === "") insertAt--;
  lines.splice(insertAt, 0, "", `### ${heading}`, line);
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
