import fs from "fs";
import { NextResponse } from "next/server";
import { openMeetingLedgerRuntime } from "@/lib/loops/meeting-ledger-runtime";
import { restoreProposalFromLedgerEntry } from "@/lib/loops/proposal-mint";
import { appendVerdict, readVerdicts } from "@/lib/loops/stores";
import type { VerdictRecord } from "@/lib/loops/types";
import { proposalPath } from "@/lib/tasks/store";
import {
  errorMessage,
  findEnabledLoop,
  isRecord,
  loadLoopRegistryContext,
  loopStoreHome,
  makeRecordId,
} from "../../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Restore is a recovery action, not another public verdict. The proposal file reappears
 * immediately; the append-only restore record reopens the ledger on its next loop run. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ itemId: string }> },
) {
  try {
    const body: unknown = await request.json().catch(() => ({}));
    if (!isRecord(body)) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    const loopId = typeof body.loop === "string" ? body.loop.trim() : "";
    if (!loopId) return NextResponse.json({ error: "loop is required" }, { status: 400 });
    const { itemId } = await params;

    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) {
      return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    }
    const loop = findEnabledLoop(registry, loopId);
    if (!loop) return NextResponse.json({ error: "Enabled loop not found" }, { status: 404 });
    if (loop.proposal_sink !== "vault") {
      return NextResponse.json({ error: "Only vault-backed proposals can be restored" }, { status: 409 });
    }

    const home = loopStoreHome(vaultPath, loop);
    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: home });
    const entry = (() => {
      try {
        return ledger.getEntry(itemId);
      } finally {
        ledger.close();
      }
    })();
    if (!entry) return NextResponse.json({ error: "Dismissed item not found" }, { status: 404 });
    if (!entry.task_id) {
      return NextResponse.json({ error: "Dismissed item has no recoverable proposal identity" }, { status: 409 });
    }

    const decisions = readVerdicts(home).filter((record) => record.item_id === itemId);
    const latest = decisions.at(-1)?.verdict;
    const ledgerDismissed = entry.status === "dropped" && entry.verdict?.verdict === "dismiss";
    const pendingDismiss = latest === "dismiss";
    if (latest !== "restore" && !ledgerDismissed && !pendingDismiss) {
      return NextResponse.json({ error: "Item is not currently dismissed" }, { status: 409 });
    }

    const restoredAt = new Date().toISOString();
    const restored = restoreProposalFromLedgerEntry(entry, { vaultPath, loopId, now: restoredAt });
    if (latest === "restore") {
      return NextResponse.json({ task: restored.task, already_restored: true, file_effect: restored.created ? "repaired" : "already-restored" });
    }

    const record: VerdictRecord = {
      id: makeRecordId("v"),
      author: "justin",
      created_at: restoredAt,
      loop: loopId,
      item_id: itemId,
      verdict: "restore",
    };
    try {
      appendVerdict(home, record);
    } catch (error) {
      // Do not leave a proposal the durable ledger will still suppress.
      if (restored.created) fs.unlinkSync(proposalPath(vaultPath, restored.task.id));
      throw error;
    }

    return NextResponse.json({ ...record, task: restored.task, file_effect: restored.created ? "restored" : "already-restored" }, { status: 201 });
  } catch (error) {
    const detail = errorMessage(error);
    const status = /already exists|collision/.test(detail) ? 409 : 500;
    console.error("[loops/dismissed/restore] failed:", error);
    return NextResponse.json({ error: status === 409 ? detail : "Failed to restore dismissed proposal", detail }, { status });
  }
}
