import * as fs from "fs";
import * as path from "path";
import type {
  BridgePerson,
  BridgePeopleResponse,
  PersonMeeting,
  PersonDetail,
  InboxDetail,
  SuggestedMeeting,
} from "../types";

interface InlineNoteMeeting extends PersonMeeting {
  noteTitle?: string;
}

const NEXT_SAVED_AT_FIELD = "next_saved_at";

/**
 * Parse people/index.md to extract slug → description mapping.
 * Lines like: - [[amrit]] — Product counterpart
 */
export function parsePeopleIndex(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /^\s*-\s*\[\[([^\]]+)\]\]\s*(?:—|--)\s*(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    result[match[1].trim()] = match[2].trim();
  }
  return result;
}

/**
 * Parse frontmatter from a markdown file. Returns key-value pairs and the body after frontmatter.
 */
function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  let body = content;

  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const fmBlock = content.slice(4, endIdx);
      for (const line of fmBlock.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
          fm[key] = value;
        }
      }
      body = content.slice(endIdx + 4);
    }
  }

  return { fm, body };
}

/**
 * Parse an individual person .md file into a BridgePerson.
 */
export function parsePersonFile(
  content: string,
  slug: string,
  description: string,
): BridgePerson {
  const { fm, body } = parseFrontmatter(content);

  // Type: "meeting" in frontmatter maps to "group"
  const rawType = (fm.type || "person").toLowerCase();
  const type: "person" | "group" = rawType === "meeting" ? "group" : rawType === "group" ? "group" : "person";

  const created = fm.created || fm.date || "";
  const updated = fm.updated || fm.created || fm.date || "";

  // Parse aliases (comma-separated or JSON array)
  let aliases: string[] = [];
  if (fm.aliases) {
    const raw = fm.aliases.trim();
    if (raw.startsWith("[")) {
      try { aliases = JSON.parse(raw); } catch { /* ignore */ }
    } else {
      aliases = raw.split(",").map(a => a.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
    }
  }

  // Extract H1 as name
  const h1Match = body.match(/^#\s+(.+)$/m);
  const name = h1Match ? h1Match[1].trim() : slug;

  // Extract ## Next section bullets
  const nextTopics: string[] = [];
  const nextBlock = extractNextRaw(content);
  if (nextBlock) {
    for (const line of nextBlock.split("\n")) {
      const bulletMatch = line.match(/^\s*-\s+(.+)/);
      if (bulletMatch) {
        nextTopics.push(bulletMatch[1].trim());
      }
    }
  }

  // Count dated entries in ## Notes for meetingCount and find lastMeetingDate
  const datedEntryRegex = /^###\s+(\d{4}-\d{2}-\d{2})/gm;
  let meetingCount = 0;
  let lastMeetingDate: string | null = null;
  let dateMatch;
  while ((dateMatch = datedEntryRegex.exec(body)) !== null) {
    meetingCount++;
    const date = dateMatch[1];
    if (!lastMeetingDate || date > lastMeetingDate) {
      lastMeetingDate = date;
    }
  }

  return {
    slug,
    name,
    type,
    description,
    nextTopics,
    meetingCount,
    lastMeetingDate,
    aliases,
    created,
    updated,
  };
}

/**
 * Match meeting filenames to a person by checking tokens against slug and name parts.
 * Splits filename on __, spaces, dots, "and", then checks case-insensitive.
 */
export function matchMeetingsToSlug(
  slug: string,
  name: string,
  meetingFiles: string[],
  aliases: string[] = [],
): string[] {
  const slugLower = slug.toLowerCase();

  // Build all name variants to check (primary name + aliases)
  const allNames = [name, ...aliases];
  const nameVariants = allNames.map(n => {
    const parts = n.toLowerCase().split(/\s+/);
    const minMatch = parts.length >= 3 ? 2 : 1;
    return { parts, minMatch };
  });

  return meetingFiles.filter((filename) => {
    // Remove .md extension and date suffixes for tokenizing
    const base = filename.replace(/\.md$/, "");
    // Split on __, spaces, dots, "and" (as word), hyphens-followed-by-digits
    const tokens = base
      .split(/__|\.|\s+and\s+|\s+|-(?=\d)/i)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    // Slug match is always sufficient
    if (tokens.some((token) => token === slugLower)) return true;

    // Check all name variants (primary name + aliases)
    return nameVariants.some(({ parts, minMatch }) => {
      const matchedParts = parts.filter((np) =>
        tokens.some((token) => token === np)
      );
      return matchedParts.length >= minMatch;
    });
  });
}

/**
 * Parse meeting file frontmatter for Granola meeting details.
 */
export function parseMeetingFrontmatter(content: string, filename?: string): {
  title: string;
  created: string;
  transcript: string;
  granolaId: string;
  body: string;
} {
  const { fm, body } = parseFrontmatter(content);

  // Fall back to date from filename if frontmatter lacks created
  let created = fm.created || "";
  if (!created && filename) {
    // Extract date and optional time from filename pattern: "Name-YYYY-MM-DD @ HH-MM-SS.md"
    const dtMatch = filename.match(/(\d{4}-\d{2}-\d{2})\s*@\s*(\d{2})-(\d{2})-(\d{2})/);
    if (dtMatch) {
      created = `${dtMatch[1]}T${dtMatch[2]}:${dtMatch[3]}:${dtMatch[4]}`;
    } else {
      const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) created = dateMatch[1];
    }
  }

  // Fall back to title from filename if frontmatter lacks title
  let title = fm.title || "";
  if (!title && filename) {
    // Strip .md, date suffix, and @ time portion
    title = filename.replace(/\.md$/, "").replace(/-?\d{4}-\d{2}-\d{2}.*$/, "").trim();
  }

  // Resolve transcript path: frontmatter first, then auto-discover by naming convention
  let transcript = fm.transcript
    ? fm.transcript.replace(/^\[\[|\]\]$/g, "")
    : "";
  if (!transcript && filename) {
    // Convention: transcripts live at meetings/transcripts/YYYY-MM-DD/<name> (transcript).md
    const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
    if (dateMatch) {
      const baseName = filename.replace(/\.md$/, "");
      transcript = `meetings/transcripts/${dateMatch[1]}/${baseName} (transcript).md`;
    }
  }

  return {
    title,
    created,
    transcript,
    granolaId: fm.granola_id || "",
    body: body.trim(),
  };
}

/**
 * Collect all meeting .md files from the meetings directory.
 * Supports both flat files (legacy) and date-subfolder structure (Granola resync).
 * Returns objects with `filename` (for matching) and `fullPath` (for reading).
 */
function collectMeetingFiles(meetingsDir: string): { filename: string; fullPath: string }[] {
  if (!fs.existsSync(meetingsDir)) return [];
  const results: { filename: string; fullPath: string }[] = [];
  try {
    for (const entry of fs.readdirSync(meetingsDir)) {
      if (entry.startsWith(".") || entry === "transcripts") continue;
      const entryPath = path.join(meetingsDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isFile() && entry.endsWith(".md")) {
        // Legacy flat file
        results.push({ filename: entry, fullPath: entryPath });
      } else if (stat.isDirectory()) {
        // Date subfolder — collect .md files inside
        try {
          for (const sub of fs.readdirSync(entryPath)) {
            if (sub.endsWith(".md") && !sub.startsWith(".")) {
              results.push({ filename: sub, fullPath: path.join(entryPath, sub) });
            }
          }
        } catch {
          // Skip unreadable subfolder
        }
      }
    }
  } catch {
    // Continue without meetings
  }
  return results;
}

/**
 * Get all people from the vault, sorted by name.
 */
export async function getAllPeople(
  vaultPath: string,
): Promise<BridgePeopleResponse> {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");

  // Read index
  const indexPath = path.join(peopleDir, "index.md");
  let indexMap: Record<string, string> = {};
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      indexMap = parsePeopleIndex(indexContent);
    } catch {
      // Continue with empty index
    }
  }

  // Get meeting files for counting (supports nested date folders)
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);

  // Pre-read all meeting frontmatter once (shared by person matching + inbox stats + suggested)
  const meetingMetaCache = new Map<string, { title: string; created: string }>();
  for (const entry of meetingFileEntries) {
    try {
      const content = fs.readFileSync(entry.fullPath, "utf-8");
      const meta = parseMeetingFrontmatter(content, entry.filename);
      meetingMetaCache.set(entry.filename, { title: meta.title, created: meta.created });
    } catch {
      // Skip unreadable
    }
  }

  // Track which meeting files are claimed by any person
  const claimedMeetings = new Set<string>();

  // Read each person file
  const people: BridgePerson[] = [];
  const entries = fs.existsSync(peopleDir)
    ? fs.readdirSync(peopleDir).filter((f) => f.endsWith(".md") && f !== "index.md" && !f.startsWith("."))
    : [];

  for (const filename of entries) {
    const slug = filename.replace(/\.md$/, "");
    const filePath = path.join(peopleDir, filename);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const description = indexMap[slug] || "";
      const person = parsePersonFile(content, slug, description);

      // Add Granola meeting count
      const matchedMeetings = matchMeetingsToSlug(
        slug,
        person.name,
        meetingFilenames,
        person.aliases,
      );
      person.meetingCount += matchedMeetings.length;

      // Track claimed meetings and update lastMeetingDate (full timestamp for accurate relative time)
      for (const mf of matchedMeetings) {
        claimedMeetings.add(mf);
        const meta = meetingMetaCache.get(mf);
        if (meta?.created) {
          if (!person.lastMeetingDate || meta.created > person.lastMeetingDate) {
            person.lastMeetingDate = meta.created;
          }
        }
      }

      people.push(person);
    } catch {
      // Skip unreadable person file
    }
  }

  // Sort by most recently updated (lastMeetingDate descending, then name)
  people.sort((a, b) => {
    const dateA = a.lastMeetingDate || "";
    const dateB = b.lastMeetingDate || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return a.name.localeCompare(b.name);
  });

  // Compute inbox stats from all meetings
  let inboxStats: BridgePeopleResponse["inboxStats"] = null;
  if (meetingFileEntries.length > 0) {
    let newestDate = "";
    let newestTitle = "";
    for (const [, meta] of meetingMetaCache) {
      if (meta.created && meta.created > newestDate) {
        newestDate = meta.created;
        newestTitle = meta.title;
      }
    }
    inboxStats = {
      totalMeetings: meetingFileEntries.length,
      lastMeetingTitle: newestTitle,
      lastMeetingDate: newestDate,
    };
  }

  // Compute suggested meetings: unmatched meetings grouped by normalized name (3+ occurrences)
  const suggestedMeetings: SuggestedMeeting[] = [];
  const nameGroups = new Map<string, { count: number; lastDate: string }>();
  for (const entry of meetingFileEntries) {
    if (claimedMeetings.has(entry.filename)) continue;
    const normalized = normalizeMeetingName(entry.filename);
    if (!normalized) continue;

    const meta = meetingMetaCache.get(entry.filename);
    const date = meta?.created ? meta.created.slice(0, 10) : "";

    const existing = nameGroups.get(normalized);
    if (existing) {
      existing.count++;
      if (date > existing.lastDate) existing.lastDate = date;
    } else {
      nameGroups.set(normalized, { count: 1, lastDate: date });
    }
  }

  for (const [name, { count, lastDate }] of nameGroups) {
    if (count >= 3) {
      suggestedMeetings.push({ name, count, lastDate });
    }
  }
  suggestedMeetings.sort((a, b) => b.count - a.count);

  return { vaultPath, people, inboxStats, suggestedMeetings };
}

