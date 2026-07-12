import fs from "fs";
import path from "path";
import { hashId, isoNow } from "./utils";

/**
 * Library engagement event log (Library v2, Workstream 2): an append-only JSONL of every behavioral
 * signal — what was served (For You impressions with serve-time score snapshots), opened, read,
 * promoted, skipped, rescued, archived, or commented on. This is the evidence base the steering loop
 * analyzes; nothing reads it on the hot path. Operational state in DATA_DIR (like read-state), never
 * the vault. Logging must never break a request: every writer swallows errors.
 */

export type LibraryEventType =
  | "served"
  | "opened"
  | "read"
  | "promoted"
  | "skipped"
  | "rescued"
  | "archived_confirmed"
  | "feedback_left"
  | "recommended"
  | "recommendation_dismissed"
  | "recommendation_restored";

export type LibraryEventSurface = "for_you" | "feed" | "search" | "briefing" | "detail" | "api";

export interface LibraryEvent {
  at: string;
  type: LibraryEventType;
  artifact_id: string;
  surface?: LibraryEventSurface;
  /** Rank within the surface at serve time (for_you position, search position). */
  rank?: number;
  /** Serve-time scoring snapshot, so later analysis can ask "what did we believe when we showed this?" */
  scores?: { worth?: number; relevance?: number; substance?: number; freshness?: number };
  meta?: Record<string, unknown>;
}

function eventsDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-events");
}

export function libraryEventsPath(vaultPath: string): string {
  return path.join(eventsDir(), `${hashId(path.resolve(vaultPath), 16)}.jsonl`);
}

/** Append events; never throws (logging must not break the request it rides on). */
export function appendLibraryEvents(vaultPath: string, events: Array<Omit<LibraryEvent, "at"> & { at?: string }>): void {
  if (!events.length) return;
  try {
    fs.mkdirSync(eventsDir(), { recursive: true });
    const lines = events
      // Spread FIRST so an explicit `at: undefined` can never clobber the stamp.
      .map((event) => JSON.stringify({ ...event, at: event.at || isoNow() }))
      .join("\n");
    fs.appendFileSync(libraryEventsPath(vaultPath), `${lines}\n`, "utf-8");
  } catch {
    // Swallow: an unlogged event is better than a failed request.
  }
}

// Parsed-events cache keyed by file mtime+size: buildForYouPool reads the log on the recommendations
// hot path, and re-parsing every line per request grows linearly with the log. Callers must treat the
// returned events as immutable.
const readCache = new Map<string, { mtimeMs: number; size: number; events: LibraryEvent[] }>();

/** Read all events (optionally since an ISO timestamp). Tolerates corrupt/partial lines. */
export function readLibraryEvents(vaultPath: string, options: { since?: string } = {}): LibraryEvent[] {
  const filePath = libraryEventsPath(vaultPath);
  let raw: string;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
    const cached = readCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      return filterSince(cached.events, options.since);
    }
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    return [];
  }
  const events: LibraryEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line) as LibraryEvent;
      if (!parsed || typeof parsed !== "object" || typeof parsed.artifact_id !== "string" || typeof parsed.type !== "string") continue;
      events.push(parsed);
    } catch {
      // Skip corrupt lines — append-only logs can have torn writes.
    }
  }
  readCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, events });
  return filterSince(events, options.since);
}

function filterSince(events: LibraryEvent[], since?: string): LibraryEvent[] {
  const sinceTime = since ? Date.parse(since) : null;
  if (sinceTime === null || !Number.isFinite(sinceTime)) return [...events];
  return events.filter((event) => Date.parse(event.at) >= sinceTime);
}
