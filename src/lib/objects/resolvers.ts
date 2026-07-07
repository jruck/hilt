/**
 * Per-kind object resolvers (v3 unit B5) — turn an ObjectRef into the card view-model + nav
 * target the ObjectPill popover renders. Pure reads, NO side effects: notably the library
 * resolver goes through getLibraryArtifact directly, never the /api/library/[id] route, because
 * that route appends an "opened" read-state event and a popover preview must not count as a read.
 *
 * Contract: unresolvable ref → null (the API answers 404; the pill keeps its label and shows a
 * graceful "couldn't load" card). A meeting note WITHOUT a granola_id still resolves to a card,
 * but with nav: null — there is no native People-inbox element to click through to.
 */
import * as fs from "fs";
import * as path from "path";
import matter from "gray-matter";
import { parsePeopleIndex, parsePersonFile } from "@/lib/bridge/people-parser";
import { parseProjectIndex } from "@/lib/bridge/project-parser";
import { HILT_DISPLAY_TIME_ZONE } from "@/lib/display-date";
import { getLibraryArtifact } from "@/lib/library/library";
import { readProposal } from "@/lib/tasks/proposals";
import { isValidTaskId, readTask } from "@/lib/tasks/store";
import type { MeetingCardData, ObjectRef, ResolvedObject } from "./types";

export function resolveObjectRef(vaultPath: string, ref: ObjectRef): ResolvedObject | null {
  switch (ref.kind) {
    case "meeting":
      return resolveMeeting(vaultPath, ref.id);
    case "task":
      return resolveTask(vaultPath, ref.id);
    case "person":
      return resolvePerson(vaultPath, ref.id);
    case "project":
      return resolveProject(vaultPath, ref.id);
    case "library":
      return resolveLibrary(vaultPath, ref.id);
  }
}

// --- meeting: id = vault-relative path to the note markdown --------------------------------

function resolveMeeting(vaultPath: string, id: string): ResolvedObject | null {
  if (!id.endsWith(".md")) return null;
  const filePath = resolveVaultRelPath(vaultPath, id);
  if (!filePath || !fs.existsSync(filePath)) return null;

  let fm: Record<string, unknown>;
  try {
    fm = matter(fs.readFileSync(filePath, "utf-8")).data as Record<string, unknown>;
  } catch {
    return null; // unreadable/malformed frontmatter degrades to unresolvable, not a 500
  }

  const startIso = stringValue(fm.calendar_start) ?? isoValue(fm.calendar_start);
  const endIso = stringValue(fm.calendar_end) ?? isoValue(fm.calendar_end);
  const createdIso = stringValue(fm.created) ?? isoValue(fm.created);
  const granolaId = stringValue(fm.granola_id);

  const card: MeetingCardData = {
    kind: "meeting",
    title: stringValue(fm.title) ?? path.basename(id, ".md"),
    date: toDisplayDate(startIso ?? createdIso),
    timeRange: formatMeetingTimeRange(startIso, endIso),
    attendees: Array.isArray(fm.attendees)
      ? fm.attendees.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0)
      : [],
    granolaUrl: stringValue(fm.granola_url),
    hasTranscript: Boolean(stringValue(fm.transcript)) || stringValue(fm.type) === "transcript",
  };

  return {
    kind: "meeting",
    card,
    // Exact scope precedent: CalendarEventPopover navigates to the People meeting inbox.
    nav: granolaId
      ? { view: "people", scope: `/__inbox__/meeting/${encodeURIComponent(granolaId)}` }
      : null,
  };
}

// --- task: id = task id; same two-store probe as GET /api/tasks/[id] (no side effects) -----

function resolveTask(vaultPath: string, id: string): ResolvedObject | null {
  // Reject before any path.join — a permissive id is a path-traversal vector (A2 review).
  if (!isValidTaskId(id)) return null;

  const task = readTask(vaultPath, id);
  if (task) {
    return { kind: "task", card: { kind: "task", task, store: "tasks" }, nav: { view: "bridge", scope: "" } };
  }
  const proposal = readProposal(vaultPath, id);
  if (proposal) {
    return { kind: "task", card: { kind: "task", task: proposal, store: "proposals" }, nav: { view: "bridge", scope: "" } };
  }
  return null;
}

// --- person: id = slug → people/<slug>.md ---------------------------------------------------

