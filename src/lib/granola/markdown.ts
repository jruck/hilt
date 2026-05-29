import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import YAML from "yaml";
import { atomicWriteFile, ensureDir } from "../library/utils";
import { buildGranolaNoteBody, formatTranscriptMarkdown } from "./content";
import type { GranolaCalendarMatch, GranolaDocument } from "./types";

export interface ExistingMeetingFiles {
  notesByGranolaId: Map<string, string>;
  transcriptsByGranolaId: Map<string, string>;
}

export interface MeetingPaths {
  notePath: string;
  transcriptPath: string;
  noteRelativePath: string;
  transcriptRelativePath: string;
}

export function discoverExistingMeetingFiles(vaultPath: string): ExistingMeetingFiles {
  const meetingsDir = path.join(vaultPath, "meetings");
  const notesByGranolaId = new Map<string, string>();
  const transcriptsByGranolaId = new Map<string, string>();
  visitMarkdown(meetingsDir, (filePath) => {
    try {
      const parsed = matter(fs.readFileSync(filePath, "utf-8"));
      const granolaId = stringValue(parsed.data.granola_id);
      if (!granolaId) return;
      const type = stringValue(parsed.data.type);
      if (type === "transcript" || filePath.includes(`${path.sep}transcripts${path.sep}`)) {
        transcriptsByGranolaId.set(granolaId, filePath);
      } else {
        notesByGranolaId.set(granolaId, filePath);
      }
    } catch {
      // Ignore unreadable or malformed markdown.
    }
  });
  return { notesByGranolaId, transcriptsByGranolaId };
}

export function computeMeetingPaths(vaultPath: string, doc: GranolaDocument): MeetingPaths {
  const date = localDateParts(doc.createdAt || doc.updatedAt || new Date().toISOString());
  const title = sanitizeFilename(doc.title);
  const stem = `${title}-${date.date} @ ${date.time}`;
  const noteRelativePath = path.join("meetings", date.date, `${stem}.md`);
  const transcriptRelativePath = path.join("meetings", "transcripts", date.date, `${stem} (transcript).md`);
  return {
    notePath: path.join(vaultPath, noteRelativePath),
    transcriptPath: path.join(vaultPath, transcriptRelativePath),
    noteRelativePath,
    transcriptRelativePath,
  };
}

export function buildNoteMarkdown(doc: GranolaDocument, paths: MeetingPaths, match: GranolaCalendarMatch): string | null {
  const body = buildGranolaNoteBody(doc);
  if (!body) return null;
  return stringifyMarkdown(buildNoteFrontmatter(doc, paths.transcriptRelativePath, match), body);
}

export function buildTranscriptMarkdown(doc: GranolaDocument, paths: MeetingPaths, match: GranolaCalendarMatch): string | null {
  if (!doc.transcript.length) return null;
  const body = formatTranscriptMarkdown(doc.transcript, doc.title);
  return stringifyMarkdown(buildTranscriptFrontmatter(doc, paths.noteRelativePath, match), body);
}

export function augmentExistingMarkdown(content: string, fields: Record<string, unknown>): { content: string; changed: boolean } {
  const parsed = matter(content);
  const nextData = { ...parsed.data };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === "") continue;
    nextData[key] = value;
  }
  const next = stringifyMarkdown(nextData, parsed.content.trimStart());
  return { content: next, changed: next !== content };
}

export function writeMarkdownIfChanged(filePath: string, content: string, dryRun: boolean): boolean {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, "utf-8");
    if (existing === content) return false;
  }
  if (!dryRun) atomicWriteFile(filePath, content);
  return true;
}

export function writeAugmentedMarkdown(filePath: string, fields: Record<string, unknown>, dryRun: boolean): boolean {
  if (!fs.existsSync(filePath)) return false;
  const existing = fs.readFileSync(filePath, "utf-8");
  const result = augmentExistingMarkdown(existing, fields);
  if (!result.changed) return false;
  if (!dryRun) atomicWriteFile(filePath, result.content);
  return true;
}

export function copyCandidateMarkdown(outputRoot: string, relativePath: string, content: string): string {
  const target = path.join(outputRoot, relativePath);
  ensureDir(path.dirname(target));
  fs.writeFileSync(target, content, "utf-8");
  return target;
}

