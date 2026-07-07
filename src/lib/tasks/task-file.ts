/**
 * Parse/serialize one task markdown file. Round-trip byte fidelity is the contract:
 * `parse(serialize(x))` equals `x`, and `serialize(parse(text)) === text` for files we wrote
 * (canonical key order + js-yaml's default dump is deterministic and idempotent). Unknown
 * frontmatter keys survive in `extra`; the body is never reformatted (serialize only ensures
 * the file ends with a newline).
 */
import matter from "gray-matter";
import yaml from "js-yaml";
import { TASK_STATUSES } from "./types";
import type { TaskFile, TaskOrigin, TaskProvenance, TaskStatus } from "./types";

/** Canonical frontmatter key order — files we write always use this order (extras follow). */
const KNOWN_KEYS = ["id", "title", "status", "due", "projects", "origin", "created_at", "provenance"];

/** Unquoted yaml dates load as Date objects (foreign/hand edits) — coerce back to strings. */
function dateString(value: unknown, length: number): string {
  if (value instanceof Date) return value.toISOString().slice(0, length);
  return String(value);
}

export function parseTaskFile(text: string): TaskFile {
  const parsed = matter(text);
  // Deep clone: gray-matter keeps a content-keyed cache and hands the SAME .data object to
  // repeat parses — a shallow clone would still alias nested objects (origin/provenance/extra),
  // so a caller mutating one parse result would silently corrupt every later parse of the
  // same text. structuredClone severs all of it (and preserves Date values from foreign yaml).
  const data: Record<string, unknown> = structuredClone(parsed.data);

  const id = data.id;
  const title = data.title;
  const status = data.status;
  if (typeof id !== "string" || !id) throw new Error("task file missing frontmatter id");
  if (typeof title !== "string" || !title) throw new Error(`task file ${id} missing frontmatter title`);
  if (typeof status !== "string" || !TASK_STATUSES.includes(status as TaskStatus)) {
    throw new Error(`task file ${id} has invalid status: ${String(status)}`);
  }
  if (data.created_at === undefined || data.created_at === null) {
    throw new Error(`task file ${id} missing frontmatter created_at`);
  }

  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (!KNOWN_KEYS.includes(key)) extra[key] = value;
  }

  const task: TaskFile = {
    id,
    title,
    status: status as TaskStatus,
    created_at: dateString(data.created_at, 24),
    body: parsed.content,
  };
  if (data.due !== undefined) task.due = dateString(data.due, 10);
  if (data.projects !== undefined) {
    task.projects = Array.isArray(data.projects) ? data.projects.map(String) : [String(data.projects)];
  }
  if (data.origin !== undefined) task.origin = data.origin as TaskOrigin;
  if (data.provenance !== undefined) task.provenance = data.provenance as TaskProvenance;
  if (Object.keys(extra).length > 0) task.extra = extra;
  return task;
}

export function serializeTaskFile(task: TaskFile): string {
  const fm: Record<string, unknown> = {
    id: task.id,
    title: task.title,
    status: task.status,
  };
  if (task.due !== undefined) fm.due = task.due;
  if (task.projects !== undefined) fm.projects = task.projects;
  if (task.origin !== undefined) fm.origin = task.origin;
  fm.created_at = task.created_at;
  if (task.provenance !== undefined) fm.provenance = task.provenance;
  // Known keys win: an extra entry colliding with a known key is dropped (parse never
  // produces such an extra; this only guards hand-built TaskFile objects).
  for (const [key, value] of Object.entries(task.extra ?? {})) {
    if (!(key in fm)) fm[key] = value;
  }
  // Emit the file ourselves — matter.stringify RE-PARSES the assembled output as a frontmatter
  // file, so a body beginning with "---" (a markdown hr) would be swallowed back into the
  // frontmatter (or throw). js-yaml's default dump is byte-identical to gray-matter's engine
  // (indent 2, lineWidth 80), so files written before this change round-trip unchanged.
  const body = task.body.endsWith("\n") ? task.body : `${task.body}\n`;
  return `---\n${yaml.dump(fm)}---\n${body}`;
}
