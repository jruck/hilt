import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { atomicWriteFile } from "../library/utils";
import type { Ledger } from "./meeting-ledger";
import { MeetingLedgerStore, meetingLedgerRoot } from "./meeting-ledger-store";

export interface LegacyMeetingState {
  ledger: Ledger;
  summaries: Record<string, { date: string; summary: string }>;
  processed: Record<string, string>;
}

export interface MeetingLedgerBackupResult {
  latest: string;
  daily: string;
  monthly: string;
  quick_check: string;
  size_bytes: number;
}

function readJson<T>(filePath: string, fallback: T): T {
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T; } catch { return fallback; }
}

export function readLegacyMeetingState(home: string): LegacyMeetingState {
  return {
    ledger: readJson<Ledger>(path.join(home, "state", "ledger.json"), { version: 1, entries: {} }),
    summaries: readJson(path.join(home, "state", "meeting-summaries.json"), {}),
    processed: readJson<{ processed?: Record<string, string> }>(
      path.join(home, "state", "processed-meetings.json"),
      { processed: {} },
    ).processed ?? {},
  };
}

export function exportLegacyMeetingState(
  store: MeetingLedgerStore,
  home: string,
  exportedAt = new Date().toISOString(),
): LegacyMeetingState {
  const state: LegacyMeetingState = {
    ledger: store.readAll(),
    summaries: Object.fromEntries(store.meetingSummaries().map((record) => [record.meeting, {
      date: record.date,
      summary: record.summary,
    }])),
    processed: store.processedMeetings(),
  };
  atomicWriteFile(path.join(home, "state", "ledger.json"), `${JSON.stringify(state.ledger, null, 1)}\n`);
  atomicWriteFile(path.join(home, "state", "meeting-summaries.json"), `${JSON.stringify(state.summaries, null, 1)}\n`);
  atomicWriteFile(
    path.join(home, "state", "processed-meetings.json"),
    `${JSON.stringify({ processed: state.processed, exported_at: exportedAt }, null, 1)}\n`,
  );
  return state;
}

export function writeReadableMeetingLedgerExport(
  store: MeetingLedgerStore,
  vaultPath: string,
  exportedAt = new Date().toISOString(),
): string {
  const target = path.join(meetingLedgerRoot(vaultPath), "exports", "ledger-latest.json");
  const body = {
    version: 1,
    exported_at: exportedAt,
    counts: store.counts(),
    ledger: store.readAll(),
    meeting_summaries: store.meetingSummaries(),
    processed_meetings: store.processedMeetings(),
    extraction_jobs: store.extractionJobs(),
    extraction_queue: store.extractionQueueHealth(),
  };
  atomicWriteFile(target, `${JSON.stringify(body, null, 1)}\n`);
  return target;
}

function prune(dir: string, prefix: string, keep: number): void {
  const files = fs.readdirSync(dir)
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
    .sort()
    .reverse();
  for (const name of files.slice(keep)) fs.unlinkSync(path.join(dir, name));
}

function copyAtomic(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.copyFileSync(source, temp);
  fs.renameSync(temp, target);
}

export async function backupMeetingLedger(
  store: MeetingLedgerStore,
  vaultPath: string,
  now = new Date(),
): Promise<MeetingLedgerBackupResult> {
  const root = meetingLedgerRoot(vaultPath);
  const dir = path.join(root, "backups");
  fs.mkdirSync(dir, { recursive: true });
  const timestamp = now.toISOString().replace(/[:.]/g, "-");
  const staging = path.join(dir, `.meeting-ledger-${timestamp}.${process.pid}.tmp.sqlite`);
  await store.db.backup(staging);
  const checkDb = new Database(staging, { readonly: true, fileMustExist: true });
  let quickCheck = "unknown";
  try {
    quickCheck = (checkDb.prepare("PRAGMA quick_check").get() as { quick_check: string }).quick_check;
  } finally {
    checkDb.close();
  }
  for (const suffix of ["-wal", "-shm"]) {
    const sidecar = `${staging}${suffix}`;
    if (fs.existsSync(sidecar)) fs.unlinkSync(sidecar);
  }
  if (quickCheck !== "ok") {
    fs.unlinkSync(staging);
    throw new Error(`meeting ledger backup failed integrity check: ${quickCheck}`);
  }
  const latest = path.join(dir, "latest.sqlite");
  fs.renameSync(staging, latest);
  const date = now.toISOString().slice(0, 10);
  const month = date.slice(0, 7);
  const daily = path.join(dir, `daily-${date}.sqlite`);
  const monthly = path.join(dir, `monthly-${month}.sqlite`);
  copyAtomic(latest, daily);
  copyAtomic(latest, monthly);
  prune(dir, "daily-", 14);
  prune(dir, "monthly-", 12);
  return { latest, daily, monthly, quick_check: quickCheck, size_bytes: fs.statSync(latest).size };
}

export function restoreMeetingLedgerBackup(input: { backupPath: string; targetPath: string }): void {
  const source = path.resolve(input.backupPath);
  if (!fs.existsSync(source)) throw new Error(`meeting ledger backup not found: ${source}`);
  const checkDb = new Database(source, { readonly: true, fileMustExist: true });
  try {
    const result = (checkDb.prepare("PRAGMA integrity_check").get() as { integrity_check: string }).integrity_check;
    if (result !== "ok") throw new Error(`backup integrity check failed: ${result}`);
  } finally {
    checkDb.close();
  }
  copyAtomic(source, path.resolve(input.targetPath));
}
