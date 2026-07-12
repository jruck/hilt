import type { BriefingDateRange, BriefingKind } from "../bridge/briefing-files";
import type { TaskFile } from "../tasks/types";

export interface ActiveBriefingIdentity {
  kind: BriefingKind;
  date: string;
  dateRange?: BriefingDateRange;
}

export interface DecisionMeetingGroup {
  meeting: string;
  tasks: TaskFile[];
}

function isMeetingProposal(task: TaskFile): boolean {
  return task.status === "proposed"
    && task.origin?.loop === "meeting-actions"
    && Boolean(task.origin.meeting);
}

/** A daily briefing is active only on its date. A weekend briefing stays active throughout its
 * frozen frontmatter range so Saturday and Sunday can share one live decision queue. */
export function isBriefingActive(briefing: ActiveBriefingIdentity, today: string): boolean {
  if (briefing.kind === "daily") return briefing.date === today;
  const start = briefing.dateRange?.start || briefing.date;
  const end = briefing.dateRange?.end || briefing.date;
  return today >= start && today <= end;
}

/** Pending membership is frozen to IDs in markdown unless this is the currently active briefing. */
export function decisionPendingProposals(
  proposals: TaskFile[],
  stampedIds: ReadonlySet<string>,
  activeBriefing: boolean,
): TaskFile[] {
  return proposals.filter((task) => isMeetingProposal(task) && (activeBriefing || stampedIds.has(task.id)));
}

/** New meetings may append only to the current daily/weekend briefing. Existing meeting groups
 * absorb their new proposals through decisionPendingProposals, so this returns unfeatured groups. */
export function activeDecisionMeetingGroups(
  proposals: TaskFile[],
  featuredMeetings: ReadonlySet<string>,
  activeBriefing: boolean,
): DecisionMeetingGroup[] {
  if (!activeBriefing) return [];
  const grouped = new Map<string, TaskFile[]>();
  for (const task of proposals) {
    if (!isMeetingProposal(task) || !task.origin?.meeting || featuredMeetings.has(task.origin.meeting)) continue;
    const bucket = grouped.get(task.origin.meeting);
    if (bucket) bucket.push(task);
    else grouped.set(task.origin.meeting, [task]);
  }
  return [...grouped.entries()]
    .map(([meeting, tasks]) => ({
      meeting,
      tasks: tasks.sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99") || a.id.localeCompare(b.id)),
    }))
    .sort((a, b) => {
      const aDate = a.meeting.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || "";
      const bDate = b.meeting.match(/meetings\/(\d{4}-\d{2}-\d{2})\//)?.[1] || "";
      return bDate.localeCompare(aDate) || a.meeting.localeCompare(b.meeting);
    });
}

export function isDecisionQueueSummary(headline: string): boolean {
  return /^_?\d+\s+decisions?\s+across\s+\d+\s+meetings?_?$/i.test(headline.trim());
}
