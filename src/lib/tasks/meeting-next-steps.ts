/**
 * The "Next steps" join for one meeting (v3 unit B2) — pure data logic, no IO, no React.
 *
 * Three lanes, one meeting:
 *   1. proposals   — task files in `tasks/.proposals/` whose `origin.meeting` IS this meeting
 *   2. unmintedAsks — escalated ledger asks citing this meeting with NO minted task file
 *                     (pre-Phase-A history; dedupe by loop+item_id against BOTH stores)
 *   3. tasks       — accepted/in-progress/done task files born from this meeting
 *
 * The join key is the vault-relative meeting path (`meetings/<date>/<file>.md`) — exactly what
 * the loop stamps into `origin.meeting` (ledger `opened_from`) and into each citation's `source`.
 */
import type { LoopItem, Verdict } from "../loops/types";
import type { TaskFile, TaskStatus } from "./types";

/** An escalated loop item as `/api/loops/escalations` returns it (structural — matches
 * EscalatedLoopItem without importing the briefing component). */
export type MeetingAsk = LoopItem & { verdict?: Verdict };

/** Task statuses that belong in the read-only "landed work" lane. `proposed` renders from the
 * proposals lane; `dropped` is a deliberate dismissal — resurrecting it here would undo the
 * dismissed-immunity work (A7). */
const LANDED_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "accepted-me",
  "accepted-agent",
  "in-progress",
  "done",
]);

/**
 * Derive the vault-relative meeting path from the meeting's absolute file path.
 * Prefer stripping the known vault prefix (exact); fall back to the last `meetings/` segment
 * (filenames cannot contain `/`, so the last occurrence is always the meetings dir itself).
 */
export function meetingVaultRelPath(
  filePath: string | null | undefined,
  vaultPath?: string | null,
): string | null {
  if (!filePath) return null;
  if (vaultPath) {
    const prefix = vaultPath.endsWith("/") ? vaultPath : `${vaultPath}/`;
    if (filePath.startsWith(prefix)) return filePath.slice(prefix.length);
  }
  const idx = filePath.lastIndexOf("meetings/");
  return idx >= 0 ? filePath.slice(idx) : null;
}

/** Does this escalated item cite this meeting? Citation sources are vault-relative meeting
 * paths (sometimes with trailing locator text), so containment covers both forms. */
export function askMatchesMeeting(item: Pick<LoopItem, "citations">, meetingRelPath: string): boolean {
  return (item.citations ?? []).some(
    (citation) => typeof citation.source === "string" && citation.source.includes(meetingRelPath),
  );
}

export interface MeetingNextSteps {
  /** Decidable proposal task files from this meeting (verdict controls). */
  proposals: TaskFile[];
  /** Escalated ledger asks citing this meeting that never minted a task file. */
  unmintedAsks: MeetingAsk[];
  /** Accepted / in-progress / done task files born from this meeting (read-only). */
  tasks: TaskFile[];
  total: number;
}

export function joinMeetingNextSteps(input: {
  meetingRelPath: string | null;
  tasks: TaskFile[];
  proposals: TaskFile[];
  escalations: MeetingAsk[];
}): MeetingNextSteps {
  const rel = input.meetingRelPath;
  if (!rel) return { proposals: [], unmintedAsks: [], tasks: [], total: 0 };

  const proposals = input.proposals.filter((task) => task.origin?.meeting === rel);
  const tasks = input.tasks.filter(
    (task) => task.origin?.meeting === rel && LANDED_STATUSES.has(task.status),
  );

  // Dedupe key: loop + item_id (item ids are loop-scoped). Minted anywhere — proposal still
  // pending OR already approved into tasks/ — means the ledger ask must not render twice.
  const minted = new Set<string>();
  for (const task of [...input.proposals, ...input.tasks]) {
    if (task.origin?.item_id) minted.add(`${task.origin.loop ?? ""}:${task.origin.item_id}`);
  }

  const unmintedAsks = input.escalations.filter(
    (item) =>
      (item.kind === "action" || item.kind === "proposal") &&
      askMatchesMeeting(item, rel) &&
      !minted.has(`${item.loop}:${item.id}`),
  );

  return { proposals, unmintedAsks, tasks, total: proposals.length + unmintedAsks.length + tasks.length };
}

/**
 * Dismissed ledger records opened FROM this meeting (the gate-B "Dismissed · N" tail).
 * `opened_from` is the same vault-relative meeting path the loop stamps into `origin.meeting`,
 * so this is exact equality on the join key — same discipline as the proposals/tasks lanes.
 * Structural type keeps this file IO-free (no import from the API route or the hook).
 */
export function filterMeetingDismissed<T extends { opened_from: string }>(
  items: T[],
  meetingRelPath: string | null,
): T[] {
  if (!meetingRelPath) return [];
  return items.filter((item) => item.opened_from === meetingRelPath);
}

/** Shape a ledger ask as a TaskFile so the shared TaskCard renders it uniformly. */
export function askToTaskFile(item: MeetingAsk, meetingRelPath: string): TaskFile {
  const citation = item.citations?.[0];
  return {
    id: `ask:${item.loop}:${item.id}`,
    title: item.title,
    status: "proposed",
    origin: { loop: item.loop, meeting: meetingRelPath, item_id: item.id },
    created_at: "",
    ...(citation?.anchor ? { provenance: { quote: citation.anchor, source: citation.source } } : {}),
    body: "",
  };
}
