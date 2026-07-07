/**
 * Briefing canvas — the pure (no-React, no-IO) half of the briefing renderer (v3 unit B3).
 *
 * The briefing is a lightweight CANVAS over live objects: the editor writes prose + object ids,
 * the UI hydrates cards where the ids sit. This module owns the markdown parsing and the
 * ID CONTRACT the generation side (vault `meta/skills/briefing/SKILL.md` + the loop artifacts'
 * Escalations view) and the UI side (`BriefingContent`) both key on:
 *
 *   1. TASK / PROPOSAL ids — `t-YYYYMMDD-NNN` (task-object files, A1). THE new-contract marker:
 *      a bullet or sub-bullet carrying one renders that task's live card (TaskCard) in place of
 *      the raw line. Pre-B3 briefings contain zero `t-` ids, so they render exactly as before —
 *      backward compatibility is keyed on the marker, never on date.
 *   2. LOOP ITEM ids — `ma-2026-06-30-007`-style (dashed date). Pre-existing contract, untouched:
 *      the UI attaches verdict controls / the amber escalation marker to the editor's own line.
 *      The two shapes are deliberately disjoint (compact vs dashed date) so the cleaners can
 *      never eat each other's join keys.
 *   3. MEETING citations — a vault-relative `meetings/<date>/<file>.md` path inside the line
 *      (the citation form the loop stamps). Inside the "⏭ Next steps" section this is the join
 *      key that turns the editor's meeting entry into an expandable MeetingCard.
 *   4. LIBRARY item ids — deliberately NOT in the contract (deferred): the gathered data never
 *      exposes library artifact ids (the references artifact carries loop-item ids and titles),
 *      and the only by-id fetch (`GET /api/library/[id]`) stamps an `opened` engagement event
 *      per call, so passive hydration would corrupt read-state. No new API surface was built.
 */

export interface BriefingItem {
  headline: string; // top-level bullet text (markdown)
  details: string; // sub-bullets as markdown
  /** True when this "item" is a paragraph/standalone-link line, not a bullet (renders unmarked). */
  prose?: boolean;
}

export interface BriefingSection {
  heading: string; // ## heading text
  items: BriefingItem[];
}

/**
 * Parse briefing markdown into a lede + sections with collapsible items.
 * Handles the briefing shape:
 *   **Day-thesis lede paragraph.**
 *   ## Section Heading
 *   - Top-level headline
 *     - Detail sub-bullet
 *   Prose paragraph (sections may be prose-styled — e.g. Library)
 *   [Full library report](/api/reports/morning)
 * Paragraph lines and standalone link lines are PRESERVED as unmarked items — the first
 * renderer dropped every non-bullet line, which silently emptied prose-styled sections and
 * hid the lede entirely. Parsing stops at a `---` horizontal rule (the generation footer).
 */
