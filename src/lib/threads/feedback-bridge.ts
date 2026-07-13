/**
 * Bridge between the loops feedback shapes (FeedbackRecord/FeedbackTarget) and the thread
 * store's CommentTarget anchors. Both directions must round-trip: the loops store functions
 * keep their FeedbackRecord signatures as thin adapters over threads, so readers
 * (scripts/loop-meeting-actions.ts) work unmodified.
 *
 * Mapping table (FeedbackTarget → CommentTarget):
 * - level "item" + anchor   → briefing-anchor { date: artifact_date?, anchor }
 *                             (the anchor kind carries no loop id — anchors from non-briefing
 *                             loops collapse to the briefing loop on the way back)
 * - level "item" + item_id  → loop-item { loop, itemId: item_id, artifactDate: artifact_date? }
 * - level "section"         → briefing-section { date, section }
 * - level "briefing"        → briefing { date }
 * Records without artifact_date at briefing/section level use the fallback date (the record's
 * created_at day) — CommentTarget requires a date for those kinds.
 */
import type { FeedbackRecord, FeedbackTarget } from "../loops/types";
import type { CommentTarget, Thread } from "./types";

export function feedbackTargetToComment(
  target: FeedbackTarget,
  opts: { fallbackDate?: string } = {},
): CommentTarget {
  const date = target.artifact_date || opts.fallbackDate || "";
  if (target.level === "briefing") {
    return { kind: "briefing", date };
  }
  if (target.level === "section") {
    // The legacy route accepts section-level feedback WITHOUT a section name; an empty
    // section fails thread-target validation (adapter 500 where legacy 201'd — adversarial
    // finding). A sectionless section comment IS a whole-briefing comment — degrade to it.
    if (!target.section) return { kind: "briefing", date };
    return { kind: "briefing-section", date, section: target.section };
  }
  if (target.anchor) {
    return {
      kind: "briefing-anchor",
      ...(target.artifact_date ? { date: target.artifact_date } : {}),
      anchor: target.anchor,
    };
  }
  return {
    kind: "loop-item",
    loop: target.loop,
    itemId: target.item_id || "",
    ...(target.artifact_date ? { artifactDate: target.artifact_date } : {}),
  };
}

/** Non-feedback kinds (task/library/meeting) → null: they never belonged to a loop store. */
export function commentTargetToFeedback(target: CommentTarget): FeedbackTarget | null {
  switch (target.kind) {
    case "loop-item":
      return {
        loop: target.loop,
        level: "item",
        item_id: target.itemId,
        ...(target.artifactDate ? { artifact_date: target.artifactDate } : {}),
      };
    case "briefing":
      return { loop: "briefing", level: "briefing", artifact_date: target.date };
    case "briefing-section":
      return { loop: "briefing", level: "section", artifact_date: target.date, section: target.section };
    case "briefing-anchor":
      return {
        loop: "briefing",
        level: "item",
        anchor: target.anchor,
        ...(target.date ? { artifact_date: target.date } : {}),
      };
    default:
      return null;
  }
}

/**
 * A thread mapped back to FeedbackRecord shape: one record per human message (agent:* consumption
 * notes are thread furniture, not feedback), carrying its own handled stamp with a legacy
 * thread-level processed fallback.
 */
export function threadToFeedbackRecords(thread: Thread): FeedbackRecord[] {
  const target = commentTargetToFeedback(thread.target);
  if (!target) return [];
  const records: FeedbackRecord[] = [];
  for (const message of thread.messages) {
    if (message.author !== "justin" && message.author !== "claude-sim") continue;
    records.push({
      id: message.id,
      author: message.author,
      created_at: message.created_at,
      target,
      text: message.text,
      ...(message.handled_at
        ? { processed: { at: message.handled_at, run_at: message.handled_at } }
        : thread.processed
          ? { processed: thread.processed }
          : {}),
    });
  }
  return records;
}
