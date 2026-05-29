import fs from "fs";
import path from "path";
import type { LibraryArtifact, LibraryArtifactDetail } from "./types";
import { atomicWriteFile, dateTimestamp, ensureDir, hashId, isoNow } from "./utils";

export interface LibraryReadState {
  version: 1;
  initialized_at: string;
  read_at_by_id: Record<string, string>;
}

export interface MarkLibraryReadResult {
  marked: number;
  ids: string[];
  read_at: string;
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

export function isLibraryArtifactUnread(artifact: Pick<LibraryArtifact, "id" | "created_at" | "updated_at">, state: LibraryReadState): boolean {
  const artifactTime = dateTimestamp(artifact.updated_at) || dateTimestamp(artifact.created_at);
  const lastReadTime = dateTimestamp(state.read_at_by_id[artifact.id]) || dateTimestamp(state.initialized_at);
  return artifactTime > lastReadTime;
}

export function applyLibraryReadState<T extends LibraryArtifact | LibraryArtifactDetail>(artifacts: T[], state: LibraryReadState): T[] {
  return artifacts.map((artifact) => ({
    ...artifact,
    read_at: state.read_at_by_id[artifact.id] || null,
    is_unread: isLibraryArtifactUnread(artifact, state),
  }) as T);
}

export function markLibraryArtifactsRead(vaultPath: string, ids: string[], readAt = isoNow()): MarkLibraryReadResult {
  const uniqueIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
  if (!uniqueIds.length) return { marked: 0, ids: [], read_at: readAt };

  const state = readLibraryReadState(vaultPath);
  for (const id of uniqueIds) {
    state.read_at_by_id[id] = readAt;
  }
  writeLibraryReadState(vaultPath, state);
  return { marked: uniqueIds.length, ids: uniqueIds, read_at: readAt };
}
