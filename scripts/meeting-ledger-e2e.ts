import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { collectBriefingDecisionQueue } from "../src/lib/briefing/decisions";
import { appendVerdict } from "../src/lib/loops/stores";
import { MeetingLedgerStore, meetingLedgerDbPath, readMeetingLedgerStorageMarker, writeMeetingLedgerStorageMarker } from "../src/lib/loops/meeting-ledger-store";
import { dismissProposal } from "../src/lib/tasks/proposals";
import { restoreProposalFromLedgerEntry } from "../src/lib/loops/proposal-mint";
import { listProposals } from "../src/lib/tasks/proposals";

const execFileAsync = promisify(execFile);
const root = fs.mkdtempSync(path.join(os.tmpdir(), "hilt-meeting-ledger-e2e-"));
if (!root.startsWith(path.join(os.tmpdir(), "hilt-meeting-ledger-e2e-"))) throw new Error(`unsafe E2E root: ${root}`);
const vault = path.join(root, "vault");
const dataDir = path.join(root, "data");
const loopHome = path.join(dataDir, "loops-shadow", "meta", "loops", "meetings");
const fakeClaude = path.join(root, "fake-claude.cjs");
const tsx = path.join(process.cwd(), "node_modules", ".bin", "tsx");
const env = { ...process.env, DATA_DIR: dataDir, BRIDGE_VAULT_PATH: vault, HILT_WORKING_FOLDER: vault, CLAUDE_BIN: fakeClaude };

function write(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

function meeting(rel: string, transcriptRel: string, body: string): void {
  write(path.join(vault, rel), `---\ntranscript: "[[${transcriptRel.replace(/\.md$/, "")}]]"\n---\n\n${body}\n`);
  write(path.join(vault, transcriptRel), "You: I will send the launch scorecard after this meeting.\nGuest: Great, that unblocks the review.\n");
}

async function runScript(script: string, args: string[], extraEnv: Record<string, string | undefined> = {}): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(tsx, [script, ...args], { cwd: process.cwd(), env: { ...env, ...extraEnv } as NodeJS.ProcessEnv, maxBuffer: 16 * 1024 * 1024, timeout: 120_000 });
}

async function runMeeting(paths: string[], extraEnv: Record<string, string | undefined> = {}): Promise<void> {
  const list = path.join(root, `meetings-${Math.random().toString(36).slice(2)}.json`);
  write(list, `${JSON.stringify(paths)}\n`);
  await runScript("scripts/loop-meeting-actions.ts", ["--vault", vault, "--date", "2026-07-12", "--meetings-file", list, "--max-meetings", String(paths.length || 1)], extraEnv);
}

