/**
 * Universal object references (v3 unit B5) — the shared contract between the resolver layer
 * (src/lib/objects/resolvers.ts, /api/objects/resolve) and the display layer (ObjectPill /
 * ObjectCard). Everywhere Hilt name-drops a system object — meetings, tasks, people, projects,
 * library items — it renders as a consistent inline pill; click opens a popover with the
 * object's card; the card's header navigates to the native element.
 *
 * Markdown-side grammar (`hilt:` URIs as ordinary link targets, so files stay portable and
 * degrade to plain links anywhere else):
 *
 *   [display text](hilt:meeting/<vault-rel-path>)   hilt:meeting/meetings/2026-07-05/Floyds….md
 *   [display text](hilt:task/<task-id>)             hilt:task/t-20260705-003
 *   [display text](hilt:person/<slug>)              hilt:person/art-vandelay
 *   [display text](hilt:project/<vault-rel-path>)   hilt:project/projects/everpro-migration
 *   [display text](hilt:library/<artifact-id>)      hilt:library/9f3a…
 *
 * v1 ships meeting + task end-to-end; person/project/library follow (the kind dispatch makes
 * each a localized addition).
 */
import type { TaskFile } from "@/lib/tasks/types";

export type ObjectKind = "meeting" | "task" | "person" | "project" | "library";

export interface ObjectRef {
  kind: ObjectKind;
  /** The kind's native identifier — see the grammar above. May contain "/" (paths). */
  id: string;
}

/** Card view-model for a meeting — derivable from frontmatter alone (the briefing's case) or
 * from full active-meeting data (the People case); the canonical card renders either. */
export interface MeetingCardData {
  kind: "meeting";
  title: string;
  /** YYYY-MM-DD when known. */
  date: string | null;
  /** Human time range ("2:00–2:30 PM") when calendar times are known. */
  timeRange: string | null;
  attendees: string[];
  /** External links when present. */
  granolaUrl: string | null;
  hasTranscript: boolean;
}

export interface TaskCardData {
  kind: "task";
  task: TaskFile;
  /** Which store the file was found in. */
  store: "tasks" | "proposals";
}

export interface PersonCardData {
  kind: "person";
  name: string;
  description: string | null;
  lastMeetingDate: string | null;
}

export interface ProjectCardData {
  kind: "project";
  title: string;
  status: string | null;
  description: string | null;
}

export interface LibraryCardData {
  kind: "library";
  title: string;
  summary: string | null;
  sourceName: string | null;
  url: string | null;
}

export type ObjectCardData =
  | MeetingCardData
  | TaskCardData
  | PersonCardData
  | ProjectCardData
  | LibraryCardData;

/** A view the Hilt shell can navigate to (Board's navigate contract). */
export type ObjectNavView = "bridge" | "people" | "briefings" | "library" | "docs" | "system";

export interface ObjectNavTarget {
  view: ObjectNavView;
  /** View-specific scope path ("" = just switch views). */
  scope: string;
}

/** GET /api/objects/resolve?kind=&id= response. `nav: null` = the card renders but there is no
 * click-through (e.g. a meeting note without a granola_id). */
export interface ResolvedObject {
  kind: ObjectKind;
  card: ObjectCardData;
  nav: ObjectNavTarget | null;
}
