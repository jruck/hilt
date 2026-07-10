/**
 * Thread models (v3 unit C2) — comments become THREADS: one store, one write API.
 *
 * A thread is a conversation anchored to a `CommentTarget` (src/lib/comments/types.ts — the
 * comment primitive's target union, adopted verbatim as the anchor contract). The two legacy
 * comment stores (loops feedback JSONL, library-feedback JSON) migrate in; their public
 * function signatures survive as thin adapters over this store.
 *
 * Invariants:
 * - A thread has ≥1 message; deleting the last message deletes the thread file.
 * - `status` drives append-to-open semantics: a new comment on a target with an OPEN thread
 *   appends to it; a resolved or processed non-dev target starts a fresh thread.
 * - `processed` mirrors the loops feedback stamp (consumed by a loop's health pass). Stamping
 *   processed also resolves the thread — unless dev_item is present: a diagnosed dev thread
 *   leaves the guidance set but stays open.
 * - `source_ref` is migration provenance (the original FeedbackRecord/LibraryComment id) and
 *    the idempotency key for re-runs of the migration.
 */
import type { CommentTarget } from "../comments/types";

export type { CommentTarget };

export interface ThreadMessage {
  id: string;
  /** "justin" | "claude-sim" | "agent:<loop>" */
  author: string;
  text: string;
  created_at: string;
  edited_at?: string;
}

export interface Thread {
  id: string;
  target: CommentTarget;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];
  /** Chat sessions minted by the processor for this thread (append-only, oldest first). */
  chat_ids?: string[];
  /** Stamped when the processor diagnoses the thread as a Hilt dev item; the thread stays OPEN for Justin's dev pass. */
  dev_item?: { diagnosed_at: string };
  /** Stamped when a loop's health pass consumes the thread as feedback. */
  processed?: { at: string; run_at: string };
  /** Explicit resolution (user or agent action), distinct from the processed stamp. */
  resolution?: { action: string; at: string; run_at?: string; by: string };
  /** Migration provenance: the original record/comment id this thread was lifted from. */
  source_ref?: string;
}

/** List shape for GET /api/threads — everything but the transcript. */
export interface ThreadSummary {
  id: string;
  target: CommentTarget;
  status: Thread["status"];
  created_at: string;
  updated_at: string;
  message_count: number;
  last_message_snippet: string | null;
  chat_ids?: Thread["chat_ids"];
  dev_item?: Thread["dev_item"];
  processed?: Thread["processed"];
  resolution?: Thread["resolution"];
  source_ref?: string;
}
