import { NextResponse } from "next/server";
import { openMeetingLedgerRuntime } from "@/lib/loops/meeting-ledger-runtime";
import { ledgerSurfaceState } from "@/lib/loops/meeting-ledger-store";
import { readProposal } from "@/lib/tasks/proposals";
import { readTask } from "@/lib/tasks/store";
import { errorMessage, findEnabledLoop, loadLoopRegistryContext, loopStoreHome } from "../../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    const loop = findEnabledLoop(registry, "meeting-actions");
    if (!loop) return NextResponse.json({ error: "Enabled meeting-actions loop not found" }, { status: 404 });
    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: loopStoreHome(vaultPath, loop) });
    try {
      const entry = ledger.getEntry(id);
      if (!entry) return NextResponse.json({ error: "Ledger entry not found" }, { status: 404 });
      const task = entry.task_id ? (readProposal(vaultPath, entry.task_id) || readTask(vaultPath, entry.task_id)) : null;
      const summary = ledger.meetingSummary(entry.opened_from);
      return NextResponse.json({
        storage: ledger.mode,
        entry: { ...entry, surface: ledgerSurfaceState(entry) },
        meeting_summary: summary,
        task,
        events: ledger.eventsForEntry(id),
      });
    } finally {
      ledger.close();
    }
  } catch (error) {
    console.error("[loops/meeting-ledger/id] failed:", error);
    return NextResponse.json({ error: "Failed to read ledger entry", detail: errorMessage(error) }, { status: 500 });
  }
}
