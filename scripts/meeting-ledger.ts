import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { defaultSandboxDir } from "../src/lib/loops/emit";
import { loadRegistry, loopHome } from "../src/lib/loops/registry";
import {
  backupMeetingLedger,
  exportLegacyMeetingState,
  readLegacyMeetingState,
  restoreMeetingLedgerBackup,
  writeReadableMeetingLedgerExport,
} from "../src/lib/loops/meeting-ledger-maintenance";
import {
  acquireMeetingLedgerLock,
  MeetingLedgerStore,
  meetingLedgerDbPath,
  meetingLedgerRoot,
  readMeetingLedgerStorageMarker,
  writeMeetingLedgerStorageMarker,
} from "../src/lib/loops/meeting-ledger-store";

loadEnvConfig(process.cwd());
process.env.DATA_DIR ||= path.join(os.homedir(), ".hilt", "data");

const args = process.argv.slice(2);
const command = args[0] || "audit";
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
const registry = loadRegistry(vaultPath);
const meetingLoop = registry.loops.find((loop) => loop.id === "meeting-actions");
if (!meetingLoop) throw new Error("meeting-actions loop not found");
const legacyHome = path.resolve(
  value("--legacy-home")
  || (meetingLoop.phase === "live" ? loopHome(vaultPath, meetingLoop) : loopHome(defaultSandboxDir(), meetingLoop)),
);
const dbPath = path.resolve(value("--db") || meetingLedgerDbPath(vaultPath, value("--ledger-home")));

function fingerprint(paths: string[]): string {
  const hash = crypto.createHash("sha256");
  for (const filePath of paths) {
    hash.update(filePath);
    if (fs.existsSync(filePath)) hash.update(fs.readFileSync(filePath));
  }
  return hash.digest("hex");
}

function legacyFingerprint(): string {
  return fingerprint([
    path.join(legacyHome, "state", "ledger.json"),
    path.join(legacyHome, "state", "meeting-summaries.json"),
    path.join(legacyHome, "state", "processed-meetings.json"),
  ]);
}

