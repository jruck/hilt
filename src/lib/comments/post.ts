/**
 * postComment — the ONE client router behind every comment gesture (gate-B addition).
 *
 * Routing table (kind → store TODAY — C2 swaps these internals for the thread store and
 * keeps the signature):
 *
 * | kind               | store today                                                        |
 * |--------------------|--------------------------------------------------------------------|
 * | loop-item          | POST /api/loops/feedback → <loopHome>/feedback/records.jsonl        |
 * | briefing           | POST /api/loops/feedback (loop "briefing", level "briefing")        |
 * | briefing-section   | POST /api/loops/feedback (loop "briefing", level "section")         |
 * | briefing-anchor    | POST /api/loops/feedback (loop "briefing", level "item" + anchor)   |
 * | task (with origin) | → loop-item on origin (a task comment IS feedback on its source ask)|
 * | task (origin-less) | PUT /api/tasks/[id] — `- <iso> note: <text>` appended to the body   |
 * | library            | TODO(C2): thread store (today: DATA_DIR/library-feedback — NOT here)|
 * | meeting            | TODO(C2): thread store (no store exists today)                      |
 *
 * Verdict notes do NOT come through here — a note riding a verdict posts with it in ONE
 * request to /api/loops/verdicts (see VerdictNoteField). postComment is the no-decision path.
 */
import { withBasePath } from "@/lib/base-path";
import { joinTaskBody, splitTaskBody } from "@/lib/tasks/task-body";
import type { TaskFile } from "@/lib/tasks/types";
import type { FeedbackTarget } from "@/lib/loops/types";
import type { CommentTarget, ImplementedCommentTarget } from "./types";

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

function postFeedback(loop: string, target: Omit<FeedbackTarget, "loop">, text: string): Promise<void> {
  return requestJson("/api/loops/feedback", {
    method: "POST",
    body: JSON.stringify({ loop, target, text }),
  });
}

/** Origin-less task: the FILE is the record — append a dated note line to the body, keeping
 * the read-only History section in its normalized tail position (C2 lifts these into threads). */
async function appendTaskNote(taskId: string, task: TaskFile, text: string): Promise<void> {
  const { content, history } = splitTaskBody(task.body);
  const line = `- ${new Date().toISOString()} note: ${text}`;
  const nextContent = content.trim().length > 0 ? `${content.replace(/\s+$/, "")}\n\n${line}` : line;
  await requestJson(`/api/tasks/${taskId}`, {
    method: "PUT",
    body: JSON.stringify({ body: joinTaskBody(nextContent, history) }),
  });
}

/**
 * Post one comment against a system object. Small and honest: routes to the EXISTING stores —
 * no new storage. Throws with the server's error message on failure (CommentBox renders it).
 */
export async function postComment(target: ImplementedCommentTarget, text: string): Promise<void> {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("Empty comment");
  // Widen for the exhaustive switch — the public signature already excludes the C2 kinds.
  const t = target as CommentTarget;
  switch (t.kind) {
    case "loop-item":
      return postFeedback(t.loop, {
        level: "item",
        item_id: t.itemId,
        ...(t.artifactDate ? { artifact_date: t.artifactDate } : {}),
      }, trimmed);
    case "briefing":
      return postFeedback("briefing", { level: "briefing", artifact_date: t.date }, trimmed);
    case "briefing-section":
      return postFeedback("briefing", { level: "section", artifact_date: t.date, section: t.section }, trimmed);
    case "briefing-anchor":
      return postFeedback("briefing", {
        level: "item",
        anchor: t.anchor,
        ...(t.date ? { artifact_date: t.date } : {}),
      }, trimmed);
    case "task": {
      // A loop-minted task's comment DUAL-WRITES (Revise-retirement decision, 2026-07-07):
      // to the source ask's feedback drawer (what the loop's guidance/health pass reads) AND
      // as a note-line in the task file — so the note stays VISIBLE on the item pre-C2 (the
      // retired Revise verdict used to provide that visibility; threads take over in C2).
      // Origin-less tasks get the body note only. Proposals reject the body PUT (409) — the
      // drawer write still lands, so the comment is never lost.
      const { task } = await requestJson<{ task: TaskFile }>(`/api/tasks/${t.id}`, { method: "GET" });
      if (task.origin?.loop && task.origin.item_id) {
        await postFeedback(task.origin.loop, { level: "item", item_id: task.origin.item_id }, trimmed);
        try {
          await appendTaskNote(t.id, task, trimmed);
        } catch (err) {
          // Visibility write is best-effort (e.g. proposals 409 the PUT); the drawer has it.
          console.warn(`[comments] task note-line skipped for ${t.id}:`, err);
        }
        return;
      }
      return appendTaskNote(t.id, task, trimmed);
    }
    case "library":
    case "meeting":
      // Typed out of ImplementedCommentTarget — reachable only through a cast.
      throw new Error(`Comments on ${t.kind} targets arrive with C2 (thread store)`);
    default: {
      const never: never = t;
      throw new Error(`Unknown comment target: ${JSON.stringify(never)}`);
    }
  }
}
