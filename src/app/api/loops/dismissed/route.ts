import { NextRequest, NextResponse } from "next/server";
import { readLedger, type LedgerEntry } from "@/lib/loops/meeting-ledger";
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

    // Missing ledger → empty store (readLedger's contract). A CORRUPT ledger fails loud there
    // — correct for the loop's WRITE path (never persist a wipe) — but this is a read-only
    // display surface: degrade to an empty list + warn instead of a 500 (the dismissed tail
    // simply shows nothing until the ledger is repaired).
    let ledger: ReturnType<typeof readLedger>;
    try {
      ledger = readLedger(loopStoreHome(vaultPath, loop));
    } catch (err) {
      console.warn("[loops/dismissed] ledger unreadable — returning empty:", errorMessage(err));
      return NextResponse.json({ loop: loopId, days, items: [] });
    }
    const now = Date.now();
    const items: DismissedLoopItem[] = Object.values(ledger.entries ?? {})
      .filter((entry) => entry.status === "dropped" && entry.verdict?.verdict === "dismiss")
      .map((entry) => ({ entry, at: dismissedAt(entry) }))
      .filter((x): x is { entry: LedgerEntry; at: string } =>
        x.at !== null && (now - Date.parse(x.at)) / 86_400_000 <= days,
      )
      .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
      .map(({ entry, at }) => ({
        id: entry.id,
        action: entry.action,
        dismissed_at: at,
        opened_from: entry.opened_from,
        ...(entry.task_id ? { task_id: entry.task_id } : {}),
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
