import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defaultSandboxDir } from "../src/lib/loops/emit";
import { openMeetingLedgerRuntime } from "../src/lib/loops/meeting-ledger-runtime";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import { readTaskIdSequenceState, taskIdSequencePath } from "../src/lib/tasks/ids";
import { listProposals } from "../src/lib/tasks/proposals";
import { listTasks } from "../src/lib/tasks/store";
import { auditMeetingLedgerTaskLinks } from "../src/lib/tasks/ledger-links";

loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
const argValue = (name: string): string | null => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] || null : null;
};

const vaultPath = path.resolve(
  argValue("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || path.join(os.homedir(), "work", "bridge"),
);
const ledgerHomeOverride = argValue("--ledger-home");
const meetingLoop = loadRegistry(vaultPath).loops.find((loop) => loop.id === "meeting-actions");
if (!meetingLoop) throw new Error("meeting-actions not in registry");
const ledgerHome = path.resolve(ledgerHomeOverride || (
  meetingLoop.phase === "live" ? loopHome(vaultPath, meetingLoop) : loopHome(defaultSandboxDir(), meetingLoop)
));

if (!fs.existsSync(vaultPath)) throw new Error(`vault not found: ${vaultPath}`);

const ledger = openMeetingLedgerRuntime({
  vaultPath,
  legacyHome: ledgerHome,
  ledgerHomeOverride,
  forceSqlite: args.includes("--sqlite"),
});
const ledgerEntries = ledger.allEntries();
const tasks = listTasks(vaultPath);
const proposals = listProposals(vaultPath);
const tasksById = new Map(tasks.map((task) => [task.id, task]));
const proposalsById = new Map(proposals.map((task) => [task.id, task]));
const currentDuplicates = tasks
  .filter((task) => proposalsById.has(task.id))
  .map((task) => task.id)
  .sort();
const stampedEntries = ledgerEntries.filter((entry) => Boolean(entry.task_id));
const linkIssues = auditMeetingLedgerTaskLinks(ledgerEntries, [...tasks, ...proposals]);
const entriesByTask = new Map<string, typeof stampedEntries>();
const sequencePath = taskIdSequencePath(vaultPath);
const sequence = readTaskIdSequenceState(vaultPath);

for (const entry of stampedEntries) {
  const bucket = entriesByTask.get(entry.task_id!);
  if (bucket) bucket.push(entry);
  else entriesByTask.set(entry.task_id!, [entry]);
}

const duplicates = [...entriesByTask.entries()]
  .filter(([, entries]) => entries.length > 1)
  .map(([task_id, entries]) => ({
    task_id,
    entries: entries.map((entry) => ({
      item_id: entry.id,
      status: entry.status,
      verdict: entry.verdict?.verdict ?? null,
      action: entry.action,
    })),
  }));

const unaccounted = stampedEntries.flatMap((entry) => {
  const id = entry.task_id!;
  const hasProposal = proposalsById.has(id);
  const hasTask = tasksById.has(id);
  if (entry.verdict?.verdict === "dismiss" && entry.status === "dropped" && !hasProposal && !hasTask) return [];
  if (entry.verdict?.verdict === "approve" && hasTask) return [];
  if (!entry.verdict && entry.status === "open" && hasProposal) return [];
  return [{
    item_id: entry.id,
    task_id: id,
    status: entry.status,
    verdict: entry.verdict?.verdict ?? null,
    file: hasProposal ? "proposal" : hasTask ? "task" : "none",
    action: entry.action,
  }];
});

const latent = ledgerEntries.filter((entry) => (
  entry.status === "open"
  && !entry.verdict
  && !entry.task_id
  && !entry.first_escalated_at
  && (entry.owner === "justin" || entry.owner === "unclear")
));

const requiredHighWater = new Map<string, number>();
for (const id of [
  ...tasks.map((task) => task.id),
  ...proposals.map((task) => task.id),
  ...stampedEntries.map((entry) => entry.task_id!),
]) {
  const match = id.match(/^t-(\d{8})-(\d{3,})$/);
  if (!match) continue;
  requiredHighWater.set(match[1], Math.max(requiredHighWater.get(match[1]) ?? 0, Number(match[2])));
}
const sequenceGaps = [...requiredHighWater.entries()].flatMap(([date, required]) => {
  const reserved = sequence.high_water[date] ?? 0;
  return reserved >= required ? [] : [{ date, required, reserved }];
});

const result = {
  ok: duplicates.length === 0
    && currentDuplicates.length === 0
    && unaccounted.length === 0
    && linkIssues.length === 0
    && fs.existsSync(sequencePath)
    && sequenceGaps.length === 0,
  vault: vaultPath,
  ledger_home: ledgerHome,
  ledger_storage: ledger.mode,
  current: {
    proposals: proposals.length,
    meeting_proposals: proposals.filter((task) => task.origin?.loop === "meeting-actions").length,
    other_proposals: proposals.filter((task) => task.origin?.loop !== "meeting-actions").length,
    accepted_tasks: tasks.length,
  },
  meeting_identity: {
    stamped_entries: stampedEntries.length,
    unique_task_ids: entriesByTask.size,
    dismissed: stampedEntries.filter((entry) => entry.verdict?.verdict === "dismiss").length,
    approved: stampedEntries.filter((entry) => entry.verdict?.verdict === "approve").length,
    pending: stampedEntries.filter((entry) => !entry.verdict && entry.status === "open").length,
    latent_unreviewed: latent.length,
  },
  sequence: {
    path: sequencePath,
    exists: fs.existsSync(sequencePath),
    state: sequence,
    gaps: sequenceGaps,
  },
  duplicates,
  current_duplicates: currentDuplicates,
  reciprocal_link_issues: linkIssues,
  unaccounted,
};

console.log(JSON.stringify(result, null, 2));
ledger.close();
if (!result.ok) process.exitCode = 1;
