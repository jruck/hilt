import fs from "fs";
import path from "path";
import { atomicWriteFile, ensureDir, isoNow } from "./utils";

const DEAD_LETTER_FILE = path.join("references", ".cache", "library-dead-letter.json");

export interface DeadLetterEntry {
  at: string;
  source_id: string;
  artifact_url?: string;
  error: string;
}

function filePath(vaultPath: string): string {
  return path.join(vaultPath, DEAD_LETTER_FILE);
}

export function readDeadLetters(vaultPath: string): DeadLetterEntry[] {
  const target = filePath(vaultPath);
  if (!fs.existsSync(target)) return [];
  try {
    return JSON.parse(fs.readFileSync(target, "utf-8")) as DeadLetterEntry[];
  } catch {
    return [];
  }
}

export function appendDeadLetter(vaultPath: string, entry: Omit<DeadLetterEntry, "at">): void {
  const target = filePath(vaultPath);
  ensureDir(path.dirname(target));
  const entries = readDeadLetters(vaultPath);
  entries.push({ ...entry, at: isoNow() });
  atomicWriteFile(target, JSON.stringify(entries.slice(-500), null, 2));
}

