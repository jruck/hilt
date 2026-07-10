import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail } from "./types";
import { atomicWriteFile, dateTimestamp, ensureDir, hashId, isoNow } from "./utils";
import { libraryProcessingQueuePath, readProcessingQueueRecord } from "./processing";

export interface LibraryReadState {
  version: 1;
  initialized_at: string;
  read_at_by_id: Record<string, string>;
  /** When the user last OPENED the Library tab. Drives the nav "new since you looked" dot —
   *  distinct from per-item read state (read_at_by_id), which the feed cards use. */
  last_visited_at?: string;
}

export interface MarkLibraryReadResult {
  marked: number;
  ids: string[];
  read_at: string;
}

type ReadAwareArtifact = Pick<LibraryArtifact, "id" | "created_at" | "updated_at" | "lifecycle_status" | "source_type"> & {
  raw_frontmatter?: Record<string, unknown>;
};

const savedArrivalKeys = ["captured_at", "saved_at"] as const;
const savedFallbackKeys = ["captured", "saved", "created", "published"] as const;
const candidateArrivalKeys = ["digested_at", "captured_at", "saved_at", "fetched_at"] as const;

function frontmatterTimestamp(frontmatter: Record<string, unknown> | undefined, keys: readonly string[]): number {
  if (!frontmatter) return 0;
  for (const key of keys) {
    const value = frontmatter[key];
    const timestamp = value instanceof Date
      ? value.getTime()
      : dateTimestamp(typeof value === "string" ? value : null);
    if (timestamp) return timestamp;
  }
  return 0;
}

function artifactArrivalTimestamp(artifact: ReadAwareArtifact): number {
  const isCandidate = artifact.lifecycle_status === "candidate" || artifact.source_type === "reference-candidate";
  if (isCandidate) {
    return frontmatterTimestamp(artifact.raw_frontmatter, candidateArrivalKeys)
      || dateTimestamp(artifact.created_at);
  }

  return frontmatterTimestamp(artifact.raw_frontmatter, savedArrivalKeys)
    || frontmatterTimestamp(artifact.raw_frontmatter, savedFallbackKeys)
    || dateTimestamp(artifact.created_at);
}

function libraryReadStateDir(): string {
  return path.join(process.env.DATA_DIR || path.join(process.cwd(), "data"), "library-read-state");
}

function libraryReadStatePath(vaultPath: string): string {
  const vaultKey = hashId(path.resolve(vaultPath), 16);
  return path.join(libraryReadStateDir(), `${vaultKey}.json`);
}

function normalizeReadState(value: unknown): LibraryReadState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<LibraryReadState>;
  const initializedAt = typeof record.initialized_at === "string" ? record.initialized_at : null;
  const readAtById = record.read_at_by_id && typeof record.read_at_by_id === "object"
    ? Object.fromEntries(Object.entries(record.read_at_by_id).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  if (!initializedAt) return null;
  return {
    version: 1,
    initialized_at: initializedAt,
    read_at_by_id: readAtById,
    last_visited_at: typeof record.last_visited_at === "string" ? record.last_visited_at : undefined,
  };
}

function writeLibraryReadState(vaultPath: string, state: LibraryReadState): void {
  const target = libraryReadStatePath(vaultPath);
  ensureDir(path.dirname(target));
  atomicWriteFile(target, `${JSON.stringify(state, null, 2)}\n`);
}

export function readLibraryReadState(vaultPath: string, options: { initialize?: boolean } = {}): LibraryReadState {
  const target = libraryReadStatePath(vaultPath);
  if (fs.existsSync(target)) {
    try {
      const parsed = normalizeReadState(JSON.parse(fs.readFileSync(target, "utf-8")));
      if (parsed) return parsed;
    } catch {
      // Fall through to a fresh baseline if the local UI state is corrupt.
    }
  }

  const state: LibraryReadState = {
    version: 1,
    initialized_at: isoNow(),
    read_at_by_id: {},
  };
  if (options.initialize !== false) writeLibraryReadState(vaultPath, state);
  return state;
}

export function isLibraryArtifactUnread(artifact: ReadAwareArtifact, state: LibraryReadState): boolean {
  const artifactTime = artifactArrivalTimestamp(artifact);
  const lastReadTime = dateTimestamp(state.read_at_by_id[artifact.id]) || dateTimestamp(state.initialized_at);
  return artifactTime > lastReadTime;
}

/** "New since you last opened the Library tab" — the nav-dot semantic. Independent of per-item read
 *  state: it's purely arrival-time vs. last_visited_at (falling back to the baseline before a first
 *  visit), so the dot means "stuff landed since you looked," not "unread items exist." */
export function isLibraryArtifactNew(artifact: ReadAwareArtifact, state: LibraryReadState): boolean {
  const since = dateTimestamp(state.last_visited_at || "") || dateTimestamp(state.initialized_at);
  return artifactArrivalTimestamp(artifact) > since;
}

/** Stamp the Library tab as visited now — clears the nav "new" dot. */
export function markLibraryVisited(vaultPath: string, visitedAt = isoNow()): { visited_at: string } {
  const state = readLibraryReadState(vaultPath);
  state.last_visited_at = visitedAt;
  writeLibraryReadState(vaultPath, state);
  return { visited_at: visitedAt };
}

export function applyLibraryReadState<T extends LibraryArtifact | LibraryArtifactDetail>(artifacts: T[], state: LibraryReadState): T[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    read_at: state.read_at_by_id[artifact.id] || null,
    is_unread: isLibraryArtifactUnread(artifact, state),
  }) as T);
}

export function markLibraryArtifactsRead(vaultPath: string, ids: string[], readAt = isoNow()): MarkLibraryReadResult {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)))
    .filter((id) => !readProcessingQueueRecord(libraryProcessingQueuePath(vaultPath, id)));
  if (!uniqueIds.length) return { marked: 0, ids: [], read_at: readAt };

  const state = readLibraryReadState(vaultPath);
  for (const id of uniqueIds) {
    state.read_at_by_id[id] = readAt;
  }
  writeLibraryReadState(vaultPath, state);
  return { marked: uniqueIds.length, ids: uniqueIds, read_at: readAt };
}

// A non-zero, far-past read timestamp: older than any real artifact's mtime so the item reads as
// unread, while staying truthy (dateTimestamp("1970-...000Z") === 0 would fall through to the
// baseline and could read as already-read for items older than the baseline).
const UNREAD_SENTINEL = "1970-01-01T00:00:01.000Z";

export function markLibraryArtifactsUnread(vaultPath: string, ids: string[]): MarkLibraryReadResult {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) return { marked: 0, ids: [], read_at: UNREAD_SENTINEL };

  const state = readLibraryReadState(vaultPath);
  for (const id of uniqueIds) {
    state.read_at_by_id[id] = UNREAD_SENTINEL;
  }
  writeLibraryReadState(vaultPath, state);
  return { marked: uniqueIds.length, ids: uniqueIds, read_at: UNREAD_SENTINEL };
}
