import * as fs from "fs";
import * as path from "path";
import type {
  BridgePerson,
  BridgePeopleResponse,
  PersonMeeting,
  PersonDetail,
  InboxDetail,
  PersonCalendarCandidate,
  SuggestedMeeting,
} from "../types";
import type { CalendarEvent, CalendarEventNoteTarget } from "../calendar/types";
import { resolvePersonCalendarLinks } from "./person-calendar";

interface InlineNoteMeeting extends PersonMeeting {
  noteTitle?: string;
}

interface MeetingFileEntry {
  filename: string;
  fullPath: string;
  transcriptOnly?: boolean;
}

const NEXT_SAVED_AT_FIELD = "next_saved_at";
const NEXT_CALENDAR_SERIES_KEY_FIELD = "next_calendar_series_key";
const NEXT_CALENDAR_EVENT_ID_FIELD = "next_calendar_event_id";
const NEXT_CALENDAR_EVENT_START_FIELD = "next_calendar_event_start";
const NEXT_CALENDAR_TITLE_FIELD = "next_calendar_title";
const NEXT_CALENDAR_FIELDS = [
  NEXT_CALENDAR_SERIES_KEY_FIELD,
  NEXT_CALENDAR_EVENT_ID_FIELD,
  NEXT_CALENDAR_EVENT_START_FIELD,
  NEXT_CALENDAR_TITLE_FIELD,
];
const BRIDGE_PREFS_FILE = ".hilt-preferences.json";
const HIDDEN_SUGGESTIONS_KEY = "people.hiddenSuggestions";

type SuggestedPersonType = "person" | "group";

interface HiddenSuggestionSnapshot {
  count: number;
  lastDate: string;
  hiddenAt: string;
}

interface NextCalendarContext {
  seriesKey: string | null;
  eventId: string | null;
  eventStart: string | null;
  title: string | null;
}

interface PersonSeriesHistory {
  slug: string;
  name: string;
  personType: "person" | "group";
  seriesKey: string;
  method: PersonCalendarCandidate["method"];
  uid: string | null;
  title: string;
  normalizedTitle: string;
  historicalCount: number;
  lastSeenAt: string | null;
}

function readBridgePrefs(vaultPath: string): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(path.join(vaultPath, BRIDGE_PREFS_FILE), "utf-8");
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeBridgePrefs(vaultPath: string, prefs: Record<string, unknown>): void {
  fs.writeFileSync(
    path.join(vaultPath, BRIDGE_PREFS_FILE),
    JSON.stringify(prefs, null, 2) + "\n",
    "utf-8",
  );
}

