/**
 * The COMMENT primitive's target model (gate-B addition; C2's thread store adopted it
 * verbatim as its anchor contract).
 *
 * One gesture everywhere: "leave a comment" on any system object. Every comment is a thread
 * message (src/lib/threads/) behind ONE client router (`postComment` in ./post.ts) and ONE
 * write API (POST /api/threads) — a comment is the first message of a chat session with a
 * deferred agent turn, and `CommentTarget` is where that thread attaches.
 *
 * DO NOT fork per-surface target shapes again. New surfaces add a kind HERE, route it in
 * ./post.ts, and render the shared CommentBox.
 *
 * Kind semantics (all thread-backed; the legacy stores read/write through thread adapters —
 * loops feedback via src/lib/loops/stores.ts, library comments via
 * src/lib/library/library-feedback.ts):
 *
 * - `task` — a task-object file (`tasks/<id>.md`). Routed to the task's ORIGIN loop item when
 *   one exists (a comment on a task IS feedback on its source ask — the loop's health pass
 *   consumes it); origin-less tasks thread under the task id itself. Pre-C2 `- <iso> note:`
 *   lines in task-file bodies are history — never written anymore, left untouched.
 * - `loop-item` — a loop-emitted item by (loop, item id) — asks and insights alike. The loop's
 *   feedback readers see these threads as FeedbackRecords. `artifactDate` pins which day's
 *   artifact surfaced it when known (NOT part of thread identity).
 * - `briefing` — a whole morning briefing by date (feedback under the `briefing` loop).
 * - `briefing-section` — one section of a briefing by heading.
 * - `briefing-anchor` — a synthesized briefing bullet with no minted id: citation-based anchor
 *   (scope §6 — section + text span, optional citation; citation is provenance, not identity).
 *   `date` is optional only because pre-dated render surfaces exist; pass it whenever known.
 * - `library` — a reference-library artifact by id (steering reads these threads as
 *   LibraryComments).
 * - `meeting` — a meeting note by vault-relative path.
 */

export type CommentTarget =
  | { kind: "task"; id: string }
  | { kind: "loop-item"; loop: string; itemId: string; artifactDate?: string }
  | { kind: "briefing"; date: string }
  | { kind: "briefing-section"; date: string; section: string }
  | { kind: "briefing-anchor"; date?: string; anchor: { section?: string; citation?: string; text: string } }
  | { kind: "library"; id: string }
  | { kind: "meeting"; rel: string };

/** Every kind is deliverable since C2's thread store (all comments → POST /api/threads).
 * The alias survives so pre-C2 call sites keep compiling. */
export type ImplementedCommentTarget = CommentTarget;
