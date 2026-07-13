/**
 * postComment — the ONE client router behind every comment gesture. Since C2, every kind
 * lands in the thread store through ONE write API:
 *
 * | kind               | POST /api/threads target                                            |
 * |--------------------|---------------------------------------------------------------------|
 * | loop-item          | the target itself                                                   |
 * | briefing           | the target itself                                                   |
 * | briefing-section   | the target itself                                                   |
 * | briefing-anchor    | the target itself                                                   |
 * | task (with origin) | loop-item on the origin ask (a task comment IS feedback on its ask) |
 * | task (origin-less) | the task target itself (the thread is the visible record — the      |
 * |                    | pre-C2 note-line body write is retired; old lines stay untouched)   |
 * | library            | the target itself                                                   |
 * | meeting            | the target itself                                                   |
 *
 * Reuse semantics live server-side: the target's latest conversation gains the message;
 * only an explicit Close creates the next-thread boundary.
 *
 * Verdict notes do NOT come through here — a note riding a verdict posts with it in ONE
 * request to /api/loops/verdicts (see VerdictNoteField). postComment is the no-decision path.
 * Throws with the server's error message on failure (CommentBox renders it).
 */
import { withBasePath } from "@/lib/base-path";
import type { TaskFile } from "@/lib/tasks/types";
import type { CommentTarget, ImplementedCommentTarget } from "./types";
import type { Thread } from "../threads/types";

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(withBasePath(url), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const payload = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
  return payload as T;
}

async function postThread(target: CommentTarget, text: string): Promise<Thread> {
  const payload = await requestJson<{ thread: Thread }>("/api/threads", {
    method: "POST",
    body: JSON.stringify({ target, text }),
  });
  return payload.thread;
}

/** Post one comment against a system object. Small and honest: one thread-store write. */
export async function postComment(target: ImplementedCommentTarget, text: string): Promise<Thread> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  if (target.kind === "task") {
    // A loop-minted task's comment threads on the SOURCE ask (what the loop's guidance/health
    // pass reads); origin-less tasks thread on the task id itself. Proposals resolve here too —
    // no task-file body write remains to 409.
    const { task } = await requestJson<{ task: TaskFile }>(`/api/tasks/${target.id}`, { method: "GET" });
    if (task.origin?.loop && task.origin.item_id) {
      return postThread({ kind: "loop-item", loop: task.origin.loop, itemId: task.origin.item_id }, trimmed);
    }
    return postThread(target, trimmed);
  }
  return postThread(target, trimmed);
}