/**
 * Normalize a meeting filename to its recurring series name.
 * Strips .md extension and date/time suffix: "Design review-2026-03-05 @ 12-00-38.md" → "Design review"
 */
export function normalizeMeetingName(filename: string): string {
  const base = filename.replace(/\.md$/, "");
  return base.replace(/-\d{4}-\d{2}-\d{2}\s*@\s*\d{2}-\d{2}-\d{2}$/, "").trim();
}

/**
 * Get ALL meetings from the vault with person-match tags.
 * Returns every meeting file, sorted newest-first, with matchedPeople populated.
 * If `filterName` is provided, only returns unmatched meetings whose normalized filename equals it.
 */
export async function getAllMeetings(vaultPath: string, filterName?: string): Promise<InboxDetail> {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");

  // Collect all meeting files
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);

  // Load all person files and build inverted index: filename → person names
  const personMatches = new Map<string, string[]>();
  const entries = fs.existsSync(peopleDir)
    ? fs.readdirSync(peopleDir).filter((f) => f.endsWith(".md") && f !== "index.md" && !f.startsWith("."))
    : [];

  // Read index for descriptions (needed by parsePersonFile)
  const indexPath = path.join(peopleDir, "index.md");
  let indexMap: Record<string, string> = {};
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      indexMap = parsePeopleIndex(indexContent);
    } catch { /* continue */ }
  }

  for (const filename of entries) {
    const slug = filename.replace(/\.md$/, "");
    const filePath = path.join(peopleDir, filename);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const person = parsePersonFile(content, slug, indexMap[slug] || "");
      const matched = matchMeetingsToSlug(slug, person.name, meetingFilenames, person.aliases);
      for (const mf of matched) {
        const existing = personMatches.get(mf) || [];
        existing.push(person.name);
        personMatches.set(mf, existing);
      }
    } catch { /* skip */ }
  }

  // Build meeting list
  const meetings: PersonMeeting[] = [];
  for (const entry of meetingFileEntries) {
    // When filtering by suggested name: only include unmatched meetings with matching normalized name
    if (filterName) {
      const matched = personMatches.get(entry.filename);
      if (matched && matched.length > 0) continue;
      if (normalizeMeetingName(entry.filename) !== filterName) continue;
    }
    try {
      const content = fs.readFileSync(entry.fullPath, "utf-8");
      const meta = parseMeetingFrontmatter(content, entry.filename);
      const date = meta.created ? meta.created.slice(0, 10) : "";
      meetings.push({
        source: "granola",
        date,
        time: meta.created || undefined,
        title: meta.title || entry.filename.replace(/\.md$/, ""),
        filePath: entry.fullPath,
        transcriptPath: meta.transcript
          ? path.join(vaultPath, meta.transcript)
          : undefined,
        summary: meta.body,
        matchedPeople: filterName ? [] : (personMatches.get(entry.filename) || []),
      });
    } catch { /* skip */ }
  }

  // Sort newest first
  meetings.sort((a, b) => b.date.localeCompare(a.date));

  return { meetings, totalCount: meetings.length, vaultPath };
}