function readHiddenSuggestions(vaultPath: string): Record<string, HiddenSuggestionSnapshot> {
  const prefs = readBridgePrefs(vaultPath);
  const raw = prefs[HIDDEN_SUGGESTIONS_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as Record<string, HiddenSuggestionSnapshot>;
}

function writeHiddenSuggestions(
  vaultPath: string,
  hiddenSuggestions: Record<string, HiddenSuggestionSnapshot>,
): void {
  const prefs = readBridgePrefs(vaultPath);
  prefs[HIDDEN_SUGGESTIONS_KEY] = hiddenSuggestions;
  writeBridgePrefs(vaultPath, prefs);
}

function isSuggestionHidden(
  suggestion: SuggestedMeeting,
  hiddenSuggestions: Record<string, HiddenSuggestionSnapshot>,
): boolean {
  const hidden = hiddenSuggestions[suggestion.name];
  if (!hidden) return false;

  return hidden.count >= suggestion.count && hidden.lastDate >= suggestion.lastDate;
}

function slugifyPersonName(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "person";
}

function uniquePersonSlug(peopleDir: string, baseSlug: string): string {
  let slug = baseSlug;
  let suffix = 2;
  while (fs.existsSync(path.join(peopleDir, `${slug}.md`))) {
    slug = `${baseSlug}-${suffix}`;
    suffix++;
  }
  return slug;
}

function sanitizeIndexDescription(description: string): string {
  return description.replace(/\s+/g, " ").trim();
}

function insertPersonIndexEntry(
  indexContent: string,
  slug: string,
  type: SuggestedPersonType,
  description: string,
): string {
  if (indexContent.includes(`[[${slug}]]`)) return indexContent;

  const heading = type === "group" ? "## Groups" : "## People";
  const sanitizedDescription = sanitizeIndexDescription(description);
  const entry = sanitizedDescription
    ? `- [[${slug}]] — ${sanitizedDescription}\n`
    : `- [[${slug}]]\n`;
  const headingRegex = new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`, "m");
  const headingMatch = headingRegex.exec(indexContent);

  if (!headingMatch) {
    return `${indexContent.replace(/\s*$/, "")}\n\n${heading}\n\n${entry}`;
  }

  const sectionStart = headingMatch.index + headingMatch[0].length;
  const afterHeading = indexContent.slice(sectionStart);
  const nextHeadingMatch = /^##\s+/m.exec(afterHeading);
  const insertAt = nextHeadingMatch ? sectionStart + nextHeadingMatch.index : indexContent.length;
  const before = indexContent.slice(0, insertAt).replace(/\s*$/, "\n");
  const after = indexContent.slice(insertAt).replace(/^\n*/, "");

  return `${before}${entry}${after ? `\n${after}` : ""}`;
}

function updatePersonIndexEntry(
  indexContent: string,
  slug: string,
  type: SuggestedPersonType,
  description: string,
): string {
  const sanitizedDescription = sanitizeIndexDescription(description);
  const entry = sanitizedDescription
    ? `- [[${slug}]] — ${sanitizedDescription}`
    : `- [[${slug}]]`;
  const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const entryRegex = new RegExp(`^\\s*-\\s*\\[\\[${escapedSlug}\\]\\]\\s*(?:(?:—|--)\\s*.*)?$`, "m");

  if (entryRegex.test(indexContent)) {
    return indexContent.replace(entryRegex, entry);
  }

  return insertPersonIndexEntry(indexContent, slug, type, sanitizedDescription);
}

function normalizeAliasesForWrite(aliases: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const alias of aliases) {
    const trimmed = alias.replace(/\s+/g, " ").trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

function updateFrontmatterField(content: string, key: string, value: string): string {
  const fieldLine = `${key}: ${value}`;

  if (!content.startsWith("---")) {
    return `---\n${fieldLine}\n---\n\n${content.replace(/^\s+/, "")}`;
  }

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) {
    return `---\n${fieldLine}\n---\n\n${content}`;
  }

  const frontmatter = content.slice(4, endIdx);
  const body = content.slice(endIdx);
  const lines = frontmatter.split("\n");
  const fieldIndex = lines.findIndex((line) => {
    const colonIdx = line.indexOf(":");
    return colonIdx > 0 && line.slice(0, colonIdx).trim() === key;
  });

  if (fieldIndex === -1) {
    lines.push(fieldLine);
  } else {
    lines[fieldIndex] = fieldLine;
  }

  return `---\n${lines.join("\n")}${body}`;
}

function updatePersonHeading(content: string, name: string): string {
  const normalizedName = name.replace(/\s+/g, " ").trim();
  if (!normalizedName) return content;

  if (/^#\s+.+$/m.test(content)) {
    return content.replace(/^#\s+.+$/m, `# ${normalizedName}`);
  }

  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const frontmatterEnd = endIdx + 4;
      const before = content.slice(0, frontmatterEnd).replace(/\s*$/, "\n\n");
      const after = content.slice(frontmatterEnd).replace(/^\s*/, "");
      return `${before}# ${normalizedName}\n\n${after}`;
    }
  }

  return `# ${normalizedName}\n\n${content.replace(/^\s+/, "")}`;
}

/**
 * Parse people/index.md to extract slug → description mapping.
 * Lines like: - [[amrit]] — Product counterpart
 */
