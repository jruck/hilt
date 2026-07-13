/**
 * The task object (v3 scope Phase 1) — one identity for a unit of work from proposed through
 * done. One markdown file per task; frontmatter keys are snake_case in the file. Proposals are
 * task files from birth in `tasks/.proposals/` (approve = rename into `tasks/`, dismiss = unlink
 * with the loop ledger as memory).
 */

export type TaskStatus =
  | "proposed"
  | "accepted-me"
  | "accepted-agent"
  | "in-progress"
  | "done"
  | "dropped";

export const TASK_STATUSES: readonly TaskStatus[] = [
  "proposed",
  "accepted-me",
  "accepted-agent",
  "in-progress",
  "done",
  "dropped",
];

/** Where the task came from (all fields optional — hand-created tasks have no origin). */
export interface TaskOrigin {
  loop?: string;
  /** Vault-relative meeting path. */
  meeting?: string;
  /** Vault-relative weekly-list path this task was carried from (weekly recycle, unit A5). */
  list?: string;
  /** The ledger/loop item this proposal was minted from (e.g. `ma-2026-06-30-001`). */
  item_id?: string;
  /** Feedback thread id (Phase C escalations). */
  thread?: string;
}

/** Evidence: the verbatim quote and where it was said (scope §5 — provenance on every proposal). */
export interface TaskProvenance {
  quote: string;
  source: string;
}

export interface TaskFile {
  id: string;
  title: string;
  status: TaskStatus;
  /** YYYY-MM-DD */
  due?: string;
  /** Vault-relative project paths (replaces the weekly list's title-link overload in v2). */
  projects?: string[];
  origin?: TaskOrigin;
  /** ISO 8601 */
  created_at: string;
  provenance?: TaskProvenance;
  /** Unknown frontmatter keys, preserved across parse/serialize so foreign edits survive. */
  extra?: Record<string, unknown>;
  /** Markdown body after the frontmatter — user-editable task notes and audit History. Source
   * evidence from a linked meeting action is joined live instead of copied here. */
  body: string;
}

/** A parsed v2 weekly-list task line (pure string data; no file IO). */
export interface WeeklyV2Line {
  /** The exact line as it appears in the weekly file. */
  raw: string;
  checked: boolean;
  title: string;
  /** First link target — the vault-relative task-file path. Null when the line has no link. */
  taskPath: string | null;
  /** YYYY-MM-DD from an inline `[due:: …]` field, if present. */
  due: string | null;
}

/** A v2 weekly line joined with its task file; degradation keeps the raw line, never drops it. */
export interface HydratedWeeklyV2Line {
  line: WeeklyV2Line;
  task?: TaskFile;
  /** True when the task file is absent or unreadable — render the raw line as-is. */
  missing: boolean;
}
