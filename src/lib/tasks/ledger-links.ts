import type { LedgerEntry } from "@/lib/loops/meeting-ledger";
import type { TaskFile } from "./types";

export interface LedgerTaskLinkIssue {
  kind: "task-origin-mismatch" | "orphan-task-origin" | "duplicate-task-origin";
  ledger_id: string;
  task_ids: string[];
  expected_task_id?: string;
}

/**
 * Verify the reciprocal identity contract between operational ledger state and file-native
 * task state. Ledger `task_id` points to the task file; task `origin.item_id` points back to
 * the ledger. Titles and body copy are deliberately irrelevant because both remain editable.
 */
export function auditMeetingLedgerTaskLinks(
  entries: LedgerEntry[],
  files: TaskFile[],
): LedgerTaskLinkIssue[] {
  const entriesById = new Map(entries.map((entry) => [entry.id, entry]));
  const filesById = new Map(files.map((task) => [task.id, task]));
  const filesByOrigin = new Map<string, TaskFile[]>();

  for (const task of files) {
    if (task.origin?.loop !== "meeting-actions" || !task.origin.item_id) continue;
    const bucket = filesByOrigin.get(task.origin.item_id);
    if (bucket) bucket.push(task);
    else filesByOrigin.set(task.origin.item_id, [task]);
  }

  const issues: LedgerTaskLinkIssue[] = [];
  for (const entry of entries) {
    if (!entry.task_id) continue;
    const task = filesById.get(entry.task_id);
    // A dismissed proposal intentionally has no task file; its ledger link remains recovery state.
    if (!task && entry.verdict?.verdict === "dismiss" && entry.status === "dropped") continue;
    if (!task) continue; // Missing-file accounting remains the broader task-id audit's job.
    if (task.origin?.loop !== "meeting-actions" || task.origin.item_id !== entry.id) {
      issues.push({
        kind: "task-origin-mismatch",
        ledger_id: entry.id,
        task_ids: [task.id],
        expected_task_id: entry.task_id,
      });
    }
  }

  for (const [ledgerId, tasks] of filesByOrigin) {
    if (!entriesById.has(ledgerId)) {
      issues.push({ kind: "orphan-task-origin", ledger_id: ledgerId, task_ids: tasks.map((task) => task.id) });
    }
    if (tasks.length > 1) {
      issues.push({ kind: "duplicate-task-origin", ledger_id: ledgerId, task_ids: tasks.map((task) => task.id).sort() });
    }
  }

  return issues.sort((left, right) => left.ledger_id.localeCompare(right.ledger_id) || left.kind.localeCompare(right.kind));
}
