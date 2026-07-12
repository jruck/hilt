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
 *   4. RECOMMENDATION episode ids — `rec:<episode-id>`. The UI passively hydrates these through
 *      the read-only recommendation preview API, then renders the frozen episode pitch with the
 *      artifact's current metadata. Hydration never stamps an `opened` event; clicking the row
 *      navigates to Library and lets the normal reader path record the real open.
 */

import { formatHiltMonthDay } from "../display-date";

export interface BriefingItem {
  headline: string; // top-level bullet text (markdown)
  details: string; // sub-bullets as markdown
  /** True when this "item" is a paragraph/standalone-link line, not a bullet (renders unmarked). */
  prose?: boolean;
  /** A level-three heading used as a semantic module boundary inside a briefing section. */
  subheading?: string;
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

    // ### Subheading — preserved as a semantic boundary. Library & knowledge uses these to group
    // recommendations, the weekly memo, and daily health without changing the top-level spine.
    if (line.match(/^###\s+/)) {
      flushItem();
      if (currentSection) {
        currentSection.items.push({
          headline: line.replace(/^###\s+/, "").trim(),
          details: "",
          prose: true,
          subheading: line.replace(/^###\s+/, "").trim(),
        });
      }
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
/**
 * CommonMark forbids unescaped spaces and bare parens in link DESTINATIIONS — and vault meeting
 * paths are full of both ("…/Discuss survey cadence UX-… @ 09-57-15.md", "…(Just Keep
 * Swimming)…"), so `[name](hilt:meeting/<path>)` is not parsed as a link at all and the raw
 * markdown leaks into the briefing verbatim (B5 launch finding). The CommonMark-legal form is
 * an angle-bracket destination: `[name](<hilt:…>)`. The generator is instructed to emit that
 * form; this normalizer repairs the bare form defensively. Meeting/project ids end in `.md`,
 * which makes the destination end unambiguous even with interior parens; other kinds never
 * contain spaces/parens and pass through untouched.
 */
export function normalizeHiltLinks(markdown: string): string {
  return markdown.replace(
    /\]\((hilt:(?:meeting|project)\/[^\n<>]*?\.md)\)/g,
    "](<$1>)",
  );
}

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

// ── The recommendation-episode contract ──────────────────────────────────────────────────────

/** Recommendation placement token, e.g. `rec:rec-20260710052000-01-ab12cd34`. */
const RECOMMENDATION_EPISODE_RE = /\brec:(rec-[a-z0-9][a-z0-9-]*)\b/gi;

/** Frozen recommendation episode ids in first-appearance order. */
export function extractRecommendationEpisodeIds(text: string): string[] {
  const seen = new Set<string>();
  for (const match of text.matchAll(RECOMMENDATION_EPISODE_RE)) seen.add(match[1]);
  return [...seen];
}

/** Remove recommendation placement tokens from display prose. */
export function stripRecommendationTokens(text: string): string {
  return text
    .replace(/`?rec:rec-[a-z0-9][a-z0-9-]*`?/gi, "")
    .replace(/[ \t]+$/gm, "")
    .replace(/ {2,}/g, " ");
}

/** True when the line is only a recommendation placement token plus markdown dressing. */
export function isRecommendationEpisodeOnlyLine(line: string): boolean {
  if (extractRecommendationEpisodeIds(line).length === 0) return false;
  const residue = stripRecommendationTokens(line)
    .replace(/^\s*-\s*/, "")
    .replace(/[`—–\-·,.;:()\s]/g, "");
  return residue.length === 0;
}

export type BriefingLibraryModuleKind = "recommendations" | "memo" | "health";

export interface BriefingLibraryModule {
  kind: BriefingLibraryModuleKind;
  heading: string;
  items: BriefingItem[];
}

export interface BriefingLibraryPartition {
  structured: boolean;
  modules: Partial<Record<BriefingLibraryModuleKind, BriefingLibraryModule>>;
  ungrouped: BriefingItem[];
}

function libraryModuleKind(heading: string): BriefingLibraryModuleKind | null {
  const normalized = heading.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z' ]/g, "").trim();
  if (normalized === "recommended for you") return "recommendations";
  if (normalized === "editor's memo" || normalized === "editors memo") return "memo";
  if (normalized === "library health") return "health";
  return null;
}

/** Partition only explicitly headed Library sections; old flat briefings stay on the legacy path. */
export function partitionBriefingLibrarySection(section: BriefingSection): BriefingLibraryPartition {
  const modules: BriefingLibraryPartition["modules"] = {};
  const ungrouped: BriefingItem[] = [];
  let current: BriefingLibraryModule | null = null;
  let structured = false;
  for (const item of section.items) {
    if (item.subheading) {
      const kind = libraryModuleKind(item.subheading);
      if (!kind) {
        current = null;
        ungrouped.push(item);
        continue;
      }
      structured = true;
      current = { kind, heading: item.subheading, items: [] };
      modules[kind] = current;
      continue;
    }
    if (current) current.items.push(item);
    else ungrouped.push(item);
  }
  return { structured, modules, ungrouped };
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
 * Is this stamped task id CONSUMED by an in-band representation? Known ids (live task files,
 * escalation `task_id` joins) render as hydrated cards; dismissed ids are verdict-dismissals —
 * the file is deleted but the loop's LEDGER remembers the minted `task_id`, and the id's
 * representation is the "Dismissed · N" tail. Either way the raw token is a join key, not
 * reading material. An id in NEITHER set is an out-of-band deletion: never-drop keeps its raw
 * token visible as an inert chip (that rule has caught real pipeline bugs).
 */
export function isConsumedTaskId(
  id: string,
  knownIds: ReadonlySet<string>,
  dismissedIds: ReadonlySet<string>,
): boolean {
  return knownIds.has(id) || dismissedIds.has(id);
}

/**
 * What a briefing sub-line does with its stamped task-id tokens:
 *   "drop"  — the line is JUST consumed id(s) (isTaskIdOnlyLine): its card / dismissed tail
 *             already represents it fully, so the line disappears
 *   "keep"  — some id is unconsumed (deleted out-of-band, no dismissal record): the raw token
 *             stays visible as an inert chip — stripping it left an empty residue that
 *             vanished, violating never-drop
 *   "strip" — tokens strip, prose residue stays (also the no-op for lines without task ids)
 */
export function stampedIdLineDisposition(
  line: string,
  isConsumed: (id: string) => boolean,
): "drop" | "strip" | "keep" {
  const ids = extractTaskIds(line);
  if (ids.length === 0) return "strip";
  if (ids.some((id) => !isConsumed(id))) return "keep";
  return isTaskIdOnlyLine(line) ? "drop" : "strip";
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

/** Canonical live-decisions heading. Legacy `⏭ Next steps` remains a canvas-compatible alias. */
export function isDecisionsHeading(heading: string): boolean {
  return heading.startsWith("⏭") && /decisions awaiting you/i.test(heading);
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

/**
 * The DATED meeting pill's integrated date segment (pill feedback, 2026-07-07): a meeting rel
 * path's YYYY-MM-DD rendered in the house date form — "Jul 7", with the year appended only when
 * it isn't the current year ("Dec 12, 2025"). Null when the path carries no date (the pill just
 * shows its label). Timezone-safe: UTC noon lands 07:00/08:00 in the formatter's pinned ET for
 * EVERY viewer zone — local-noon construction drifted a day for browsers ≥ ~UTC+9 (Tokyo,
 * Sydney, Kiritimati; adversarial finding, the suite failed under TZ=Pacific/Kiritimati).
 * The includeYear comparison uses the ET display year for the same reason.
 */
export function meetingDateSegment(rel: string, now: Date = new Date()): string | null {
  const iso = meetingLabelFromRelPath(rel).date;
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  const displayYear = Number(
    new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric" }).format(now),
  );
  return formatHiltMonthDay(new Date(Date.UTC(year, month - 1, day, 12)), { includeYear: year !== displayYear });
}

/** A closed `[label](hilt:meeting/…)` link — angle-bracket destination (the generator's required
 * form / normalizeHiltLinks output) or the bare `.md` form, matched tolerantly. */
const MEETING_PILL_LINK = String.raw`\]\((?:<hilt:meeting\/[^>\n]*>|hilt:meeting\/[^\n<>]*?\.md)\)`;

/** A parenthesized literal date token: "(7/7)", "(2026-07-07)", "(Jul 7)" / "(Jul 7, 2026)". */
const TRAILING_DATE_TOKEN = String.raw`\((?:\d{1,2}\/\d{1,2}(?:\/\d{2,4})?|\d{4}-\d{2}-\d{2}|[A-Z][a-z]{2} \d{1,2}(?:, \d{4})?)\)`;

/**
 * Redundant date-token suppression (pill feedback, 2026-07-07): the DATED meeting pill carries
 * its instance date INSIDE the chip, so a literal date token bolted on right after the pill —
 * the editor's old "meeting (7/7)" house form leaking past a pill — is stripped at render.
 * Defensive renderer-side cover for already-written briefings and model slips; the generator
 * contract (prompt PILL CITATIONS + SKILL pill guidance) says never to write one.
 *
 * Deliberately narrow: the token must DIRECTLY follow a `hilt:meeting` link's closing `)` (or
 * that link's closing `**` bold wrapper), same line, with only spaces between — optionally
 * bold-wrapped itself. Dates anywhere else, and dates after non-meeting links, are untouched.
 */
export function stripDateAfterMeetingPill(markdown: string): string {
  const anchor = `(${MEETING_PILL_LINK}(?:\\*\\*)?)`;
  return markdown
    .replace(new RegExp(`${anchor}[ \\t]*\\*\\*[ \\t]*${TRAILING_DATE_TOKEN}[ \\t]*\\*\\*`, "g"), "$1")
    .replace(new RegExp(`${anchor}[ \\t]*${TRAILING_DATE_TOKEN}`, "g"), "$1");
}

/** The ⏭ Next steps section — the B3 marker heading (old briefings never carry the emoji, so
 * MeetingCard rendering is keyed on the new contract, never on date). Matches "⏭" and "⏭️". */
export function isNextStepsHeading(heading: string): boolean {
  return heading.includes("⏭");
}
