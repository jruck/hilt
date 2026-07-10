import fs from "node:fs";
import path from "node:path";
import { atomicWriteFile, ensureDir, hashId } from "./utils";

export interface LibraryIntakeDaemonState {
  version: 1;
  enabled: boolean;
  running: boolean;
  foreground: boolean;
  last_polled_at: string | null;
  next_poll_at: string | null;
  updated_at: string;
}

function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

export function libraryIntakeDaemonStatePath(vaultPath: string): string {
  return path.join(dataDir(), "library-intake-daemon", `${hashId(path.resolve(vaultPath), 16)}.json`);
}

export function readLibraryIntakeDaemonState(vaultPath: string): LibraryIntakeDaemonState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(libraryIntakeDaemonStatePath(vaultPath), "utf-8")) as LibraryIntakeDaemonState;
    return parsed?.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

export function writeLibraryIntakeDaemonState(vaultPath: string, state: LibraryIntakeDaemonState): void {
  const filePath = libraryIntakeDaemonStatePath(vaultPath);
  ensureDir(path.dirname(filePath));
  atomicWriteFile(filePath, `${JSON.stringify(state, null, 2)}\n`);
}