export function parsePeopleIndex(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /^\s*-\s*\[\[([^\]]+)\]\]\s*(?:(?:—|--)\s*(.*))?$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    result[match[1].trim()] = (match[2] || "").trim();
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
  granolaUrl: string;
  calendarEventId: string;
  calendarIcalUid: string;
  hiltCalendarEventId: string;
  hiltCalendarMatchMethod: string;
  hiltCalendarMatchConfidence: number | null;
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
    granolaUrl: fm.granola_url || "",
    calendarEventId: fm.calendar_event_id || "",
    calendarIcalUid: fm.calendar_ical_uid || "",
    hiltCalendarEventId: fm.hilt_calendar_event_id || "",
    hiltCalendarMatchMethod: fm.hilt_calendar_match_method || "",
    hiltCalendarMatchConfidence: parseConfidence(fm.hilt_calendar_match_confidence),
    body: body.trim(),
  };
}

function parseConfidence(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function stripTranscriptSuffix(filename: string): string {
  return filename.replace(/\s*\(transcript\)(?=\.md$)/i, "");
}

function normalizeTranscriptTitle(title: string): string {
  return title
    .replace(/\s+-\s*Transcript$/i, "")
    .replace(/\s*\(transcript\)$/i, "")
    .trim();
}

function getMeetingTitle(meta: ReturnType<typeof parseMeetingFrontmatter>, entry: MeetingFileEntry): string {
  const title = meta.title || entry.filename.replace(/\.md$/, "");
  return entry.transcriptOnly ? normalizeTranscriptTitle(title) || title : title;
}

const CALENDAR_NOTE_TARGET_GRACE_MS = 12 * 60 * 60 * 1000;

export function attachPeopleNoteTargetsToCalendarEvents<T extends CalendarEvent>(
  events: T[],
  vaultPath: string,
  now = new Date(),
): T[] {
  if (!events.length) return events;
  const histories = buildPersonSeriesHistories(vaultPath);
  if (!histories.length) return events;

  return events.map((event) => {
    const noteTargets = resolveCalendarEventNoteTargetsFromHistories(event, histories, now);
    return noteTargets.length ? { ...event, noteTargets } : event;
  });
}

export function resolveCalendarEventNoteTargets(
  vaultPath: string,
  event: CalendarEvent,
  now = new Date(),
): CalendarEventNoteTarget[] {
  return resolveCalendarEventNoteTargetsFromHistories(event, buildPersonSeriesHistories(vaultPath), now);
}

function buildPersonSeriesHistories(vaultPath: string): PersonSeriesHistory[] {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");
  if (!fs.existsSync(peopleDir) || !fs.existsSync(meetingsDir)) return [];

  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((entry) => entry.filename);
  const meetingFileMap = new Map(meetingFileEntries.map((entry) => [entry.filename, entry]));
  const meetingMetaCache = new Map<string, ReturnType<typeof parseMeetingFrontmatter>>();
  for (const entry of meetingFileEntries) {
    try {
      meetingMetaCache.set(entry.filename, parseMeetingFrontmatter(fs.readFileSync(entry.fullPath, "utf-8"), entry.filename));
    } catch {
      // Skip unreadable meetings.
    }
  }

  const histories: PersonSeriesHistory[] = [];
  const peopleFiles = fs.readdirSync(peopleDir)
    .filter((filename) => filename.endsWith(".md") && filename !== "index.md" && !filename.startsWith("."));

  for (const filename of peopleFiles) {
    const slug = filename.replace(/\.md$/, "");
    try {
      const content = fs.readFileSync(path.join(peopleDir, filename), "utf-8");
      const person = parsePersonFile(content, slug, "");
      const matchedMeetings = matchMeetingsToSlug(slug, person.name, meetingFilenames, person.aliases);
      const bySeries = new Map<string, PersonSeriesHistory>();

      for (const meetingFilename of matchedMeetings) {
        const entry = meetingFileMap.get(meetingFilename);
        const meta = meetingMetaCache.get(meetingFilename);
        if (!entry || !meta) continue;

        const title = getMeetingTitle(meta, entry).trim();
        const normalizedTitle = normalizeTitle(title);
        if (!title || !normalizedTitle) continue;

        const seenAt = meta.created || null;
        const uid = meta.calendarIcalUid?.trim() || null;
        if (uid) {
          addSeriesHistory(bySeries, {
            slug,
            name: person.name,
            personType: person.type,
            seriesKey: `icaluid:${uid.toLowerCase()}`,
            method: "icaluid",
            uid,
            title,
            normalizedTitle,
            historicalCount: 1,
            lastSeenAt: seenAt,
          });
        }

        addSeriesHistory(bySeries, {
          slug,
          name: person.name,
          personType: person.type,
          seriesKey: `title:${normalizedTitle}`,
          method: "title",
          uid,
          title,
          normalizedTitle,
          historicalCount: 1,
          lastSeenAt: seenAt,
        });
      }

      histories.push(...bySeries.values());
    } catch {
      // Skip unreadable people files.
    }
  }

  return histories;
}

function addSeriesHistory(map: Map<string, PersonSeriesHistory>, next: PersonSeriesHistory): void {
  const existing = map.get(next.seriesKey);
  if (!existing) {
    map.set(next.seriesKey, next);
    return;
  }

  existing.historicalCount += next.historicalCount;
  if (next.lastSeenAt && (!existing.lastSeenAt || next.lastSeenAt > existing.lastSeenAt)) {
    existing.lastSeenAt = next.lastSeenAt;
    existing.title = next.title;
    existing.normalizedTitle = next.normalizedTitle;
    existing.uid = next.uid ?? existing.uid;
  }
}

function resolveCalendarEventNoteTargetsFromHistories(
  event: CalendarEvent,
  histories: PersonSeriesHistory[],
  now: Date,
): CalendarEventNoteTarget[] {
  if (!isCalendarEventEligibleForPeoplePrep(event, now)) return [];

  const normalizedTitle = normalizeTitle(event.title);
  if (!normalizedTitle) return [];

  const uid = event.uid?.trim() || null;
  const uidSeriesKey = uid ? `icaluid:${uid.toLowerCase()}` : null;
  const titleSeriesKey = `title:${normalizedTitle}`;
  const bestBySlug = new Map<string, { target: CalendarEventNoteTarget; score: number }>();

  for (const history of histories) {
    const exactUidMatch = Boolean(uidSeriesKey && history.seriesKey === uidSeriesKey);
    const exactTitleSeriesMatch = history.seriesKey === titleSeriesKey;
    const titleMatch = history.normalizedTitle === normalizedTitle || exactTitleSeriesMatch;
    if (!exactUidMatch && !titleMatch) continue;
    if (!exactUidMatch && !event.recurrence.recurring && history.historicalCount < 2) continue;

    const method: PersonCalendarCandidate["method"] = exactUidMatch ? "icaluid" : "title";
    const seriesKey = uid ? `icaluid:${uid.toLowerCase()}` : titleSeriesKey;
    const confidence = method === "icaluid"
      ? 1
      : Math.min(0.92, 0.66 + history.historicalCount * 0.06 + (event.recurrence.recurring ? 0.08 : 0));
    const target: CalendarEventNoteTarget = {
      kind: "person-next",
      slug: history.slug,
      name: history.name,
      personType: history.personType,
      candidate: {
        eventId: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        uid: uid ?? history.uid,
        seriesKey,
        method,
        confidence,
        historicalCount: history.historicalCount,
        lastSeenAt: history.lastSeenAt,
      },
      confidence,
      historicalCount: history.historicalCount,
      lastSeenAt: history.lastSeenAt,
      reason: exactUidMatch ? "Matched saved People history by iCal UID" : "Matched saved People history by recurring title",
    };
    const score = (exactUidMatch ? 10_000 : 1_000)
      + history.historicalCount * 50
      + (event.recurrence.recurring ? 25 : 0)
      + (history.lastSeenAt ? Math.min(25, Math.max(0, Date.parse(history.lastSeenAt) / 8.64e13)) : 0);
    const existing = bestBySlug.get(history.slug);
    if (!existing || score > existing.score) bestBySlug.set(history.slug, { target, score });
  }

  return Array.from(bestBySlug.values())
    .sort((a, b) => b.score - a.score)
    .map(({ target }) => target);
}

function isCalendarEventEligibleForPeoplePrep(event: CalendarEvent, now: Date): boolean {
  if (event.meetingNotes?.length) return false;
  if (event.allDay) return false;
  if (event.status?.toUpperCase() === "CANCELLED") return false;
  if (!event.title.trim() || event.title.trim() === "!" || event.title.trim() === "-") return false;
  return event.sortEnd >= now.getTime() - CALENDAR_NOTE_TARGET_GRACE_MS;
}

function resolveTranscriptPath(
  vaultPath: string,
  entry: MeetingFileEntry,
  transcript: string,
): string | undefined {
  if (entry.transcriptOnly) return entry.fullPath;
  return transcript ? path.join(vaultPath, transcript) : undefined;
}

function normalizeTranscriptNotePath(notePath: string, meetingsDir: string): string | null {
  const normalized = notePath
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .trim();
  if (!normalized) return null;

  if (path.isAbsolute(normalized)) {
    const rel = path.relative(meetingsDir, normalized);
    return rel.startsWith("..") || path.isAbsolute(rel) ? null : rel;
  }

  return normalized.replace(/^meetings[\\/]/, "");
}

/**
 * Collect all meeting .md files from the meetings directory.
 * Supports both flat files (legacy) and date-subfolder structure (Granola resync).
 * Returns objects with `filename` (for matching) and `fullPath` (for reading).
 */
function collectMeetingFiles(meetingsDir: string): MeetingFileEntry[] {
  if (!fs.existsSync(meetingsDir)) return [];
  const results: MeetingFileEntry[] = [];
  const noteRelativePaths = new Set<string>();

  const addMeetingNote = (filename: string, fullPath: string) => {
    results.push({ filename, fullPath });
    noteRelativePaths.add(path.relative(meetingsDir, fullPath));
  };

  try {
    for (const entry of fs.readdirSync(meetingsDir)) {
      if (entry.startsWith(".") || entry === "transcripts") continue;
      const entryPath = path.join(meetingsDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isFile() && entry.endsWith(".md")) {
        // Legacy flat file
        addMeetingNote(entry, entryPath);
      } else if (stat.isDirectory()) {
        // Date subfolder — collect .md files inside
        try {
          for (const sub of fs.readdirSync(entryPath)) {
            if (sub.endsWith(".md") && !sub.startsWith(".")) {
              addMeetingNote(sub, path.join(entryPath, sub));
            }
          }
        } catch {
          // Skip unreadable subfolder
        }
      }
    }

    // Some Granola syncs produce only a transcript file. Treat those as
    // recorded meetings too, but skip the transcript when the note exists.
    const transcriptsDir = path.join(meetingsDir, "transcripts");
    if (fs.existsSync(transcriptsDir)) {
      for (const entry of fs.readdirSync(transcriptsDir)) {
        if (entry.startsWith(".")) continue;
        const entryPath = path.join(transcriptsDir, entry);
        const stat = fs.statSync(entryPath);
        if (!stat.isDirectory()) continue;

        try {
          for (const sub of fs.readdirSync(entryPath)) {
            if (!sub.endsWith(".md") || sub.startsWith(".")) continue;

            const fullPath = path.join(entryPath, sub);
            let noteRelativePath: string | null = null;
            try {
              const { fm } = parseFrontmatter(fs.readFileSync(fullPath, "utf-8"));
              if (fm.note) {
                noteRelativePath = normalizeTranscriptNotePath(fm.note, meetingsDir);
              }
            } catch {
              // Fall back to filename convention below.
            }

            const filename = stripTranscriptSuffix(sub);
            const conventionalNotePath = path.join(entry, filename);
            if (
              (noteRelativePath && noteRelativePaths.has(noteRelativePath)) ||
              noteRelativePaths.has(conventionalNotePath)
            ) {
              continue;
            }

            results.push({ filename, fullPath, transcriptOnly: true });
          }
        } catch {
          // Skip unreadable transcript subfolder
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
      meetingMetaCache.set(entry.filename, { title: getMeetingTitle(meta, entry), created: meta.created });
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

  const hiddenSuggestions = readHiddenSuggestions(vaultPath);
  for (const [name, { count, lastDate }] of nameGroups) {
    if (count >= 3) {
      const suggestion = { name, count, lastDate };
      if (!isSuggestionHidden(suggestion, hiddenSuggestions)) {
        suggestedMeetings.push(suggestion);
      }
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

export function hideSuggestedMeeting(
  vaultPath: string,
  suggestion: Pick<SuggestedMeeting, "name" | "count" | "lastDate">,
): void {
  const hiddenSuggestions = readHiddenSuggestions(vaultPath);
  hiddenSuggestions[suggestion.name] = {
    count: suggestion.count,
    lastDate: suggestion.lastDate,
    hiddenAt: new Date().toISOString(),
  };
  writeHiddenSuggestions(vaultPath, hiddenSuggestions);
}

export function promoteSuggestedMeeting(
  vaultPath: string,
  input: {
    name: string;
    type: SuggestedPersonType;
    description?: string;
  },
): BridgePerson {
  const name = input.name.trim();
  if (!name) {
    throw new Error("name is required");
  }

  const peopleDir = path.join(vaultPath, "people");
  fs.mkdirSync(peopleDir, { recursive: true });

  const slug = uniquePersonSlug(peopleDir, slugifyPersonName(name));
  const today = new Date().toISOString().slice(0, 10);
  const fileContent = `---
type: ${input.type}
created: ${today}
aliases: ${JSON.stringify([name])}
---

# ${name}

## Next

## Notes
`;

  fs.writeFileSync(path.join(peopleDir, `${slug}.md`), fileContent, "utf-8");

  const indexPath = path.join(peopleDir, "index.md");
  const existingIndex = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, "utf-8")
    : "# People\n";
  const updatedIndex = insertPersonIndexEntry(
    existingIndex,
    slug,
    input.type,
    input.description || "",
  );
  fs.writeFileSync(indexPath, updatedIndex, "utf-8");

  const hiddenSuggestions = readHiddenSuggestions(vaultPath);
  delete hiddenSuggestions[name];
  writeHiddenSuggestions(vaultPath, hiddenSuggestions);

  return parsePersonFile(fileContent, slug, sanitizeIndexDescription(input.description || ""));
}

export function updatePersonMetadata(
  vaultPath: string,
  slug: string,
  input: {
    name?: string;
    description?: string;
    aliases?: string[];
  },
): BridgePerson {
  const peopleDir = path.join(vaultPath, "people");
  const filePath = path.join(peopleDir, `${slug}.md`);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Person not found: ${slug}`);
  }

  const indexPath = path.join(peopleDir, "index.md");
  const existingIndex = fs.existsSync(indexPath)
    ? fs.readFileSync(indexPath, "utf-8")
    : "# People\n";
  const indexMap = parsePeopleIndex(existingIndex);
  const currentDescription = indexMap[slug] || "";
  const originalContent = fs.readFileSync(filePath, "utf-8");
  const currentPerson = parsePersonFile(originalContent, slug, currentDescription);

  const name = input.name?.trim() || currentPerson.name;
  const description = input.description != null
    ? sanitizeIndexDescription(input.description)
    : currentPerson.description;
  const aliases = input.aliases
    ? normalizeAliasesForWrite(input.aliases)
    : currentPerson.aliases;

  let updatedContent = updatePersonHeading(originalContent, name);
  updatedContent = updateFrontmatterField(updatedContent, "aliases", JSON.stringify(aliases));
  fs.writeFileSync(filePath, updatedContent, "utf-8");

  const updatedIndex = updatePersonIndexEntry(existingIndex, slug, currentPerson.type, description);
  fs.writeFileSync(indexPath, updatedIndex, "utf-8");

  return parsePersonFile(updatedContent, slug, description);
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
        title: getMeetingTitle(meta, entry),
        filePath: entry.fullPath,
        transcriptPath: resolveTranscriptPath(vaultPath, entry, meta.transcript),
        summary: entry.transcriptOnly ? undefined : meta.body,
        granolaId: meta.granolaId || undefined,
        granolaUrl: meta.granolaUrl || undefined,
        calendarEventId: meta.calendarEventId || undefined,
        calendarIcalUid: meta.calendarIcalUid || undefined,
        hiltCalendarEventId: meta.hiltCalendarEventId || undefined,
        hiltCalendarMatchMethod: meta.hiltCalendarMatchMethod || undefined,
        hiltCalendarMatchConfidence: meta.hiltCalendarMatchConfidence ?? undefined,
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

function parseNextCalendarContext(fileContent: string): NextCalendarContext {
  const { fm } = parseFrontmatter(fileContent);
  return {
    seriesKey: fm[NEXT_CALENDAR_SERIES_KEY_FIELD] || null,
    eventId: fm[NEXT_CALENDAR_EVENT_ID_FIELD] || null,
    eventStart: fm[NEXT_CALENDAR_EVENT_START_FIELD] || null,
    title: fm[NEXT_CALENDAR_TITLE_FIELD] || null,
  };
}

function applyNextCalendarFields(
  fm: Record<string, string>,
  candidate: PersonCalendarCandidate | null | undefined,
): void {
  for (const field of NEXT_CALENDAR_FIELDS) delete fm[field];
  if (!candidate) return;
  fm[NEXT_CALENDAR_SERIES_KEY_FIELD] = candidate.seriesKey;
  fm[NEXT_CALENDAR_EVENT_ID_FIELD] = candidate.eventId;
  fm[NEXT_CALENDAR_EVENT_START_FIELD] = candidate.start;
  fm[NEXT_CALENDAR_TITLE_FIELD] = candidate.title;
}

function extractNextRaw(fileContent: string): string {
  const { body } = parseFrontmatter(fileContent);
  const nextRawMatch = body.match(/^##[ \t]+Next[ \t]*\n([\s\S]*?)(?=^##[ \t]+Notes[ \t]*$|(?![\s\S]))/m);
  return nextRawMatch ? nextRawMatch[1].trim() : "";
}

export function extractPersonNextRaw(fileContent: string): string {
  return extractNextRaw(fileContent);
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

  if (sameDateIndexes.length === 1 && !sameDateIndexes[0].meeting.noteTitle) return sameDateIndexes[0].index;

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
  calendarContext?: NextCalendarContext,
): PersonMeeting | undefined {
  const eligible = meetings
    .filter((meeting) => shouldPromoteNextToMeeting(next, meeting, nextSavedAt))
    .sort((a, b) => meetingSortKey(a).localeCompare(meetingSortKey(b)));
  const firstKey = eligible[0] ? meetingSortKey(eligible[0]) : null;
  if (!firstKey) return undefined;

  const firstActualMeetings = eligible.filter((meeting) => meetingSortKey(meeting) === firstKey);
  return firstActualMeetings
    .sort((a, b) => promotionCalendarRank(a, calendarContext) - promotionCalendarRank(b, calendarContext))[0];
}

function promotionCalendarRank(meeting: PersonMeeting, calendarContext?: NextCalendarContext): number {
  if (!calendarContext?.seriesKey && !calendarContext?.eventId) return 0;
  if (calendarContext.eventId && meeting.hiltCalendarEventId === calendarContext.eventId) return 0;
  if (calendarContext.seriesKey) {
    if (meeting.calendarIcalUid && calendarContext.seriesKey === `icaluid:${meeting.calendarIcalUid.toLowerCase()}`) return 0;
    if (calendarContext.seriesKey === `title:${normalizeTitle(meeting.title)}`) return 0;
  }
  if (calendarContext.title && normalizeTitle(calendarContext.title) === normalizeTitle(meeting.title)) return 0;
  return 1;
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
  options: { calendarCandidate?: PersonCalendarCandidate | null; keepCalendarOnEmpty?: boolean } = {},
): string {
  const { fm, body } = parseFrontmatter(fileContent);
  const hasCalendarCandidateOption = Object.prototype.hasOwnProperty.call(options, "calendarCandidate");

  if (newNext.trim()) {
    fm[NEXT_SAVED_AT_FIELD] = fm[NEXT_SAVED_AT_FIELD] || new Date().toISOString();
    if (hasCalendarCandidateOption) applyNextCalendarFields(fm, options.calendarCandidate);
  } else {
    delete fm[NEXT_SAVED_AT_FIELD];
    applyNextCalendarFields(fm, options.keepCalendarOnEmpty && hasCalendarCandidateOption ? options.calendarCandidate : null);
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
  let nextCalendarContext = parseNextCalendarContext(content);

  // Match Granola meetings (supports nested date folders)
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);
  const meetingFileMap = new Map(meetingFileEntries.map((e) => [e.filename, e]));

  const granolaMeetings: PersonMeeting[] = [];
  const matchedMeetings = matchMeetingsToSlug(slug, person.name, meetingFilenames, person.aliases);
  for (const mf of matchedMeetings) {
    const mfEntry = meetingFileMap.get(mf);
    if (!mfEntry) continue;
    try {
      const mfContent = fs.readFileSync(mfEntry.fullPath, "utf-8");
      const mfMeta = parseMeetingFrontmatter(mfContent, mf);
      const date = mfMeta.created ? mfMeta.created.slice(0, 10) : "";
      const { body: mfBody } = parseFrontmatter(mfContent);
      const summary = mfBody.trim();

      granolaMeetings.push({
        source: "granola",
        date,
        time: mfMeta.created || undefined,
        title: getMeetingTitle(mfMeta, mfEntry),
        filePath: mfEntry.fullPath,
        transcriptPath: resolveTranscriptPath(vaultPath, mfEntry, mfMeta.transcript),
        summary: mfEntry.transcriptOnly ? undefined : summary,
        granolaId: mfMeta.granolaId || undefined,
        granolaUrl: mfMeta.granolaUrl || undefined,
        calendarEventId: mfMeta.calendarEventId || undefined,
        calendarIcalUid: mfMeta.calendarIcalUid || undefined,
        hiltCalendarEventId: mfMeta.hiltCalendarEventId || undefined,
        hiltCalendarMatchMethod: mfMeta.hiltCalendarMatchMethod || undefined,
        hiltCalendarMatchConfidence: mfMeta.hiltCalendarMatchConfidence ?? undefined,
      });
    } catch {
      // Skip unreadable meeting
    }
  }
  granolaMeetings.sort((a, b) => meetingSortKey(b).localeCompare(meetingSortKey(a)));

  let inlineMeetings = parseInlineMeetings(content);
  const promotionTarget = findPromotionTarget(parsedNext, granolaMeetings, nextSavedAt, nextCalendarContext);

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
      nextCalendarContext = parseNextCalendarContext(content);
      inlineMeetings = parseInlineMeetings(content);
    }
  }

  const meetings = mergeInlineNotesIntoGranola(granolaMeetings, inlineMeetings);
  meetings.sort((a, b) => meetingSortKey(b).localeCompare(meetingSortKey(a)));
  const calendarLinks = resolvePersonCalendarLinks(meetings, nextCalendarContext.seriesKey);

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
    calendarLinks,
  };
}
