import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defaultSandboxDir } from "../src/lib/loops/emit";
import { openMeetingLedgerRuntime } from "../src/lib/loops/meeting-ledger-runtime";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import { listProposals, writeProposal } from "../src/lib/tasks/proposals";
import { listTasks, taskPath, proposalPath, writeTask } from "../src/lib/tasks/store";
import { stripLegacyGeneratedMeetingTaskNotes } from "../src/lib/tasks/ledger-task-body";

loadEnvConfig(process.cwd());
process.env.DATA_DIR ||= path.join(os.homedir(), ".hilt", "data");

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const value = (flag: string): string | null => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] || null : null;
};
const vaultPath = path.resolve(
  value("--vault")
  || process.env.BRIDGE_VAULT_PATH
  || process.env.HILT_WORKING_FOLDER
  || path.join(os.homedir(), "work", "bridge"),
);
const ledgerHomeOverride = value("--ledger-home");
const meetingLoop = loadRegistry(vaultPath).loops.find((loop) => loop.id === "meeting-actions");
if (!meetingLoop) throw new Error("meeting-actions loop not found");
const legacyHome = path.resolve(ledgerHomeOverride || (
  meetingLoop.phase === "live" ? loopHome(vaultPath, meetingLoop) : loopHome(defaultSandboxDir(), meetingLoop)
));

const ledger = openMeetingLedgerRuntime({
  vaultPath,
  legacyHome,
  ledgerHomeOverride,
  forceSqlite: args.includes("--sqlite"),
});

type Candidate = {
  store: "tasks" | "proposals";
  file: string;
  item_id: string;
  task: ReturnType<typeof listTasks>[number];
  updated: ReturnType<typeof listTasks>[number];
  removed: string;
};

const candidates: Candidate[] = [];
const missingEntries: Array<{ task_id: string; item_id: string }> = [];
for (const [store, tasks] of [["tasks", listTasks(vaultPath)], ["proposals", listProposals(vaultPath)]] as const) {
  for (const task of tasks) {
    const itemId = task.origin?.loop === "meeting-actions" ? task.origin.item_id : null;
    if (!itemId) continue;
    const entry = ledger.getEntry(itemId);
    if (!entry) {
      missingEntries.push({ task_id: task.id, item_id: itemId });
      continue;
    }
    const result = stripLegacyGeneratedMeetingTaskNotes(task, entry);
    if (!result.changed || !result.removed) continue;
    candidates.push({
      store,
      file: store === "tasks" ? taskPath(vaultPath, task.id) : proposalPath(vaultPath, task.id),
      item_id: itemId,
      task,
      updated: result.task,
      removed: result.removed,
    });
  }
}

let snapshot: string | null = null;
if (apply && candidates.length > 0) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  snapshot = path.join(process.env.DATA_DIR!, "task-body-migrations", stamp);
  fs.mkdirSync(snapshot, { recursive: true });
  const manifest = candidates.map((candidate) => {
    const relative = path.relative(vaultPath, candidate.file);
    const backup = path.join(snapshot!, relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(candidate.file, backup);
    return {
      task_id: candidate.task.id,
      item_id: candidate.item_id,
      store: candidate.store,
      relative,
      sha256: crypto.createHash("sha256").update(fs.readFileSync(candidate.file)).digest("hex"),
      removed: candidate.removed,
    };
  });
  fs.writeFileSync(path.join(snapshot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  for (const candidate of candidates) {
    if (candidate.store === "tasks") writeTask(vaultPath, candidate.updated);
    else writeProposal(vaultPath, candidate.updated);
  }
}

console.log(JSON.stringify({
  mode: apply ? "apply" : "dry-run",
  vault: vaultPath,
  ledger_storage: ledger.mode,
  changed: candidates.length,
  snapshot,
  missing_entries: missingEntries,
  tasks: candidates.map((candidate) => ({
    task_id: candidate.task.id,
    item_id: candidate.item_id,
    store: candidate.store,
    file: candidate.file,
    removed: candidate.removed,
  })),
}, null, 2));

ledger.close();
if (missingEntries.length > 0) process.exitCode = 1;
