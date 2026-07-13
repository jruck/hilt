import { NextRequest, NextResponse } from "next/server";
import type { LedgerStatus } from "@/lib/loops/meeting-ledger";
import { openMeetingLedgerRuntime } from "@/lib/loops/meeting-ledger-runtime";
import { ledgerSurfaceState, type LedgerSurfaceState } from "@/lib/loops/meeting-ledger-store";
import { errorMessage, findEnabledLoop, loadLoopRegistryContext, loopStoreHome } from "../_shared";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATUSES = new Set<LedgerStatus>(["open", "carried", "resolved", "dropped"]);
const SURFACES = new Set<LedgerSurfaceState>(["pending", "accepted", "latent", "observed", "dismissed", "resolved"]);

function lastSeen(entry: { opened_at: string; sightings: Array<{ at: string }> }): string {
  return entry.sightings.reduce((latest, sighting) => sighting.at > latest ? sighting.at : latest, entry.opened_at);
}

/** Cursor-paginated, filterable operational ledger. No request hydrates the lifetime dataset. */
export async function GET(request: NextRequest) {
  try {
    const { vaultPath, registry, error } = await loadLoopRegistryContext();
    if (!registry) return NextResponse.json({ error: "Loop registry unavailable", detail: error }, { status: 404 });
    const loop = findEnabledLoop(registry, "meeting-actions");
    if (!loop) return NextResponse.json({ error: "Enabled meeting-actions loop not found" }, { status: 404 });
    const params = new URL(request.url).searchParams;
    const statusRaw = params.get("status");
    const surfaceRaw = params.get("surface");
    if (statusRaw && !STATUSES.has(statusRaw as LedgerStatus)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    if (surfaceRaw && !SURFACES.has(surfaceRaw as LedgerSurfaceState)) return NextResponse.json({ error: "Invalid surface" }, { status: 400 });
    const requestedLimit = Number(params.get("limit") || 50);
    if (!Number.isFinite(requestedLimit) || requestedLimit <= 0) return NextResponse.json({ error: "Invalid limit" }, { status: 400 });

    const ledger = openMeetingLedgerRuntime({ vaultPath, legacyHome: loopStoreHome(vaultPath, loop) });
    try {
      const page = ledger.list({
        ...(statusRaw ? { status: statusRaw as LedgerStatus } : {}),
        ...(surfaceRaw ? { surface: surfaceRaw as LedgerSurfaceState } : {}),
        ...(params.get("owner") ? { owner: params.get("owner")! } : {}),
        ...(params.get("meeting") ? { meeting: params.get("meeting")! } : {}),
        ...(params.get("date_from") ? { dateFrom: params.get("date_from")! } : {}),
        ...(params.get("date_to") ? { dateTo: params.get("date_to")! } : {}),
        ...(params.get("q") ? { query: params.get("q")! } : {}),
        ...(params.get("cursor") ? { cursor: params.get("cursor")! } : {}),
        limit: Math.min(100, requestedLimit),
      });
      return NextResponse.json({
        storage: ledger.mode,
        items: page.items.map((entry) => ({ ...entry, surface: ledgerSurfaceState(entry), last_seen_at: lastSeen(entry) })),
        total: page.total,
        next_cursor: page.next_cursor,
        facets: page.facets,
      });
    } finally {
      ledger.close();
    }
  } catch (error) {
    console.error("[loops/meeting-ledger] failed:", error);
    return NextResponse.json({ error: "Failed to read meeting ledger", detail: errorMessage(error) }, { status: 500 });
  }
}
