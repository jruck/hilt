import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { openMeetingLedgerRuntime } from "@/lib/loops/meeting-ledger-runtime";
import {
  MEETING_LEDGER_SCHEMA_VERSION,
  MeetingLedgerStore,
  meetingLedgerDbPath,
  meetingLedgerRoot,
  readMeetingLedgerStorageMarker,
  type MeetingExtractionQueueHealth,
} from "@/lib/loops/meeting-ledger-store";
import { errorMessage, findEnabledLoop, loadLoopRegistryContext, loopStoreHome } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_EXTRACTION_QUEUE: MeetingExtractionQueueHealth = {
  depth: 0,
  queued: 0,
  running: 0,
  retry_wait: 0,
  failed: 0,
  complete: 0,
  oldest_queued_at: null,
  next_retry_at: null,
  active: [],
  last_error: null,
};

export async function GET() {
  try {
    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    const loop = findEnabledLoop(registry, "meeting-actions");
    if (!loop) return NextResponse.json({ error: "Enabled meeting-actions loop not found" }, { status: 404 });
    const marker = readMeetingLedgerStorageMarker(vaultPath);
    const dbPath = meetingLedgerDbPath(vaultPath);
    if (marker.mode === "sqlite" && !fs.existsSync(dbPath)) {
      return NextResponse.json({ error: "Canonical meeting ledger database is missing", marker, db: dbPath }, { status: 503 });
    }
    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: loopStoreHome(vaultPath, loop) });
    try {
      const context = ledger.identityContext({ now: new Date().toISOString(), tokenBudget: 40_000 });
      const backup = path.join(meetingLedgerRoot(vaultPath), "backups", "latest.sqlite");
      const base = {
        storage: ledger.mode,
        marker,
        counts: ledger.counts(),
        recent_context_tokens: context.estimated_tokens,
        context_chunks: context.chunks.length,
        last_verified_backup: fs.existsSync(backup) ? { path: backup, at: fs.statSync(backup).mtime.toISOString(), size_bytes: fs.statSync(backup).size } : null,
      };
      if (!fs.existsSync(dbPath)) {
        return NextResponse.json({
          ...base,
          db: null,
          integrity: "legacy",
          extraction_queue: EMPTY_EXTRACTION_QUEUE,
        });
      }
      const store = new MeetingLedgerStore(dbPath);
      try {
        return NextResponse.json({
          ...base,
          db: { path: dbPath, size_bytes: fs.statSync(dbPath).size },
          migration_version: Number(store.db.pragma("user_version", { simple: true })),
          supported_migration_version: MEETING_LEDGER_SCHEMA_VERSION,
          integrity: store.quickCheck(),
          write_blocked: store.writeBlockReason(),
          last_transaction: store.latestEvent(),
          last_extraction_transaction: store.latestEvent("meeting-processed"),
          extraction_queue: store.extractionQueueHealth(),
        });
      } finally {
        store.close();
      }
    } finally {
      ledger.close();
    }
  } catch (error) {
    console.error("[loops/meeting-ledger/health] failed:", error);
    return NextResponse.json({ error: "Failed to read meeting ledger health", detail: errorMessage(error) }, { status: 500 });
  }
}
