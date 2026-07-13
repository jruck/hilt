import fs from "fs";
import path from "path";
import { defaultSandboxDir } from "../loops/emit";
import { parseLoopArtifact } from "../loops/artifacts";
import { openMeetingLedgerRuntime } from "../loops/meeting-ledger-runtime";
import { latestArtifactPath, loadRegistry, loopHome } from "../loops/registry";
import { listProposals } from "../tasks/proposals";
import type { TaskFile } from "../tasks/types";
import type { BriefingMode } from "./target-file";
import { extractTaskIds, isRedundantMeetingCitationLine, isTaskIdOnlyLine, meetingLabelFromRelPath } from "./canvas";

/** Marks briefings whose active decision membership may grow as new proposal files arrive. */
export const DECISION_CONTRACT_MARKER = "<!-- hilt:decisions-v1 -->";

export interface BriefingDecisionTask {
  id: string;
  title: string;
  meeting: string;
  created_at: string;
  due?: string;
  urgent: boolean;
}

export interface BriefingDecisionGroup {
  meeting: string;
  title: string;
  date: string | null;
  summary?: string;
  tasks: BriefingDecisionTask[];
  urgent: boolean;
}

export interface BriefingDecisionQueue {
  as_of: string;
  artifact_date: string | null;
  groups: BriefingDecisionGroup[];
  task_ids: string[];
  warnings: string[];
}

function cleanTitle(value: string): string {
  return value.replace(/^\s*🆕\s*/u, "").replace(/\s+/g, " ").trim();
}

function cleanSummary(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, 400);
}