export function buildNoteFrontmatter(doc: GranolaDocument, transcriptRelativePath: string | null, match: GranolaCalendarMatch): Record<string, unknown> {
  const calendar = doc.calendarEvent;
  return {
    granola_id: doc.id,
    granola_url: doc.granolaUrl,
    title: doc.title,
    type: "note",
    created: doc.createdAt,
    updated: doc.updatedAt,
    attendees: doc.attendees.map((person) => person.name || person.email).filter(Boolean),
    transcript: transcriptRelativePath ? `[[${transcriptRelativePath}]]` : undefined,
    folders: doc.folders.length ? doc.folders : undefined,
    calendar_event_id: calendar?.id ?? undefined,
    calendar_ical_uid: calendar?.iCalUID ?? undefined,
    calendar_start: calendar?.start ?? undefined,
    calendar_end: calendar?.end ?? undefined,
    calendar_html_link: calendar?.htmlLink ?? undefined,
    hilt_calendar_event_id: match.hiltCalendarEventId ?? undefined,
    hilt_calendar_match_method: match.method !== "none" ? match.method : undefined,
    hilt_calendar_match_confidence: match.method !== "none" ? match.confidence : undefined,
    hilt_synced_at: new Date().toISOString(),
  };
}

export function buildTranscriptFrontmatter(doc: GranolaDocument, noteRelativePath: string | null, match: GranolaCalendarMatch): Record<string, unknown> {
  const calendar = doc.calendarEvent;
  return {
    granola_id: doc.id,
    granola_url: doc.granolaUrl,
    title: `${doc.title} - Transcript`,
    type: "transcript",
    created: doc.createdAt,
    updated: doc.updatedAt,
    attendees: doc.attendees.map((person) => person.name || person.email).filter(Boolean),
    note: noteRelativePath ? `[[${noteRelativePath}]]` : undefined,
    folders: doc.folders.length ? doc.folders : undefined,
    calendar_event_id: calendar?.id ?? undefined,
    calendar_ical_uid: calendar?.iCalUID ?? undefined,
    calendar_start: calendar?.start ?? undefined,
    calendar_end: calendar?.end ?? undefined,
    calendar_html_link: calendar?.htmlLink ?? undefined,
    hilt_calendar_event_id: match.hiltCalendarEventId ?? undefined,
    hilt_calendar_match_method: match.method !== "none" ? match.method : undefined,
    hilt_calendar_match_confidence: match.method !== "none" ? match.confidence : undefined,
    hilt_synced_at: new Date().toISOString(),
  };
}

export function calendarAugmentationFields(doc: GranolaDocument, match: GranolaCalendarMatch): Record<string, unknown> {
  const calendar = doc.calendarEvent;
  return {
    granola_url: doc.granolaUrl,
    calendar_event_id: calendar?.id ?? undefined,
    calendar_ical_uid: calendar?.iCalUID ?? undefined,
    calendar_start: calendar?.start ?? undefined,
    calendar_end: calendar?.end ?? undefined,
    calendar_html_link: calendar?.htmlLink ?? undefined,
    hilt_calendar_event_id: match.hiltCalendarEventId ?? undefined,
    hilt_calendar_match_method: match.method !== "none" ? match.method : undefined,
    hilt_calendar_match_confidence: match.method !== "none" ? match.confidence : undefined,
    hilt_synced_at: new Date().toISOString(),
  };
}

function stringifyMarkdown(data: Record<string, unknown>, body: string): string {
  const cleaned = Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined && value !== null && value !== ""));
  const yaml = YAML.stringify(cleaned, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trimStart()}`;
}

function visitMarkdown(root: string, visit: (filePath: string) => void): void {
  if (!fs.existsSync(root)) return;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) visitMarkdown(full, visit);
    else if (entry.isFile() && entry.name.endsWith(".md")) visit(full);
  }
}

function localDateParts(input: string): { date: string; time: string } {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return { date: "unknown-date", time: "00-00-00" };
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
  };
}

function sanitizeFilename(input: string): string {
  return input
    .replace(/[/:*?"<>|\\]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "Untitled";
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
