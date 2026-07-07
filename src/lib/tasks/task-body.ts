/**
 * Task-body sectioning for the FILE-addressable task pane — PURE (no fs) so the client
 * component and its tests share it.
 *
 * The status machine appends audit lines under `## History` (see status.ts); the pane
 * renders that section READ-ONLY while the rest of the body stays editable. Split takes
 * the body apart; join reassembles it for PUT { body }. History is treated as a tail
 * section: when a (rare) later `##` heading follows it, join re-appends History at the
 * end — content is preserved exactly, position of the History block is normalized.
 */

const HISTORY_HEADING_RE = /^##\s+History\s*$/;

export interface SplitTaskBody {
  /** Everything except the History section — what the pane's editor edits. */
  content: string;
  /** The `## History` section verbatim (heading through the last entry), or null. */
  history: string | null;
}

export function splitTaskBody(body: string): SplitTaskBody {
  const lines = body.split("\n");
  const headingIdx = lines.findIndex((line) => HISTORY_HEADING_RE.test(line));
  if (headingIdx === -1) return { content: body, history: null };

  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  // Trailing blank lines inside the section belong to file formatting, not the record.
  let sectionEnd = end;
  while (sectionEnd > headingIdx + 1 && lines[sectionEnd - 1].trim() === "") sectionEnd--;

  const history = lines.slice(headingIdx, sectionEnd).join("\n");
  const before = lines.slice(0, headingIdx).join("\n");
  const after = lines.slice(end).join("\n");
  const content = [before.replace(/\s+$/, ""), after.replace(/^\n+/, "")]
    .filter((part) => part.trim().length > 0)
    .join("\n\n");
  return { content, history };
}

/** Reassemble an edited content body with the (untouched) History section for PUT { body }. */
export function joinTaskBody(content: string, history: string | null): string {
  const base = content.replace(/\s+$/, "");
  if (!history) return base ? `${base}\n` : "";
  return base ? `${base}\n\n${history}\n` : `${history}\n`;
}

/** History entry lines (the `- <ISO> status: …` bullets) for read-only rendering. */
export function historyEntries(history: string | null): string[] {
  if (!history) return [];
  return history
    .split("\n")
    .slice(1) // drop the heading
    .map((line) => line.replace(/^-\s*/, "").trim())
    .filter((line) => line.length > 0);
}
