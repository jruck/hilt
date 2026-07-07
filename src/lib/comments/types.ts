/**
 * The COMMENT primitive's target model (gate-B addition, pre-built ahead of Phase C).
 *
 * One gesture everywhere: "leave a comment" on any system object. Today the comments land in
 * the existing stores (loops feedback JSONL, task-file bodies) behind ONE client router
 * (`postComment` in ./post.ts); in C2 the thread store adopts THIS union verbatim as its
 * anchor contract — a comment is the first message of a chat session with a deferred agent
 * turn, and `CommentTarget` is where that thread attaches.
 *
 * DO NOT fork per-surface target shapes again. New surfaces add a kind HERE, route it in
 * ./post.ts, and render the shared CommentBox.
 *
 * Kind semantics + today's backing store (the router table lives in ./post.ts):
 *
 * - `task` — a task-object file (`tasks/<id>.md` or `tasks/<id>.md (proposals reject the body write; their comments land in the source ask's drawer)`). Routed to the
 *   task's ORIGIN loop item when one exists (a comment on a task IS feedback on its source
 *   ask — same store the loop's health pass consumes); origin-less tasks get a dated
 *   `- <iso> note: <text>` line appended to the task-file body (the file is the record; C2
 *   lifts these lines into threads).
 * - `loop-item` — a loop-emitted item by (loop, item id) — asks and insights alike. Backed by
 *   the loop's feedback JSONL (`<loopHome>/feedback/records.jsonl`) via POST /api/loops/feedback,
 *   level "item" + item_id. `artifactDate` pins which day's artifact surfaced it, when known.
 * - `briefing` — a whole morning briefing by date. Feedback JSONL under the `briefing` loop,
 *   level "briefing" + artifact_date.
 * - `briefing-section` — one section of a briefing by heading. Feedback JSONL, level "section"
 *   (+ the `section` heading — FeedbackTarget carries it for this level).
 * - `briefing-anchor` — a synthesized briefing bullet with no minted id: citation-based anchor
 *   (scope §6 — section + text span, optional citation). Feedback JSONL, level "item" + anchor.
 *   `date` is optional only because pre-dated render surfaces exist; pass it whenever known.
 * - `library` — a reference-library artifact by id. NOT ROUTED YET: today's store is
 *   `DATA_DIR/library-feedback/<hash>.json` (LibraryComment[]) behind /api/library/[id]/feedback
 *   — C2 migrates that store into threads and this kind goes live then (TODO(C2)).
 * - `meeting` — a meeting note by vault-relative path. No comment store exists today; arrives
 *   with C2's thread store (TODO(C2)).
 */

export type CommentTarget =
  | { kind: "task"; id: string }
  | { kind: "loop-item"; loop: string; itemId: string; artifactDate?: string }
  | { kind: "briefing"; date: string }
  | { kind: "briefing-section"; date: string; section: string }
  | { kind: "briefing-anchor"; date?: string; anchor: { section?: string; citation?: string; text: string } }
  | { kind: "library"; id: string }
  | { kind: "meeting"; rel: string };

/** The kinds `postComment` can actually deliver today. `library` and `meeting` are typed OUT
 * (compile-time discouraged) until C2's thread store absorbs them — passing one is a type
 * error at every call site, and a cast still throws at runtime. */
export type ImplementedCommentTarget = Exclude<CommentTarget, { kind: "library" } | { kind: "meeting" }>;