export function parseBriefing(content: string): { lede: string; sections: BriefingSection[] } {
  // Strip leading h1
  const body = content.replace(/^\s*#\s+.+\n*/, "");
  const lines = body.split("\n");

  const sections: BriefingSection[] = [];
  const ledeLines: string[] = [];
  let currentSection: BriefingSection | null = null;
  let currentItem: BriefingItem | null = null;

  const flushItem = () => {
    if (currentItem && currentSection) currentSection.items.push(currentItem);
    currentItem = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Horizontal rule — everything after it is the generation footer; stop.
    if (line.match(/^\s*(-{3,}|\*{3,})\s*$/)) break;

    // Footnote definition lines — treat as top-level items in current section
    const footnoteMatch = line.match(/^\[\^(\d+)\]:\s*(.*)/);
    if (footnoteMatch) {
      flushItem();
      currentItem = {
        headline: `[${footnoteMatch[1]}] ${footnoteMatch[2]}`,
        details: "",
      };
      continue;
    }

    // ## Section heading
    if (line.match(/^##\s+/)) {
      flushItem();
      if (currentSection) sections.push(currentSection);
      currentSection = {
        heading: line.replace(/^##\s+/, "").trim(),
        items: [],
      };
      continue;
    }

    // Top-level bullet: "- " at start (no indent)
    if (line.match(/^- /)) {
      flushItem();
      currentItem = {
        headline: line.replace(/^- /, "").trim(),
        details: "",
      };
      continue;
    }

    // Indented line (sub-bullet or continuation) — belongs to current item. Prose items absorb
    // them too: a paragraph-styled meeting entry with indented ask sub-bullets must keep its
    // asks as details, not have them smashed into the paragraph text.
    if (currentItem && line.match(/^\s{2,}/)) {
      currentItem.details += (currentItem.details ? "\n" : "") + line;
      continue;
    }

    // Paragraph / standalone-link line (unindented, non-bullet, non-heading)
    if (line.trim() !== "") {
      if (!currentSection) {
        // Before the first section heading = the day-thesis lede.
        ledeLines.push(line.trim());
        continue;
      }
      // Merge consecutive paragraph lines into one prose item.
      if (currentItem?.prose) {
        currentItem.headline += ` ${line.trim()}`;
      } else {
        flushItem();
        currentItem = { headline: line.trim(), details: "", prose: true };
      }
      continue;
    }

    // Empty line — paragraph boundary for prose; spacing for bullet details.
    if (currentItem?.prose) {
      flushItem();
    } else if (currentItem && currentItem.details) {
      currentItem.details += "\n";
    }
  }

  // Save final item and section
  flushItem();
  if (currentSection) {
    sections.push(currentSection);
  }

  return { lede: ledeLines.join(" "), sections };
}

/** Join keys are not reading material: strip loop item ids + loop citations from display text. */
export function cleanLoopTokens(text: string): string {
  return text
    .replace(/`[a-z]{2,8}-\d{4}-\d{2}-\d{2}-\d{3}`/g, "")
    .replace(/\b[a-z]{2,8}-\d{4}-\d{2}-\d{2}-\d{3}\b/g, "")
    .replace(/\*loop:[^*]+\*/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/ {2,}/g, " ");
}

// ── The task-id contract (B3) ──────────────────────────────────────────────────────────────────

/** Task-object file ids: `t-YYYYMMDD-NNN` (compact date — disjoint from loop item ids' dashed
 * date, so neither cleaner can eat the other's join keys). */
const TASK_ID_RE = /\bt-\d{8}-\d{3}\b/g;

/** All task ids in a span of text, unique, in order of first appearance. */
export function extractTaskIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(TASK_ID_RE)) {
    seen.add(match[0]);
  }
  return [...seen];
}

/** Strip task-id tokens (backticked or bare) and the artifact's `→ task` arrow remnant from
 * display text — the hydrated card renders the object; the key is not reading material. */
export function stripTaskTokens(text: string): string {
  return text
    .replace(/(?:→|->)\s*task\s*`t-\d{8}-\d{3}`/g, "")
    .replace(/(?:→|->)\s*task\s*\bt-\d{8}-\d{3}\b/g, "")
    .replace(/`t-\d{8}-\d{3}`/g, "")
    .replace(/\bt-\d{8}-\d{3}\b/g, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/ {2,}/g, " ");
}

/**
 * Is this detail line JUST a task-id placement (the SKILL's "one id per line, nothing else")?
 * List marker, backticks, an optional trailing italic citation, and punctuation are tolerated —
 * such a line is fully consumed by its card. A line with real prose keeps the prose visible
 * (cleaned) with the card rendered beneath it.
 */
export function isTaskIdOnlyLine(line: string): boolean {
  if (extractTaskIds(line).length === 0) return false;
  const residue = stripTaskTokens(line)
    .replace(/^\s*-\s*/, "") // list marker
    .replace(/\*[^*]*\*/g, "") // italic citation span(s)
    .replace(/[`—–\-·,.;:()\s]/g, "");
  return residue.length === 0;
}

/**
 * First vault-relative meeting path cited in a span of text (`meetings/<date>/<file>.md`).
 * Meeting filenames contain spaces/`@`/unicode, so the match runs to the first `.md`,
 * stopping at markdown delimiters that can't appear in a filename's citation form.
 */
export function extractMeetingRelPath(text: string): string | null {
  const match = text.match(/meetings\/\d{4}-\d{2}-\d{2}\/[^*`\n]+?\.md/);
  return match ? match[0] : null;
}

/**
 * Is this detail line JUST the card's own meeting citation (`*meetings/….md, <date>*` pointing at
 * the SAME meeting the MeetingCard is for)? That citation is the join key that CREATED the card —
 * the header already names and dates the meeting — so re-printing the path inside the expansion is
 * redundant reading material and is suppressed (gate-B feedback, 2026-07-07). A citation pointing
 * at a DIFFERENT meeting, or a line carrying any other prose or additional sources, adds
 * information and stays. ⏭/MeetingCard path only — the general bullet renderer keeps citations.
 */
export function isRedundantMeetingCitationLine(line: string, meetingRel: string): boolean {
  const cited = extractMeetingRelPath(line);
  if (!cited || cited !== meetingRel) return false;
  // Remove the cited path itself, bare dates, and citation dressing (list marker, asterisks,
  // backticks, punctuation). Anything left is real content — another source, prose — so keep it.
  const residue = line
    .split(cited).join("")
    .replace(/\d{4}-\d{2}-\d{2}/g, "")
    .replace(/^\s*-\s*/, "")
    .replace(/[*`—–\-·,.;:()\s]/g, "");
  return residue.length === 0;
}

/** "meetings/2026-07-05/Floyds sync-2026-07-05….md" → { title: "Floyds sync", date: "2026-07-05" } */
export function meetingLabelFromRelPath(rel: string): { title: string; date: string | null } {
  const date = rel.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] ?? null;
  const title = (rel.split("/").pop() || rel)
    .replace(/-\d{4}-\d{2}-\d{2}[^/]*\.md$/, "")
    .replace(/\.md$/, "");
  return { title, date };
}

/** The ⏭ Next steps section — the B3 marker heading (old briefings never carry the emoji, so
 * MeetingCard rendering is keyed on the new contract, never on date). Matches "⏭" and "⏭️". */
export function isNextStepsHeading(heading: string): boolean {
  return heading.includes("⏭");
}
