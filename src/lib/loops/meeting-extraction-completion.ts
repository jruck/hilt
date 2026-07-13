import { listTasks, proposalsDir, readTaskDir } from "../tasks/store";
import type { TaskFile } from "../tasks/types";
import type { MeetingLedgerStore } from "./meeting-ledger-store";

export interface MeetingExtractionCompletion {
  ok: boolean;
  meeting: string;
  processed_at: string | null;
  entry_ids: string[];
  task_ids: string[];
  issues: string[];
}

/**
 * A child process exiting is not proof that intake completed. This verifier checks the durable
 * boundary the user actually depends on: the meeting has a canonical processed stamp, every
 * first-touch Justin/unclear commitment that remains open is escalated, and every stamped task
 * has exactly one reciprocal file-native proposal/task origin.
 */
export function verifyMeetingExtractionCompletion(
  store: MeetingLedgerStore,
  vaultPath: string,
  meeting: string,
): MeetingExtractionCompletion {
  const processedAt = store.processedMeetings()[meeting] ?? null;
  const entries = store.entriesForMeeting(meeting);
  const files = [
    ...readTaskDir(proposalsDir(vaultPath)),
    ...listTasks(vaultPath),
  ].filter((task) => task.origin?.loop === "meeting-actions");
  const filesById = new Map<string, TaskFile[]>();
  const filesByOrigin = new Map<string, TaskFile[]>();
  for (const task of files) {
    const byId = filesById.get(task.id) ?? [];
    byId.push(task);
    filesById.set(task.id, byId);
    if (task.origin?.item_id) {
      const byOrigin = filesByOrigin.get(task.origin.item_id) ?? [];
      byOrigin.push(task);
      filesByOrigin.set(task.origin.item_id, byOrigin);
    }
  }

  const issues: string[] = [];
  if (!processedAt) issues.push("canonical processed marker is missing");
  for (const entry of entries) {
    const originFiles = filesByOrigin.get(entry.id) ?? [];
    const firstTouchNeedsProposal = entry.opened_from === meeting
      && ["open", "carried"].includes(entry.status)
      && !entry.verdict
      && !entry.owner.startsWith("other:");
    if (firstTouchNeedsProposal && !entry.first_escalated_at) {
      issues.push(`${entry.id} is first-touch open work but was not escalated`);
    }
    if (firstTouchNeedsProposal && !entry.task_id) {
      issues.push(`${entry.id} is first-touch open work but has no task id`);
    }
    if (!entry.task_id && originFiles.length) {
      issues.push(`${entry.id} has ${originFiles.length} proposal/task file(s) but no ledger task stamp`);
    }
    if (originFiles.length > 1) {
      issues.push(`${entry.id} has duplicate proposal/task origins: ${originFiles.map((task) => task.id).join(", ")}`);
    }
    if (!entry.task_id) continue;
    const linked = filesById.get(entry.task_id) ?? [];
    const intentionallyAbsent = entry.status === "dropped" && entry.verdict?.verdict === "dismiss";
    if (!linked.length && !intentionallyAbsent) {
      issues.push(`${entry.id} points to missing task ${entry.task_id}`);
      continue;
    }
    if (linked.length > 1) {
      issues.push(`${entry.id} task id ${entry.task_id} exists in multiple task locations`);
    }
    for (const task of linked) {
      if (task.origin?.loop !== "meeting-actions" || task.origin.item_id !== entry.id) {
        issues.push(`${entry.id} task ${task.id} has a mismatched ledger origin`);
      }
      if (task.origin?.meeting !== entry.opened_from) {
        issues.push(`${entry.id} task ${task.id} has a mismatched meeting origin`);
      }
    }
  }

  return {
    ok: issues.length === 0,
    meeting,
    processed_at: processedAt,
    entry_ids: entries.map((entry) => entry.id),
    task_ids: entries.flatMap((entry) => entry.task_id ? [entry.task_id] : []),
    issues,
  };
}
