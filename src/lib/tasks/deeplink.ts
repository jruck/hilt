/**
 * Cross-view task-open channel (the calendar-deeplink idiom, tasks edition).
 *
 * Any surface that knows a task id — briefing canvas cards, meeting Next-steps cards,
 * task object pills — calls `requestTaskOpen(id)`. Board listens for the event, switches
 * Bridge to Priorities, and forwards the id as a BridgeTaskOpenRequest; BridgeView opens
 * the task pane (the weekly row's panel when the task is on this week's list, the
 * file-addressable pane otherwise).
 *
 * Accepts BOTH id shapes: weekly-positional ids ("task-3", the HUD's shape) and task-file
 * ids ("t-20260705-003") — BridgeView resolves either.
 */
export const TASK_OPEN_EVENT = "hilt:open-task";

export interface TaskOpenDetail {
  taskId: string;
}

export function requestTaskOpen(taskId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TaskOpenDetail>(TASK_OPEN_EVENT, { detail: { taskId } }));
}
