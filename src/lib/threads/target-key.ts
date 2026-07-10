import type { CommentTarget } from "./types";

/**
 * Canonical identity for "same conversation anchor": kind + the ids that name the object.
 * Deliberately EXCLUDED: `loop-item.artifactDate` (which day surfaced it, not which item) and
 * `briefing-anchor.anchor.citation` (provenance, not identity).
 */
export function targetKey(target: CommentTarget): string {
  switch (target.kind) {
    case "task":
      return `task\u0000${target.id}`;
    case "loop-item":
      return `loop-item\u0000${target.loop}\u0000${target.itemId}`;
    case "briefing":
      return `briefing\u0000${target.date}`;
    case "briefing-section":
      return `briefing-section\u0000${target.date}\u0000${target.section}`;
    case "briefing-anchor":
      return `briefing-anchor\u0000${target.date ?? ""}\u0000${target.anchor.section ?? ""}\u0000${target.anchor.text}`;
    case "library":
      return `library\u0000${target.id}`;
    case "meeting":
      return `meeting\u0000${target.rel}`;
  }
}