function taskIdentityDate(id: string): string | null {
  const match = id.match(/^t-(\d{4})(\d{2})(\d{2})-\d+$/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : null;
}

const DECISION_CONTEXT_STOPWORDS = new Set([
  "about", "after", "again", "also", "before", "being", "from", "have", "into", "just",
  "more", "need", "only", "that", "their", "there", "these", "this", "through", "with",
]);

function decisionTokens(value: string): string[] {
  return (value.toLowerCase().match(/[a-z0-9][a-z0-9-]{2,}/g) || [])
    .filter((token) => !DECISION_CONTEXT_STOPWORDS.has(token));
}

/** Detect copied TaskCard copy without rejecting ordinary shared topic words. Four consecutive
 * meaningful title tokens (or the whole shorter title) is a paraphrase boundary, not context. */
export function decisionContextEchoesTaskTitle(context: string, taskTitle: string): boolean {
  const contextTokens = decisionTokens(context);
  const titleTokens = decisionTokens(taskTitle);
  if (titleTokens.length < 3 || contextTokens.length < 3) return false;
  const window = Math.min(4, titleTokens.length);
  const contextText = ` ${contextTokens.join(" ")} `;
  for (let index = 0; index <= titleTokens.length - window; index += 1) {
    if (contextText.includes(` ${titleTokens.slice(index, index + window).join(" ")} `)) return true;
  }
  return false;
}

function urgencyRank(task: BriefingDecisionTask, asOf: string): number {
  if (task.due && task.due <= asOf) return 0;
  if (task.urgent) return 1;
  if (task.due) return 2;
  return 3;
}

function compareTasks(a: BriefingDecisionTask, b: BriefingDecisionTask, asOf: string): number {
  return urgencyRank(a, asOf) - urgencyRank(b, asOf)
    || (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99")
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id);
}

export function buildBriefingDecisionQueue(input: {
  proposals: TaskFile[];
  asOf: string;
  artifactDate?: string | null;
  urgentTaskIds?: ReadonlySet<string>;
  meetingSummaries?: ReadonlyMap<string, string>;
}): BriefingDecisionQueue {
  const warnings: string[] = [];
  const tasks: BriefingDecisionTask[] = [];
  const seen = new Set<string>();
  for (const proposal of input.proposals) {
    if (proposal.status !== "proposed" || proposal.origin?.loop !== "meeting-actions") continue;
    if ((taskIdentityDate(proposal.id) ?? proposal.created_at.slice(0, 10)) > input.asOf) continue;
    if (!proposal.origin.meeting) {
      warnings.push(`proposal ${proposal.id} has no meeting origin`);
      continue;
    }
    if (seen.has(proposal.id)) continue;
    seen.add(proposal.id);
    tasks.push({
      id: proposal.id,
      title: cleanTitle(proposal.title),
      meeting: proposal.origin.meeting,
      created_at: proposal.created_at,
      ...(proposal.due ? { due: proposal.due } : {}),
      urgent: Boolean(input.urgentTaskIds?.has(proposal.id)),
    });
  }

  const grouped = new Map<string, BriefingDecisionTask[]>();
  for (const task of tasks) {
    const bucket = grouped.get(task.meeting);
    if (bucket) bucket.push(task);
    else grouped.set(task.meeting, [task]);
  }
  const groups = [...grouped.entries()].map(([meeting, meetingTasks]) => {
    const label = meetingLabelFromRelPath(meeting);
    const sorted = meetingTasks.sort((a, b) => compareTasks(a, b, input.asOf));
    const summary = input.meetingSummaries?.get(meeting);
    return {
      meeting,
      title: label.title,
      date: label.date,
      ...(summary ? { summary: cleanSummary(summary) } : {}),
      tasks: sorted,
      urgent: sorted.some((task) => urgencyRank(task, input.asOf) <= 1),
    };
  }).sort((a, b) => Number(b.urgent) - Number(a.urgent) || (b.date || "").localeCompare(a.date || "") || a.title.localeCompare(b.title));
  return {
    as_of: input.asOf,
    artifact_date: input.artifactDate || null,
    groups,
    task_ids: groups.flatMap((group) => group.tasks.map((task) => task.id)),
    warnings,
  };
}

function readMeetingSummaries(
  vaultPath: string,
  home: string,
  meetings: ReadonlySet<string>,
  warnings: string[],
): Map<string, string> {
  const summaries = new Map<string, string>();
  try {
    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: home });
    try {
      for (const meeting of meetings) {
        const value = ledger.meetingSummary(meeting);
        if (!value) continue;
        if (!value.summary.trim()) continue;
        summaries.set(meeting, cleanSummary(value.summary));
      }
    } finally {
      ledger.close();
    }
  } catch (error) {
    warnings.push(`meeting summaries unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  return summaries;
}

export function collectBriefingDecisionQueue(vaultPath: string, asOf: string): BriefingDecisionQueue {
  const proposals = listProposals(vaultPath);
  const representedMeetings = new Set(proposals.flatMap((proposal) =>
    proposal.status === "proposed" && proposal.origin?.loop === "meeting-actions" && proposal.origin.meeting
      ? [proposal.origin.meeting]
      : [],
  ));
  let artifactDate: string | null = null;
  const urgentTaskIds = new Set<string>();
  const meetingSummaries = new Map<string, string>();
  const warnings: string[] = [];
  try {
    const registry = loadRegistry(vaultPath);
    const meetingLoop = registry.loops.find((loop) => loop.id === "meeting-actions");
    if (meetingLoop) {
      const base = meetingLoop.phase === "live" ? vaultPath : defaultSandboxDir();
      for (const [meeting, summary] of readMeetingSummaries(
        vaultPath,
        loopHome(base, meetingLoop),
        representedMeetings,
        warnings,
      )) {
        meetingSummaries.set(meeting, summary);
      }
      const artifactPath = latestArtifactPath(base, meetingLoop, asOf);
      if (artifactPath) {
        artifactDate = artifactPath.match(/(\d{4}-\d{2}-\d{2})\.md$/)?.[1] || null;
        const artifact = parseLoopArtifact(fs.readFileSync(artifactPath, "utf-8"));
        for (const item of artifact.frontmatter.items) {
          if (item.task_id && item.escalated) urgentTaskIds.add(item.task_id);
        }
      }
    }
  } catch (error) {
    warnings.push(`meeting-actions artifact unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  const queue = buildBriefingDecisionQueue({
    proposals,
    asOf,
    artifactDate,
    urgentTaskIds,
    meetingSummaries,
  });
  return { ...queue, warnings: [...warnings, ...queue.warnings] };
}

function meetingCitation(group: BriefingDecisionGroup): string {
  return `*${group.meeting}${group.date ? `, ${group.date}` : ""}*`;
}

function renderGroup(group: BriefingDecisionGroup): string[] {
  const citation = meetingCitation(group);
  const summary = group.summary && !group.tasks.some((task) => decisionContextEchoesTaskTitle(group.summary!, task.title))
    ? group.summary
    : null;
  const lines = summary ? [`- ${summary}`, `  - ${citation}`] : [`- ${citation}`];
  lines.push(...group.tasks.map((task) => `  - \`${task.id}\``), "");
  return lines;
}

export function renderBriefingDecisionSection(queue: BriefingDecisionQueue): string {
  if (!queue.task_ids.length) return "";
  return [
    "## ⏭ Decisions awaiting you",
    "",
    ...queue.groups.flatMap(renderGroup),
  ].join("\n").trimEnd();
}

/** Bounded model context for editorial meeting selection. Task titles stay out because the live
 * TaskCards own that copy; the model needs only meeting substance, join keys, and allowed IDs. */
export function renderBriefingDecisionPromptData(queue: BriefingDecisionQueue): string {
  const lines = ["=== CANONICAL PENDING MEETING DECISIONS ==="];
  if (!queue.groups.length) return `${lines[0]}\nNo pending meeting decisions.`;
  lines.push("Use only these meeting citations and task IDs in Decisions. Task titles are intentionally omitted.", "");
  for (const group of queue.groups) {
    lines.push(`## ${group.title}${group.date ? ` · ${group.date}` : ""}`);
    lines.push(`Meeting citation: ${meetingCitation(group)}`);
    lines.push(`Meeting context: ${group.summary || "No stored summary; feature only if other supplied evidence supports substantive context."}`);
    lines.push("Allowed task IDs:", ...group.tasks.map((task) => `- \`${task.id}\``), "");
  }
  return lines.join("\n").trimEnd();
}

/** Remove proposal-card copy from the broad gather before the editorial model sees it. Meeting
 * summaries and taskless escalations remain; canonical citations/IDs are appended separately. */
export function sanitizeBriefingGatherForDecisions(gathered: string): string {
  const lines = gathered.split("\n");
  const output: string[] = [];
  let skipDecisionSection = false;
  let skipMeetingLedger = false;
  let inMeetingActions = false;
  let inMeetingEscalations = false;

  for (let index = 0; index < lines.length;) {
    const line = lines[index];
    if (skipDecisionSection) {
      if (!/^##\s+/.test(line)) {
        index += 1;
        continue;
      }
      skipDecisionSection = false;
    }
    if (/^##\s+⏭\ufe0f?\s+/.test(line)) {
      output.push("## ⏭ Decisions awaiting you", "", "_(Canonical pending decisions are supplied separately below.)_", "");
      skipDecisionSection = true;
      index += 1;
      continue;
    }
    if (/^##\s+loop:/.test(line)) {
      inMeetingActions = /^##\s+loop:meeting-actions\b/.test(line);
      inMeetingEscalations = false;
      skipMeetingLedger = false;
    }
    if (skipMeetingLedger) {
      if (!/^##\s+/.test(line)) {
        index += 1;
        continue;
      }
      skipMeetingLedger = false;
    }
    if (inMeetingActions && /^##\s+Ledger deltas\b/i.test(line)) {
      output.push("## Ledger deltas", "", "_(Canonical decision state is supplied separately below.)_");
      skipMeetingLedger = true;
      index += 1;
      continue;
    }
    if (inMeetingActions && /^##\s+Escalations\b/i.test(line)) {
      inMeetingEscalations = true;
      output.push(line, "", "_(Canonical proposal cards are supplied separately below.)_");
      index += 1;
      continue;
    }
    if (inMeetingEscalations && /^##\s+/.test(line)) {
      inMeetingEscalations = false;
      output.push(line);
      index += 1;
      continue;
    }
    if (inMeetingEscalations && /^-\s+/.test(line)) {
      const chunk = [line];
      index += 1;
      while (index < lines.length && !/^##\s+/.test(lines[index]) && !/^-\s+/.test(lines[index])) {
        chunk.push(lines[index]);
        index += 1;
      }
      if (!chunk.some((entry) => /(?:→\s*task\s*)?`?t-\d{8}-\d{3}`?/.test(entry))) output.push(...chunk);
      continue;
    }
    output.push(line);
    index += 1;
  }
  return output.join("\n").replace(/\n{4,}/g, "\n\n\n");
}

function decisionSectionRange(lines: string[]): { start: number; end: number } | null {
  const start = lines.findIndex((line) => /^##\s+⏭\ufe0f?\s+/.test(line));
  if (start === -1) return null;
  const next = lines.findIndex((line, index) => index > start && /^##\s+/.test(line));
  return { start, end: next === -1 ? lines.length : next };
}

function removeLegacyEmbeddedDecisionTail(markdown: string): string {
  const lines = markdown.replaceAll(DECISION_CONTRACT_MARKER, "").split("\n");
  const output: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^\*\*(?:⏭\s*)?(?:Pending verdicts?|Decisions awaiting you|Next steps)\b/i.test(line.trim())) {
      skipping = true;
      continue;
    }
    if (skipping && /^##\s+/.test(line)) skipping = false;
    if (!skipping) output.push(line);
  }
  return output.join("\n").replace(/\n{3,}/g, "\n\n");
}

function removeTopLevelDecisionSection(markdown: string): string {
  const lines = markdown.split("\n");
  const range = decisionSectionRange(lines);
  if (range) lines.splice(range.start, range.end - range.start);
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
}

function reconcileDecisionSection(section: string[], queue: BriefingDecisionQueue): string[] {
  const supplied = new Set(queue.task_ids);
  const reconciled = section.filter((line, index) => {
    if (index === 0) return true;
    if (/^_?\d+\s+decisions?\s+across\s+\d+\s+meetings?_?$/i.test(line.trim())) return false;
    const ids = extractTaskIds(line);
    return !(ids.length === 1 && supplied.has(ids[0]) && isTaskIdOnlyLine(line));
  });
  reconciled[0] = "## ⏭ Decisions awaiting you";

  for (const group of queue.groups) {
    const citationIndex = reconciled.findIndex((line) => isRedundantMeetingCitationLine(line, group.meeting));
    if (citationIndex === -1) {
      if (reconciled.at(-1)?.trim()) reconciled.push("");
      reconciled.push(...renderGroup(group));
      continue;
    }
    reconciled.splice(citationIndex + 1, 0, ...group.tasks.map((task) => `  - \`${task.id}\``));
  }
  return reconciled.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd().split("\n");
}

function insertDecisionSection(markdown: string, section: string): string {
  const workHeading = markdown.search(/^##\s+💼/m);
  const fallbackHeading = markdown.search(/^##\s+(?:📚|🌱|📈)/m);
  const insertionPoint = workHeading >= 0 ? workHeading : fallbackHeading >= 0 ? fallbackHeading : markdown.length;
  const before = markdown.slice(0, insertionPoint).trimEnd();
  const after = markdown.slice(insertionPoint).trimStart();
  return after ? `${before}\n\n${section}\n\n${after}` : `${before}\n\n${section}`;
}

/** Preserve the model's substantive meeting leads and order, then stamp exact canonical task
 * membership. Groups the model omits are appended with their stored meeting summary when present. */
export function composeBriefingDecisions(markdown: string, mode: BriefingMode, queue: BriefingDecisionQueue): string {
  void mode;
  const cleaned = removeLegacyEmbeddedDecisionTail(markdown).trimEnd();
  if (!queue.task_ids.length) {
    return `${removeTopLevelDecisionSection(cleaned)}\n${DECISION_CONTRACT_MARKER}\n`;
  }

  const lines = cleaned.split("\n");
  const range = decisionSectionRange(lines);
  let composed: string;
  if (!range) {
    composed = insertDecisionSection(cleaned, renderBriefingDecisionSection(queue));
  } else {
    const section = reconcileDecisionSection(lines.slice(range.start, range.end), queue);
    lines.splice(range.start, range.end - range.start, ...section);
    composed = lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  }
  return `${composed}\n${DECISION_CONTRACT_MARKER}\n`;
}
