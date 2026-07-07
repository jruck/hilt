/**
 * Weekly list v2 helpers — PURE string/line functions only (file IO stays in callers; the v1
 * parser in src/lib/bridge/weekly-parser.ts is untouched). A v2 line is minimal:
 * `- [ ] [Title](tasks/t-….md) [due:: YYYY-MM-DD]` — checkbox + title→task-file link + due
 * badge. The task file is the source of truth; the checkbox is a write-through mirror.
 */
import type { TaskFile, WeeklyV2Line } from "./types";

export const WEEKLY_LIST_FORMAT_KEY = "list_format";

/**
 * Version marker decides the parser: `list_format: 2` → v2, anything else → v1 (legacy).
 * The bridge's line-based frontmatter parser keeps YAML quote characters in raw values, so a
 * hand-edited `list_format: "2"` arrives as the string `"2"` INCLUDING quotes — treat it as v2
 * too, else every checkbox click on that list silently diverges from the task files.
 */
export function listFormatFromFrontmatter(fm: Record<string, unknown>): 1 | 2 {
  const raw = fm[WEEKLY_LIST_FORMAT_KEY];
  const value = typeof raw === "string" ? raw.replace(/^["']|["']$/g, "") : raw;
  return value === 2 || value === "2" ? 2 : 1;
}

// Uppercase [X] is accepted as checked — Obsidian/hand edits use it interchangeably.
const TASK_LINE_RE = /^- \[([ xX])\] (.+)$/;
const DUE_RE = /\[due::\s*(\d{4}-\d{2}-\d{2})\]/;

export function isWeeklyV2TaskLine(line: string): boolean {
  return TASK_LINE_RE.test(line);
}

/**
 * The LAST markdown link on the line. Titles rendered by renderWeeklyV2Line may themselves
 * contain "](" (e.g. "Weird ](hack) title"), so the first-link regex would hand back a
 * truncated title and a bogus taskPath — the real task-file link is always the last one.
 */
function lastLink(rest: string): { title: string; taskPath: string } | null {
  const open = rest.lastIndexOf("](");
  if (open === -1) return null;
  const close = rest.indexOf(")", open + 2);
  if (close === -1) return null;
  const start = rest.indexOf("[");
  if (start === -1 || start >= open) return null;
  return { title: rest.slice(start + 1, open), taskPath: rest.slice(open + 2, close) };
}

/**
 * Parse one v2 task line: checked state, title (last link's text), last link target as
 * taskPath, inline due field. Non-task lines → null. A task line without a link still parses
 * (taskPath null) — hydrate degrades it, never drops it.
 */
export function parseWeeklyV2Line(line: string): WeeklyV2Line | null {
  const match = line.match(TASK_LINE_RE);
  if (!match) return null;
  const checked = match[1] !== " ";
  let rest = match[2];
  const dueMatch = rest.match(DUE_RE);
  const due = dueMatch ? dueMatch[1] : null;
  if (dueMatch) rest = rest.replace(dueMatch[0], "").trim();
  const link = lastLink(rest);
  if (!link) return { raw: line, checked, title: rest.trim(), taskPath: null, due };
  return { raw: line, checked, title: link.title, taskPath: link.taskPath, due };
}

/** Titles pass through the line format verbatim except where they'd break it: newlines would
 * split the line, and a literal `[due:: …]` in the title would hijack the due parse. An
 * all-whitespace title collapses the link markup entirely, so fall back to the task id. */
function sanitizeTitle(task: TaskFile): string {
  const title = task.title.replace(/[\r\n]+/g, " ").replace(/\[due::[^\]]*\]/g, "");
  return title.trim() ? title : task.id;
}

/** Render a v2 line from a task file. Checked mirrors `status === "done"`. */
export function renderWeeklyV2Line(task: TaskFile, taskPath: string): string {
  const checkbox = task.status === "done" ? "[x]" : "[ ]";
  const due = task.due ? ` [due:: ${task.due}]` : "";
  return `- ${checkbox} [${sanitizeTitle(task)}](${taskPath})${due}`;
}

/** Mirror a checkbox state into an existing line, leaving everything else byte-untouched. */
export function mirrorCheckbox(line: string, checked: boolean): string {
  return line.replace(/^- \[[ xX]\]/, checked ? "- [x]" : "- [ ]");
}