function snapshotLegacyState(at: string): { dir: string; files: Array<{ name: string; sha256: string }> } {
  const stamp = at.replace(/[:.]/g, "-");
  const dir = path.join(meetingLedgerRoot(vaultPath), "pre-migration", stamp);
  fs.mkdirSync(dir, { recursive: true });
  const files = ["ledger.json", "meeting-summaries.json", "processed-meetings.json"].flatMap((name) => {
    const source = path.join(legacyHome, "state", name);
    if (!fs.existsSync(source)) return [];
    const target = path.join(dir, name);
    fs.copyFileSync(source, target, fs.constants.COPYFILE_EXCL);
    return [{ name, sha256: crypto.createHash("sha256").update(fs.readFileSync(target)).digest("hex") }];
  });
  fs.writeFileSync(path.join(dir, "manifest.json"), `${JSON.stringify({ at, legacy_home: legacyHome, files }, null, 2)}\n`, { flag: "wx" });
  return { dir, files };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

function parity(store: MeetingLedgerStore): { ok: boolean; problems: string[] } {
  const legacy = readLegacyMeetingState(legacyHome);
  const sqlite = store.readAll();
  const problems: string[] = [];
  const legacyIds = Object.keys(legacy.ledger.entries).sort();
  const sqliteIds = Object.keys(sqlite.entries).sort();
  if (JSON.stringify(legacyIds) !== JSON.stringify(sqliteIds)) problems.push("ledger id membership differs");
  for (const id of legacyIds) {
    if (!sameValue(legacy.ledger.entries[id], sqlite.entries[id])) problems.push(`entry differs: ${id}`);
  }
  const sqliteSummaries = Object.fromEntries(store.meetingSummaries().map((record) => [record.meeting, { date: record.date, summary: record.summary }]));
  if (!sameValue(legacy.summaries, sqliteSummaries)) problems.push("meeting summaries differ");
  if (!sameValue(legacy.processed, store.processedMeetings())) problems.push("processed meetings differ");
  return { ok: problems.length === 0, problems };
}

async function main(): Promise<void> {
  if (command === "dry-run") {
    const state = readLegacyMeetingState(legacyHome);
    const ids = Object.keys(state.ledger.entries);
    console.log(JSON.stringify({
      ok: true,
      command,
      vault: vaultPath,
      legacy_home: legacyHome,
      target: dbPath,
      entries: ids.length,
      summaries: Object.keys(state.summaries).length,
      processed: Object.keys(state.processed).length,
      fingerprint: legacyFingerprint(),
    }, null, 2));
    return;
  }
  const mutating = new Set(["migrate", "activate", "rollback", "restore"]);
  const lock = mutating.has(command)
    ? await acquireMeetingLedgerLock({ vaultPath, ledgerHomeOverride: value("--ledger-home"), label: `meeting-ledger:${command}` })
    : null;
  try {
    if (command === "restore") {
      const backupPath = value("--from");
      if (!backupPath) throw new Error("restore requires --from <backup.sqlite>");
      restoreMeetingLedgerBackup({ backupPath, targetPath: dbPath });
      console.log(JSON.stringify({ ok: true, restored_from: path.resolve(backupPath), target: dbPath }, null, 2));
      return;
    }
    const store = new MeetingLedgerStore(dbPath);
    try {
    if (command === "migrate") {
      if (readMeetingLedgerStorageMarker(vaultPath).mode === "sqlite") throw new Error("canonical storage is already SQLite; migrate is pre-cutover only");
      const legacy = readLegacyMeetingState(legacyHome);
      const at = new Date().toISOString();
      let migration;
      try {
        migration = store.importLegacy({
          ledger: legacy.ledger,
          summaries: legacy.summaries,
          processed: legacy.processed,
          importedAt: at,
          sourceFingerprint: legacyFingerprint(),
        });
      } catch (error) {
        if (!/different legacy fingerprint/.test(error instanceof Error ? error.message : String(error))) throw error;
        store.resetLegacyProjection();
        migration = store.importLegacy({
          ledger: legacy.ledger,
          summaries: legacy.summaries,
          processed: legacy.processed,
          importedAt: at,
          sourceFingerprint: legacyFingerprint(),
        });
      }
      const compared = parity(store);
      if (!compared.ok) throw new Error(`migration parity failed: ${compared.problems.join("; ")}`);
      const backup = await backupMeetingLedger(store, vaultPath, new Date(at));
      const exportPath = writeReadableMeetingLedgerExport(store, vaultPath, at);
      console.log(JSON.stringify({ ok: true, command, migration, parity: compared, backup, export: exportPath }, null, 2));
      return;
    }
    if (command === "activate") {
      const marker = readMeetingLedgerStorageMarker(vaultPath);
      if (marker.mode === "sqlite") throw new Error("meeting ledger is already activated");
      let compared = parity(store);
      if (!compared.ok) {
        const legacy = readLegacyMeetingState(legacyHome);
        const at = new Date().toISOString();
        store.resetLegacyProjection();
        store.importLegacy({
          ledger: legacy.ledger,
          summaries: legacy.summaries,
          processed: legacy.processed,
          importedAt: at,
          sourceFingerprint: legacyFingerprint(),
        });
        compared = parity(store);
      }
      if (!compared.ok) throw new Error(`cannot activate: ${compared.problems.join("; ")}`);
      if (store.integrityCheck() !== "ok") throw new Error("cannot activate: integrity_check failed");
      const at = new Date().toISOString();
      const recovery = snapshotLegacyState(at);
      const backup = await backupMeetingLedger(store, vaultPath);
      writeMeetingLedgerStorageMarker(vaultPath, {
        version: 1,
        mode: "sqlite",
        migrated_at: at,
        legacy_home: legacyHome,
      });
      console.log(JSON.stringify({ ok: true, marker: readMeetingLedgerStorageMarker(vaultPath), parity: compared, recovery, backup }, null, 2));
      return;
    }
    if (command === "rollback") {
      const at = new Date().toISOString();
      const state = exportLegacyMeetingState(store, legacyHome, at);
      const compared = parity(store);
      if (!compared.ok) throw new Error(`rollback export parity failed: ${compared.problems.join("; ")}`);
      writeMeetingLedgerStorageMarker(vaultPath, {
        version: 1,
        mode: "legacy",
        migrated_at: readMeetingLedgerStorageMarker(vaultPath).migrated_at,
        legacy_home: legacyHome,
      });
      console.log(JSON.stringify({ ok: true, parity: compared, entries: Object.keys(state.ledger.entries).length, legacy_home: legacyHome }, null, 2));
      return;
    }
    if (command === "export") {
      const exportPath = value("--legacy-home")
        ? (exportLegacyMeetingState(store, legacyHome), legacyHome)
        : writeReadableMeetingLedgerExport(store, vaultPath);
      console.log(JSON.stringify({ ok: true, export: exportPath, entries: store.counts().total }, null, 2));
      return;
    }
    if (command === "backup") {
      const integrity = store.integrityCheck();
      if (integrity !== "ok") throw new Error(`cannot clear write block: integrity_check failed: ${integrity}`);
      store.clearWriteBlock();
      try {
        console.log(JSON.stringify({ ok: true, integrity, write_blocked: null, backup: await backupMeetingLedger(store, vaultPath) }, null, 2));
      } catch (error) {
        store.blockWrites(`manual backup failed: ${error instanceof Error ? error.message : String(error)}`);
        throw error;
      }
      return;
    }
    if (command !== "audit") throw new Error(`unknown command: ${command}`);
    const marker = readMeetingLedgerStorageMarker(vaultPath);
    const compared = fs.existsSync(path.join(legacyHome, "state", "ledger.json")) ? parity(store) : null;
    const quickCheck = store.quickCheck();
    const integrityCheck = store.integrityCheck();
    const writeBlocked = store.writeBlockReason();
    const result = {
      ok: quickCheck === "ok" && integrityCheck === "ok" && !writeBlocked && (marker.mode === "sqlite" || !compared || compared.ok),
      command,
      db: dbPath,
      size_bytes: fs.statSync(dbPath).size,
      schema_version: Number(store.db.pragma("user_version", { simple: true })),
      quick_check: quickCheck,
      integrity_check: integrityCheck,
      write_blocked: writeBlocked,
      counts: store.counts(),
      marker,
      parity: compared,
      root: meetingLedgerRoot(vaultPath),
    };
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
    } finally {
      store.close();
    }
  } finally {
    lock?.release();
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
