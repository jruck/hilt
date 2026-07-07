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
import { parseOwnerPrefix } from "./owner";

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

  // A dismissed ask is OUT of the card lanes immediately — even in the limbo window where the
  // verdict is recorded but the loop hasn't applied it to its ledger yet (the proposal file is
  // already deleted; a badge-carrying card lingering here was the 2026-07-07 sighting). It
  // surfaces in the dismissed tail instead (mergeDismissed). Approve/assign/revise keep their
  // badge-card treatment — approve genuinely becomes a task; only dismissal means "out of
  // sight but recorded".
  const unmintedAsks = input.escalations.filter(
    (item) =>
      (item.kind === "action" || item.kind === "proposal") &&
      item.verdict !== "dismiss" &&
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

/** A ledger-backed dismissed record as `/api/loops/dismissed` returns it (structural). */
export interface DismissedRecord {
  id: string;
  action: string;
  dismissed_at: string;
  opened_from: string;
}

/** One row of a dismissed tail. `dismissed_at` is absent for LIMBO dismissals — the verdict is
 * recorded but the loop hasn't stamped its ledger yet (renderers show "just now"). */
export interface DismissedDisplayItem {
  id: string;
  action: string;
  dismissed_at?: string;
}

/**
 * The dismissed-tail item list for one surface: ledger-backed records MERGED with limbo
 * dismissals from the escalations feed (verdict === "dismiss", ledger stamp pending until the
 * loop's next run). Dedupe is by ledger id — once the loop applies the verdict, the same item
 * arrives from `/api/loops/dismissed` and the ledger record (which has the real timestamp)
 * wins. Limbo items sort first (they were dismissed just now; the ledger list is newest-first).
 *
 * `meetingRelPath` scopes both sides to one meeting (B2/B3 tails): ledger records by exact
 * `opened_from` equality, limbo asks by citation match. Pass `null` when the surface is
 * meeting-scoped but the path is unresolvable (nothing renders); omit it entirely for
 * unscoped surfaces (the Priorities Proposals tail).
 */
export function mergeDismissed(
  ledgerItems: DismissedRecord[],
  escalationItems: MeetingAsk[],
  meetingRelPath?: string | null,
): DismissedDisplayItem[] {
  const scoped = meetingRelPath !== undefined;
  if (scoped && meetingRelPath === null) return [];
  const ledger = scoped ? filterMeetingDismissed(ledgerItems, meetingRelPath!) : ledgerItems;
  const ledgerIds = new Set(ledger.map((item) => item.id));
  const limbo = escalationItems.filter(
    (item) =>
      (item.kind === "action" || item.kind === "proposal") &&
      item.verdict === "dismiss" &&
      !ledgerIds.has(item.id) &&
      (!scoped || askMatchesMeeting(item, meetingRelPath!)),
  );
  return [
    // Owner prefixes strip here too: the ledger `action` never carried them (the loop adds the
    // bracket only when composing the item TITLE), so limbo rows match post-loop rows exactly.
    ...limbo.map((item) => ({ id: item.id, action: parseOwnerPrefix(item.title).title })),
    ...ledger.map(({ id, action, dismissed_at }) => ({ id, action, dismissed_at })),
  ];
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
