import type { LedgerEntry } from "../loops/meeting-ledger";
import { joinTaskBody, splitTaskBody } from "./task-body";
import type { TaskFile } from "./types";

/** Reconstruct the exact notes prefix written by the legacy meeting-proposal minter. */
export function legacyGeneratedMeetingTaskNotes(entry: LedgerEntry): string {
  const context = entry.context?.replace(/\s+/g, " ").trim() || null;
  const rawDue = (entry.due ?? "").trim();
  const statedDue = rawDue && !/^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? rawDue : null;
  return [
    ...(context ? [context] : []),
    ...(statedDue ? [`Due (as stated): ${statedDue}`] : []),
  ].join("\n\n");
}

export interface StripLegacyLedgerTaskNotesResult {
  task: TaskFile;
  changed: boolean;
  removed: string | null;
}

/**
 * Remove only an exact legacy-generated prefix. Unique user notes and the task-file History
 * section survive byte-for-content; nonmatching bodies are left completely untouched.
 */
export function stripLegacyGeneratedMeetingTaskNotes(
  task: TaskFile,
  entry: LedgerEntry,
): StripLegacyLedgerTaskNotesResult {
  const generated = legacyGeneratedMeetingTaskNotes(entry);
  if (!generated) return { task, changed: false, removed: null };

  const split = splitTaskBody(task.body);
  const content = split.content.replace(/\s+$/, "");
  let remaining: string | null = null;
  if (content === generated) remaining = "";
  else if (content.startsWith(`${generated}\n\n`)) remaining = content.slice(generated.length + 2);
  if (remaining === null) return { task, changed: false, removed: null };

  return {
    task: { ...task, body: joinTaskBody(remaining, split.history) },
    changed: true,
    removed: generated,
  };
}