/**
 * Parse the ## Next section to extract an optional date and the content body.
 * Format: first line may be "date: YYYY-MM-DD", rest is content.
 */
export function parseNextSection(nextRaw: string): { date: string | null; content: string } {
  const lines = nextRaw.split("\n");
  const dateMatch = lines[0]?.match(/^date:\s*(\d{4}-\d{2}-\d{2})\s*$/);
  if (dateMatch) {
    return {
      date: dateMatch[1],
      content: lines.slice(1).join("\n").trim(),
    };
  }
  return { date: null, content: nextRaw.trim() };
}

function normalizeTitle(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeNotes(notes: string): string {
  return notes.trim().replace(/\s+/g, " ");
}

function meetingSortKey(meeting: PersonMeeting): string {
  return meeting.time || meeting.date;
}

function meetingTimestamp(meeting: PersonMeeting): number | null {
  const raw = meeting.time || meeting.date;
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function parseNextSavedAt(fileContent: string): Date | null {
  const { fm } = parseFrontmatter(fileContent);
  const raw = fm[NEXT_SAVED_AT_FIELD];
  if (!raw) return null;

  const savedAt = new Date(raw);
  return Number.isNaN(savedAt.getTime()) ? null : savedAt;
}

function extractNextRaw(fileContent: string): string {
  const { body } = parseFrontmatter(fileContent);
  const nextRawMatch = body.match(/^##[ \t]+Next[ \t]*\n([\s\S]*?)(?=^##[ \t]+Notes[ \t]*$|(?![\s\S]))/m);
  return nextRawMatch ? nextRawMatch[1].trim() : "";
}

function parseInlineMeetings(fileContent: string): InlineNoteMeeting[] {
  const { body } = parseFrontmatter(fileContent);
  const meetings: InlineNoteMeeting[] = [];
  const notesMatch = body.match(/^##[ \t]+Notes[ \t]*\n([\s\S]*)/m);
  if (!notesMatch) return meetings;

  const notesBlock = notesMatch[1];
  const sections = notesBlock.split(/(?=^###\s+\d{4}-\d{2}-\d{2})/m);
  for (const section of sections) {
    const headingMatch = section.match(/^###[ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+(?:—|-)[ \t]+(.+))?/);
    if (!headingMatch) continue;

    const date = headingMatch[1];
    const noteTitle = headingMatch[2]?.trim();
    const notes = section.replace(/^###\s+.+\n?/, "").trim();
    meetings.push({
      source: "inline",
      date,
      title: noteTitle || "Notes",
      notes,
      noteTitle,
    });
  }

  return meetings;
}

function findMatchingInlineNote(
  inlineMeetings: InlineNoteMeeting[],
  granolaMeeting: PersonMeeting,
  usedIndexes: Set<number>,
): number | null {
  const exactTitleIndex = inlineMeetings.findIndex((meeting, index) =>
    !usedIndexes.has(index) &&
    meeting.date === granolaMeeting.date &&
    !!meeting.noteTitle &&
    normalizeTitle(meeting.noteTitle) === normalizeTitle(granolaMeeting.title)
  );
  if (exactTitleIndex !== -1) return exactTitleIndex;

  const sameDateIndexes = inlineMeetings
    .map((meeting, index) => ({ meeting, index }))
    .filter(({ meeting, index }) => !usedIndexes.has(index) && meeting.date === granolaMeeting.date);

  if (sameDateIndexes.length === 1) return sameDateIndexes[0].index;

  const untitledSameDate = sameDateIndexes.find(({ meeting }) => !meeting.noteTitle);
  return untitledSameDate?.index ?? null;
}

function mergeInlineNotesIntoGranola(
  granolaMeetings: PersonMeeting[],
  inlineMeetings: InlineNoteMeeting[],
): PersonMeeting[] {
  const usedInlineIndexes = new Set<number>();
  const mergedGranola = granolaMeetings.map((meeting) => {
    const inlineIndex = findMatchingInlineNote(inlineMeetings, meeting, usedInlineIndexes);
    if (inlineIndex === null) return meeting;

    usedInlineIndexes.add(inlineIndex);
    return {
      ...meeting,
      notes: inlineMeetings[inlineIndex].notes,
    };
  });

  return [
    ...mergedGranola,
    ...inlineMeetings.filter((_, index) => !usedInlineIndexes.has(index)),
  ];
}

function shouldPromoteNextToMeeting(
  next: { date: string | null; content: string },
  meeting: PersonMeeting | undefined,
  nextSavedAt?: Date,
): meeting is PersonMeeting {
  if (!next.content || !meeting) return false;

  if (nextSavedAt) {
    const meetingTime = meetingTimestamp(meeting);
    if (meetingTime !== null) return meetingTime >= nextSavedAt.getTime();

    const savedDate = nextSavedAt.toISOString().slice(0, 10);
    return meeting.date >= savedDate;
  }

  const today = new Date().toISOString().slice(0, 10);
  return meeting.date === today;
}

function findPromotionTarget(
  next: { date: string | null; content: string },
  meetings: PersonMeeting[],
  nextSavedAt?: Date,
): PersonMeeting | undefined {
  return meetings
    .filter((meeting) => shouldPromoteNextToMeeting(next, meeting, nextSavedAt))
    .sort((a, b) => meetingSortKey(a).localeCompare(meetingSortKey(b)))[0];
}

function findDatedNotesSection(
  body: string,
  date: string,
  noteTitle?: string,
): { heading: string; noteTitle?: string; start: number; end: number } | null {
  const headingRegex = /^###[ \t]+(\d{4}-\d{2}-\d{2})(?:[ \t]+(?:—|-)[ \t]+(.+))?[ \t]*$/gm;
  const candidates: { heading: string; noteTitle?: string; start: number; end: number }[] = [];
  let match: RegExpExecArray | null;

  while ((match = headingRegex.exec(body)) !== null) {
    if (match[1] !== date) continue;

    const nextHeadingRegex = /^###[ \t]+\d{4}-\d{2}-\d{2}(?:[ \t]+(?:—|-)[ \t]+.+)?[ \t]*$/gm;
    nextHeadingRegex.lastIndex = headingRegex.lastIndex;
    const nextHeading = nextHeadingRegex.exec(body);
    candidates.push({
      heading: match[0],
      noteTitle: match[2]?.trim(),
      start: match.index,
      end: nextHeading?.index ?? body.length,
    });
  }

  if (!noteTitle) return candidates[0] ?? null;

  const exactTitle = candidates.find((candidate) =>
    candidate.noteTitle && normalizeTitle(candidate.noteTitle) === normalizeTitle(noteTitle)
  );
  if (exactTitle) return exactTitle;

  if (candidates.length === 1) return candidates[0];
  return candidates.find((candidate) => !candidate.noteTitle) ?? null;
}

/**
 * Decay the ## Next section: move its content into ## Notes ### YYYY-MM-DD,
 * then clear ## Next. Returns the updated file content.
 */
export function decayNext(fileContent: string, date: string): string {
  const nextRaw = extractNextRaw(fileContent);
  if (!nextRaw) return fileContent;

  const { content } = parseNextSection(nextRaw);
  if (!content) return fileContent; // Nothing to decay

  // Insert content as a dated notes section, then clear Next
  let updated = updatePersonNotes(fileContent, date, content);
  updated = updatePersonNext(updated, "");
  return updated;
}

export function extractPersonNotes(fileContent: string, date: string, noteTitle?: string): string {
  const { body } = parseFrontmatter(fileContent);
  const section = findDatedNotesSection(body, date, noteTitle);
  if (!section) return "";

  let notes = body.slice(section.start + section.heading.length, section.end);
  if (notes.startsWith("\n")) notes = notes.slice(1);
  return notes.trim();
}

/**
 * Delete a dated notes section (### YYYY-MM-DD) from a person's markdown file.
 * Removes the heading and all content until the next ### or end of ## Notes.
 */
export function deletePersonNotes(fileContent: string, date: string, noteTitle?: string): string {
  const { fm, body } = parseFrontmatter(fileContent);

  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  const section = findDatedNotesSection(body, date, noteTitle);
  if (!section) return fmBlock + body;

  const before = body.slice(0, section.start).replace(/\n{3,}$/, "\n\n");
  const after = body.slice(section.end).replace(/^\n{2,}/, "\n");
  const updatedBody = before + after;
  return fmBlock + updatedBody;
}

/**
 * Update a specific dated notes section in a person's markdown file.
 * Finds ### YYYY-MM-DD and replaces the content until the next ### or end of file.
 */
export function updatePersonNotes(
  fileContent: string,
  date: string,
  newNotes: string,
  noteTitle?: string,
): string {
  const { fm, body } = parseFrontmatter(fileContent);

  // Reconstruct frontmatter
  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  // Find the matching dated section and replace its content. When a title is
  // provided, only replace that exact meeting's written notes.
  const section = findDatedNotesSection(body, date, noteTitle);
  if (section) {
    const before = body.slice(0, section.start);
    const after = body.slice(section.end);
    const heading = noteTitle ? `### ${date} - ${noteTitle}` : section.heading;
    const updatedBody = `${before}${heading}\n\n${newNotes}\n${after}`;
    return fmBlock + updatedBody;
  }

  // Section not found — append to end of ## Notes
  const heading = noteTitle ? `${date} - ${noteTitle}` : date;
  const notesHeaderMatch = body.match(/^(##\s+Notes\s*\n)/m);
  if (notesHeaderMatch) {
    const insertPos = body.indexOf(notesHeaderMatch[0]) + notesHeaderMatch[0].length;
    const before = body.slice(0, insertPos);
    const after = body.slice(insertPos);
    return fmBlock + before + `\n### ${heading}\n\n${newNotes}\n` + after;
  }

  // No ## Notes section — append one
  return fmBlock + body + `\n\n## Notes\n\n### ${heading}\n\n${newNotes}\n`;
}

/**
 * Update the ## Next section in a person's markdown file.
 * Finds ## Next and replaces content until the next ## heading.
 */
export function updatePersonNext(
  fileContent: string,
  newNext: string,
): string {
  const { fm, body } = parseFrontmatter(fileContent);

  if (newNext.trim()) {
    fm[NEXT_SAVED_AT_FIELD] = new Date().toISOString();
  } else {
    delete fm[NEXT_SAVED_AT_FIELD];
  }

  // Reconstruct frontmatter
  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  // Find ## Next section and replace its content
  const nextRegex = /^(##[ \t]+Next[ \t]*\n)([\s\S]*?)(?=^##[ \t]+Notes[ \t]*$|(?![\s\S]))/m;
  const match = body.match(nextRegex);
  if (match) {
    const updatedBody = body.replace(nextRegex, `$1\n${newNext}\n`);
    return fmBlock + updatedBody;
  }

  // No ## Next section — insert before ## Notes (or append)
  const notesHeaderMatch = body.match(/^(##\s+Notes)/m);
  if (notesHeaderMatch) {
    const insertPos = body.indexOf(notesHeaderMatch[0]);
    const before = body.slice(0, insertPos);
    const after = body.slice(insertPos);
    return fmBlock + before + `## Next\n\n${newNext}\n\n` + after;
  }

  // No ## Notes either — append
  return fmBlock + body + `\n\n## Next\n\n${newNext}\n`;
}

/**
 * Get full detail for a single person, including meeting timeline.
 */
export async function getPersonDetail(
  vaultPath: string,
  slug: string,
): Promise<PersonDetail | null> {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");

  // Read index for description
  const indexPath = path.join(peopleDir, "index.md");
  let description = "";
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      const indexMap = parsePeopleIndex(indexContent);
      description = indexMap[slug] || "";
    } catch {
      // Continue
    }
  }

  // Read person file
  const filePath = path.join(peopleDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const personFileStat = fs.statSync(filePath);
  let person = parsePersonFile(content, slug, description);

  // Extract raw ## Next scratchpad content. "Next" is tied to the next
  // recorded meeting after it was saved, not to a manually chosen date.
  let nextRaw = extractNextRaw(content);
  let parsedNext = { date: null as string | null, content: nextRaw.trim() };
  const nextSavedAt = parseNextSavedAt(content) ?? personFileStat.mtime;

  // Match Granola meetings (supports nested date folders)
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);
  const meetingFileMap = new Map(meetingFileEntries.map((e) => [e.filename, e.fullPath]));

  const granolaMeetings: PersonMeeting[] = [];
  const matchedMeetings = matchMeetingsToSlug(slug, person.name, meetingFilenames, person.aliases);
  for (const mf of matchedMeetings) {
    const mfPath = meetingFileMap.get(mf);
    if (!mfPath) continue;
    try {
      const mfContent = fs.readFileSync(mfPath, "utf-8");
      const mfMeta = parseMeetingFrontmatter(mfContent, mf);
      const date = mfMeta.created ? mfMeta.created.slice(0, 10) : "";
      const { body: mfBody } = parseFrontmatter(mfContent);
      const summary = mfBody.trim();

      granolaMeetings.push({
        source: "granola",
        date,
        time: mfMeta.created || undefined,
        title: mfMeta.title || mf.replace(/\.md$/, ""),
        filePath: mfPath,
        transcriptPath: mfMeta.transcript
          ? path.join(vaultPath, mfMeta.transcript)
          : undefined,
        summary,
      });
    } catch {
      // Skip unreadable meeting
    }
  }
  granolaMeetings.sort((a, b) => meetingSortKey(b).localeCompare(meetingSortKey(a)));

  let inlineMeetings = parseInlineMeetings(content);
  const promotionTarget = findPromotionTarget(parsedNext, granolaMeetings, nextSavedAt);

  if (promotionTarget && parsedNext.content) {
    const matchingIndex = findMatchingInlineNote(inlineMeetings, promotionTarget, new Set());
    const existingNotes = matchingIndex === null ? "" : inlineMeetings[matchingIndex].notes || "";
    const shouldAppend = !existingNotes || !normalizeNotes(existingNotes).includes(normalizeNotes(parsedNext.content));
    const promotedNotes = existingNotes && shouldAppend
      ? `${existingNotes}\n\n${parsedNext.content}`
      : existingNotes || parsedNext.content;

    if (shouldAppend || existingNotes) {
      let promotedContent = updatePersonNotes(
        content,
        promotionTarget.date,
        promotedNotes,
        promotionTarget.title,
      );
      promotedContent = updatePersonNext(promotedContent, "");

      const tmpPath = filePath + ".tmp." + Date.now();
      fs.writeFileSync(tmpPath, promotedContent, "utf-8");
      fs.renameSync(tmpPath, filePath);

      content = promotedContent;
      person = parsePersonFile(content, slug, description);
      nextRaw = extractNextRaw(content);
      parsedNext = { date: null, content: nextRaw.trim() };
      inlineMeetings = parseInlineMeetings(content);
    }
  }

  const meetings = mergeInlineNotesIntoGranola(granolaMeetings, inlineMeetings);
  meetings.sort((a, b) => meetingSortKey(b).localeCompare(meetingSortKey(a)));

  // Update counts to reflect total
  const totalMeetings = meetings.length;
  const latestTimestamp = meetings.length > 0 ? meetingSortKey(meetings[0]) : null;

  return {
    ...person,
    meetingCount: totalMeetings,
    lastMeetingDate: latestTimestamp,
    nextRaw,
    meetings,
    personFilePath: filePath,
  };
}
