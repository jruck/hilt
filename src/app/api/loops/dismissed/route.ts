import { NextRequest, NextResponse } from "next/server";
import type { LedgerEntry } from "@/lib/loops/meeting-ledger";
import { openMeetingLedgerRuntime } from "@/lib/loops/meeting-ledger-runtime";
import { readVerdicts } from "@/lib/loops/stores";
import {
  errorMessage,
  findEnabledLoop,
  loadLoopRegistryContext,
  loopStoreHome,
} from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Default recall window, matching the extractor's dismissed-immunity horizon (A7). */
const DEFAULT_WINDOW_DAYS = 30;

/** One dismissed record — deliberately NOT a TaskFile: the proposal file is gone (dismiss
 * deletes it); the loop's LEDGER is the memory this route surfaces. */
export interface DismissedLoopItem {
  id: string;
  action: string;
  dismissed_at: string;
  opened_from: string;
  task_id?: string;
  note?: string;
}

/** When the dismissal landed: the drop transition's timestamp (transition() appends it),
 * falling back to the verdict stamp for entries whose history is missing the drop line. */
function dismissedAt(entry: LedgerEntry): string | null {
  const dropped = [...entry.status_history].reverse().find((h) => h.to === "dropped");
  return dropped?.at ?? entry.verdict?.at ?? null;
}

/**
 * GET /api/loops/dismissed?loop=<id>&days=<n> — dismissed-but-never-gone (gate-B feedback):
 * ledger entries dropped via a DISMISS verdict within the window, newest first. Closure drops
 * (extractor-evidenced, no verdict) are excluded — same distinction as dismissed-immunity:
 * this is the record of JUSTIN's declines. The ledger home resolves through the registry
 * exactly like the escalations route (live → vault, shadow → sandbox).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const loopId = (searchParams.get("loop") ?? "").trim();
    if (!loopId) return NextResponse.json({ error: "loop is required" }, { status: 400 });

    const daysRaw = searchParams.get("days");
    const days = daysRaw === null ? DEFAULT_WINDOW_DAYS : Number(daysRaw);
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: "days must be a positive number" }, { status: 400 });
    }

    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) {
      return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    }
    const loop = findEnabledLoop(registry, loopId);
    if (!loop) {
      return NextResponse.json({ error: "Enabled loop not found" }, { status: 404 });
    }

    const home = loopStoreHome(vaultPath, loop);
    let dismissed: LedgerEntry[];
    try {
      const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: home });
      try {
        dismissed = ledger.recentlyDismissed(new Date().toISOString(), days);
      } finally {
        ledger.close();
      }
    } catch (err) {
      console.warn("[loops/dismissed] ledger unreadable — returning empty:", errorMessage(err));
      return NextResponse.json({ loop: loopId, days, items: [] });
    }
    const latestAction = new Map<string, ReturnType<typeof readVerdicts>[number]["verdict"]>();
    try {
      for (const record of readVerdicts(home)) {
        latestAction.set(record.item_id, record.verdict);
      }
    } catch (err) {
      // Keep the read-only history available from ledger truth; a malformed decision log must
      // not blank every dismissal row. The owning loop still fails loud on its write path.
      console.warn("[loops/dismissed] verdict log unreadable — ignoring restore overlay:", errorMessage(err));
    }
    const items: DismissedLoopItem[] = dismissed
      // A restore is immediately authoritative for the read surface, even before the nightly
      // loop consumes the record and reopens the ledger entry.
      .filter((entry) => latestAction.get(entry.id) !== "restore")
      .map((entry) => ({ entry, at: dismissedAt(entry) }))
      .filter((x): x is { entry: LedgerEntry; at: string } => x.at !== null)
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map(({ entry, at }) => ({
        id: entry.id,
        action: entry.action,
        dismissed_at: at,
        opened_from: entry.opened_from,
        ...(entry.task_id ? { task_id: entry.task_id } : {}),
        ...(entry.verdict?.note ? { note: entry.verdict.note } : {}),
      }));

    return NextResponse.json({ loop: loopId, days, items });
  } catch (error) {
    console.error("[loops/dismissed] failed:", error);
    return NextResponse.json(
      { error: "Failed to read dismissed items", detail: errorMessage(error) },
      { status: 500 },
    );
  }
}