function resolvePerson(vaultPath: string, id: string): ResolvedObject | null {
  const slug = id.trim();
  // Slugs are single path segments; anything else is a traversal attempt or a typo.
  if (!slug || slug.includes("/") || slug.includes("\\") || slug.startsWith(".")) return null;
  const filePath = path.join(vaultPath, "people", `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  let indexDescription = "";
  const indexPath = path.join(vaultPath, "people", "index.md");
  if (fs.existsSync(indexPath)) {
    try {
      indexDescription = parsePeopleIndex(fs.readFileSync(indexPath, "utf-8"))[slug] || "";
    } catch {
      // index is a nicety — the person file alone still resolves
    }
  }

  const person = parsePersonFile(fs.readFileSync(filePath, "utf-8"), slug, indexDescription);
  return {
    kind: "person",
    card: {
      kind: "person",
      name: person.name,
      description: person.description || null,
      lastMeetingDate: person.lastMeetingDate,
    },
    nav: { view: "people", scope: `/${slug}` },
  };
}

// --- project: id = vault-relative project dir → <id>/index.md ------------------------------

function resolveProject(vaultPath: string, id: string): ResolvedObject | null {
  const dirPath = resolveVaultRelPath(vaultPath, id);
  if (!dirPath) return null;
  const indexPath = id.endsWith("/index.md") ? dirPath : path.join(dirPath, "index.md");
  if (!fs.existsSync(indexPath)) return null;

  let content: string;
  try {
    content = fs.readFileSync(indexPath, "utf-8");
  } catch {
    return null;
  }
  const parsed = parseProjectIndex(content);
  return {
    kind: "project",
    card: {
      kind: "project",
      title: parsed.title ?? path.basename(path.dirname(indexPath)),
      status: parsed.status,
      description: parsed.description || null,
    },
    nav: { view: "bridge", scope: "" },
  };
}

// --- library: id = artifact hash id ---------------------------------------------------------

function resolveLibrary(vaultPath: string, id: string): ResolvedObject | null {
  // NEVER via /api/library/[id] — that route appends an "opened" read-state event and a
  // popover preview must not count as a read. Direct lib read is side-effect free.
  const artifact = getLibraryArtifact(vaultPath, id);
  if (!artifact) return null;
  return {
    kind: "library",
    card: {
      kind: "library",
      title: artifact.title,
      summary: artifact.summary,
      sourceName: artifact.source_name,
      url: artifact.url,
    },
    // Same scope shape the briefing's editors-memo link uses (briefing-link-targets).
    nav: { view: "library", scope: `/item/${artifact.id}` },
  };
}

// --- shared helpers --------------------------------------------------------------------------

/** Resolve a vault-relative id to an absolute path, rejecting traversal outside the vault
 * (same containment check as library's resolveArtifactPath). */
function resolveVaultRelPath(vaultPath: string, relId: string): string | null {
  const relPath = relId.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!relPath || relPath.split("/").some((part) => part === "..")) return null;
  const vaultRoot = path.resolve(vaultPath);
  const resolved = path.resolve(vaultRoot, relPath);
  if (resolved !== vaultRoot && !resolved.startsWith(`${vaultRoot}${path.sep}`)) return null;
  return resolved;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** gray-matter's YAML parser turns unquoted ISO timestamps into Date objects — accept both. */
function isoValue(value: unknown): string | null {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

function parseDate(iso: string | null): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** ISO timestamp → YYYY-MM-DD in Hilt's display timezone (en-CA formats as YYYY-MM-DD). */
function toDisplayDate(iso: string | null): string | null {
  const date = parseDate(iso);
  if (!date) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: HILT_DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatClockTime(date: Date): { time: string; period: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: HILT_DISPLAY_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { time: `${pick("hour")}:${pick("minute")}`, period: pick("dayPeriod") };
}

/** "2:00–2:30 PM" (shared meridiem elided) / "11:30 AM – 1:00 PM" / "2:00 PM" (no end). */
export function formatMeetingTimeRange(startIso: string | null, endIso: string | null): string | null {
  const start = parseDate(startIso);
  if (!start) return null;
  const startParts = formatClockTime(start);
  const end = parseDate(endIso);
  if (!end) return `${startParts.time} ${startParts.period}`.trim();
  const endParts = formatClockTime(end);
  if (startParts.period === endParts.period) {
    return `${startParts.time}–${endParts.time} ${endParts.period}`.trim();
  }
  return `${startParts.time} ${startParts.period} – ${endParts.time} ${endParts.period}`;
}
