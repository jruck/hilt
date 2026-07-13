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
 * - A new comment reuses the target's latest conversation. Agent-completed legacy threads reopen;
 *   only an explicit `resolution.action === "closed"` starts a fresh thread.
 * - `handled_at` belongs to individual human messages and `outcomes` describe turns. Neither
 *   closes the conversation. `processed` remains only as a legacy compatibility stamp.
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
  /** The processor/loop run that consumed this specific human message. */
  handled_at?: string;
  handled_by?: string;
  outcome_id?: string;
}

export type ThreadOutcomeKind =
  | "answered"
  | "changed"
  | "proposal"
  | "dev-item"
  | "calibrated"
  | "clustered";

/** One completed agent turn. Conversation lifecycle is deliberately separate. */
export interface ThreadOutcome {
  id: string;
  kind: ThreadOutcomeKind;
  summary: string;
  at: string;
  by: string;
  message_ids: string[];
  chat_id?: string;
  files_touched?: string[];
  proposal_task_id?: string;
}

export interface Thread {
  id: string;
  target: CommentTarget;
  status: "open" | "resolved";
  created_at: string;
  updated_at: string;
  messages: ThreadMessage[];
  /** Chat sessions attached to this conversation (normally one reused session). */
  chat_ids?: string[];
  /** Append-only run outcomes. A completed turn does not close the conversation. */
  outcomes?: ThreadOutcome[];
  /** Stamped when the processor diagnoses the thread as a Hilt dev item; the thread stays OPEN for Justin's dev pass. */
  dev_item?: { diagnosed_at: string };
  /** Legacy thread-level compatibility stamp; new consumers use message.handled_at. */
  processed?: { at: string; run_at: string };
  /** Explicit conversation boundary; new UI writes action "closed". */
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
  pending_message_count?: number;
  last_message_snippet: string | null;
  chat_ids?: Thread["chat_ids"];
  dev_item?: Thread["dev_item"];
  processed?: Thread["processed"];
  resolution?: Thread["resolution"];
  last_outcome?: ThreadOutcome;
  source_ref?: string;
}