async function main(): Promise<void> {
  write(path.join(vault, "meta", "loops", "registry.yml"), [
    "loops:",
    "  - id: meeting-actions", "    domain: meetings", "    cadence: daily", "    enabled: true", "    phase: shadow", "    proposal_sink: vault",
    "  - id: goals-areas", "    domain: goals", "    cadence: daily", "    enabled: true", "    phase: shadow",
    "",
  ].join("\n"));
  write(path.join(vault, "areas", "index.md"), "# Areas\n\n## Now\n\nShip the launch scorecard.\n");
  write(fakeClaude, `#!/usr/bin/env node
const fs = require("fs");
const args = process.argv.slice(2);
const systemPath = args[args.indexOf("--append-system-prompt-file") + 1];
const system = fs.readFileSync(systemPath, "utf8");
const task = args[args.indexOf("-p") + 1] || "";
if (system.includes("You extract COMMITMENT and CLOSURE observations")) {
  if (task.includes("Same-run close")) console.log(JSON.stringify({meeting_summary:"The decision memo was withdrawn before escalation.",commitments:[],closures:[{observation_id:"x2",action:"Publish the decision memo",outcome:"resolved",quote:"The decision memo is no longer needed."}]}));
  else if (task.includes("Same-run open")) console.log(JSON.stringify({meeting_summary:"The decision memo was assigned.",commitments:[{observation_id:"c2",action:"Publish the decision memo",owner:"justin",quote:"I will publish the decision memo.",context:"The memo records the launch decision.",source:"transcript",confidence:0.95}],closures:[]}));
  else console.log(JSON.stringify({meeting_summary:"The launch review established the scorecard handoff as the next concrete step.",commitments:[{observation_id:"c1",action:"Send the launch scorecard",owner:"justin",quote:"I will send the launch scorecard after this meeting.",context:"The scorecard unblocks the launch review.",source:"transcript",confidence:0.95}],closures:[]}));
} else if (system.includes("resolve raw meeting observations")) {
  const candidateLine = task.split("\\n").find((line) => line.includes("Publish the decision memo") && /ma-\\d{4}-/.test(line));
  const candidateId = (candidateLine?.match(/ma-\\d{4}-\\d{2}-\\d{2}-\\d{3,}/) || [null])[0];
  const fallbackId = (task.match(/ma-\\d{4}-\\d{2}-\\d{2}-\\d{3,}/) || [null])[0];
  if (task.includes("Same-run close")) console.log(JSON.stringify({commitment_matches:[],closure_matches:[{observation_id:"x2",ledger_id:candidateId,confidence:candidateId?0.99:0,reason:"same memo"}]}));
  else if (task.includes("Same-run open")) console.log(JSON.stringify({commitment_matches:[{observation_id:"c2",ledger_id:null,confidence:0,reason:"new memo"}],closure_matches:[]}));
  else console.log(JSON.stringify({commitment_matches:[{observation_id:"c1",ledger_id:fallbackId,confidence:fallbackId?0.99:0,reason:"same deliverable"}],closure_matches:[]}));
} else if (system.includes("goals/areas alignment analyst")) {
  console.log(JSON.stringify({alignment:[{priority:"Ship the launch scorecard",evidence:["Send the launch scorecard"],read:"advancing"}],contradictions:[],drift:[],summary:"The scorecard handoff directly advances the stated launch priority."}));
} else if (system.includes("Choose the single best ledger identity")) {
  const id = (task.match(/ma-\\d{4}-\\d{2}-\\d{2}-\\d{3,}/) || [null])[0];
  console.log(JSON.stringify({choices:[{observation_id:"c1",ledger_id:id}]}));
} else { console.log("{}"); }
`);
  fs.chmodSync(fakeClaude, 0o755);
  fs.mkdirSync(path.join(vault, "tasks", ".proposals"), { recursive: true });
  fs.mkdirSync(path.join(loopHome, "state"), { recursive: true });

  process.env.DATA_DIR = dataDir;
  const initial = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  initial.close();
  writeMeetingLedgerStorageMarker(vault, { version: 1, mode: "sqlite", migrated_at: "2026-07-12T12:00:00.000Z", legacy_home: loopHome });

  const first = "meetings/2026-07-12/Launch review.md";
  const second = "meetings/2026-07-12/Launch follow-up.md";
  const crash = "meetings/2026-07-12/Launch crash retry.md";
  const sameRunOpen = "meetings/2026-07-12/Same-run open.md";
  const sameRunClose = "meetings/2026-07-12/Same-run close.md";
  const nightly = "meetings/2026-07-12/Nightly queue.md";
  meeting(first, "transcripts/2026-07-12/Launch review.md", "## Next Steps\n\n- Send the launch scorecard (Justin)");
  meeting(second, "transcripts/2026-07-12/Launch follow-up.md", "## Next Steps\n\n- Send the launch scorecard (Justin)");
  meeting(crash, "transcripts/2026-07-12/Launch crash retry.md", "## Next Steps\n\n- Send the launch scorecard (Justin)");
  meeting(sameRunOpen, "transcripts/2026-07-12/Same-run open.md", "## Next Steps\n\n- Publish the decision memo (Justin)");
  meeting(sameRunClose, "transcripts/2026-07-12/Same-run close.md", "## Notes\n\nThe decision memo is no longer needed.");
  meeting(nightly, "transcripts/2026-07-12/Nightly queue.md", "## Next Steps\n\n- Send the launch scorecard (Justin)");

  await runMeeting([first]);
  let store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.counts().total, 1);
  const ledgerEntry = Object.values(store.readAll().entries)[0];
  assert.equal(ledgerEntry.action, "Send the launch scorecard");
  assert.equal(store.isProcessed(first), true);
  store.close();
  assert.equal(listProposals(vault).length, 1);
  const taskId = listProposals(vault)[0].id;

  await runMeeting([sameRunOpen, sameRunClose]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  const sameRunEntry = Object.values(store.readAll().entries).find((entry) => entry.action === "Publish the decision memo");
  assert.equal(sameRunEntry?.status, "resolved");
  assert.equal(sameRunEntry?.task_id, undefined, "closed-in-batch work must not be promoted from a stale opened snapshot");
  assert.equal(store.isProcessed(sameRunOpen), true);
  assert.equal(store.isProcessed(sameRunClose), true);
  store.close();
  assert.deepEqual(listProposals(vault).map((task) => task.id), [taskId]);

  await runMeeting([second]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  const afterSighting = store.getEntry(ledgerEntry.id)!;
  assert.equal(store.counts().total, 2);
  assert.equal(afterSighting.sightings.length, 1);
  assert.equal(store.isProcessed(second), true);
  store.close();
  assert.equal(listProposals(vault).length, 1);

  const crashList = path.join(root, "crash.json");
  write(crashList, `${JSON.stringify([crash])}\n`);
  await assert.rejects(runScript("scripts/loop-meeting-actions.ts", ["--vault", vault, "--date", "2026-07-12", "--meetings-file", crashList], { HILT_MEETING_LEDGER_CRASH_BEFORE_COMMIT: crash }));
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.isProcessed(crash), false);
  assert.equal(store.getEntry(ledgerEntry.id)!.sightings.length, 1);
  assert.equal((store.db.prepare("SELECT COUNT(*) AS count FROM extraction_runs WHERE status='active'").get() as { count: number }).count, 1);
  store.close();
  await runMeeting([crash]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.isProcessed(crash), true);
  assert.equal(store.getEntry(ledgerEntry.id)!.sightings.length, 2);
  store.close();

  // The scheduler path discovers the remaining meeting, persists/claims it from the same queue,
  // and completes the job only after canonical output verifies.
  await runScript("scripts/loop-meeting-actions.ts", ["--vault", vault, "--date", "2026-07-12", "--max-meetings", "1"]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.isProcessed(nightly), true);
  assert.equal(store.getExtractionJob(nightly)?.status, "complete");
  assert.equal(store.extractionQueueHealth().depth, 0);
  store.close();
  assert.equal(listProposals(vault).length, 1, "nightly queue must not duplicate a sighted proposal");

  // A missing DATA_DIR used to split state into cwd/data while still writing live Bridge files.
  // The canonical storage guard now fails before extraction or proposal mutation.
  const guardList = path.join(root, "guard.json");
  write(guardList, `${JSON.stringify([first])}\n`);
  await assert.rejects(
    runScript("scripts/loop-meeting-actions.ts", ["--vault", vault, "--date", "2026-07-12", "--meetings-file", guardList], {
      DATA_DIR: path.join(root, "wrong-data-dir"),
    }),
    (error: unknown) => String((error as { stderr?: string }).stderr ?? error).includes("refusing live proposal writes without canonical SQLite meeting state"),
  );

  dismissProposal(vault, taskId);
  appendVerdict(loopHome, { id: "v-dismiss", author: "justin", created_at: "2026-07-12T15:00:00.000Z", loop: "meeting-actions", item_id: ledgerEntry.id, verdict: "dismiss" });
  await runMeeting([]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.getEntry(ledgerEntry.id)!.status, "dropped");
  const dropped = store.getEntry(ledgerEntry.id)!;
  store.close();
  restoreProposalFromLedgerEntry(dropped, { vaultPath: vault, loopId: "meeting-actions", now: "2026-07-12T16:00:00.000Z" });
  appendVerdict(loopHome, { id: "v-restore", author: "justin", created_at: "2026-07-12T16:00:00.000Z", loop: "meeting-actions", item_id: ledgerEntry.id, verdict: "restore" });
  await runMeeting([]);
  store = new MeetingLedgerStore(meetingLedgerDbPath(vault));
  assert.equal(store.getEntry(ledgerEntry.id)!.status, "open");
  assert.equal(store.getEntry(ledgerEntry.id)!.task_id, taskId);
  assert.equal(store.integrityCheck(), "ok");
  assert.ok(store.eventsForEntry(ledgerEntry.id).some((event) => event.event_type === "verdict-applied"));
  store.close();
  assert.deepEqual(listProposals(vault).map((task) => task.id), [taskId]);

  await runScript("scripts/loop-goals-areas.ts", ["--vault", vault, "--date", "2026-07-12", "--as-of", "2026-07-12", "--window-days", "7"]);
  assert.ok(fs.existsSync(path.join(dataDir, "loops-shadow", "meta", "loops", "goals", "reports", "2026-07-12.md")));
  const decisions = collectBriefingDecisionQueue(vault, "2026-07-12");
  assert.deepEqual(decisions.task_ids, [taskId]);
  assert.equal(decisions.groups[0].summary, "The launch review established the scorecard handoff as the next concrete step.");
  assert.equal(readMeetingLedgerStorageMarker(vault).mode, "sqlite");
  assert.ok(fs.existsSync(path.join(path.dirname(meetingLedgerDbPath(vault)), "backups", "latest.sqlite")));

  await runScript("scripts/meeting-ledger.ts", ["rollback", "--vault", vault, "--legacy-home", loopHome]);
  assert.equal(readMeetingLedgerStorageMarker(vault).mode, "legacy");
  const rolledBack = JSON.parse(fs.readFileSync(path.join(loopHome, "state", "ledger.json"), "utf-8"));
  assert.equal(Object.keys(rolledBack.entries).length, 2);
  assert.equal(rolledBack.entries[ledgerEntry.id].task_id, taskId);
  await runScript("scripts/meeting-ledger.ts", ["migrate", "--vault", vault, "--legacy-home", loopHome]);
  await runScript("scripts/meeting-ledger.ts", ["activate", "--vault", vault, "--legacy-home", loopHome]);
  assert.equal(readMeetingLedgerStorageMarker(vault).mode, "sqlite");
  const audited = JSON.parse((await runScript("scripts/meeting-ledger.ts", ["audit", "--vault", vault, "--legacy-home", loopHome])).stdout);
  assert.equal(audited.ok, true);
  assert.equal(audited.parity.ok, true);

  console.log(JSON.stringify({ ok: true, entries: 2, same_run_closed: 1, sightings: 3, nightly_queue: "verified", canonical_guard: "verified", task_id: taskId, decisions: decisions.task_ids.length, integrity: "ok", rollback: "verified" }, null, 2));
}

main().finally(() => {
  delete process.env.DATA_DIR;
  if (process.env.KEEP_E2E !== "1") fs.rmSync(root, { recursive: true, force: true });
  else console.error(`[meeting-ledger-e2e] retained ${root}`);
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
