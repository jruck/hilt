import { NextRequest, NextResponse } from "next/server";
import { readLocalSystemSyncConflicts, readSystemSyncConflicts } from "@/lib/system/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const folder = request.nextUrl.searchParams.get("folder") || "work-meta";
  const scope = request.nextUrl.searchParams.get("scope");
  const force = request.nextUrl.searchParams.get("force") === "true";

  try {
    if (scope === "local") {
      return NextResponse.json(await readLocalSystemSyncConflicts(folder, { force }));
    }

    return NextResponse.json(await readSystemSyncConflicts(folder, { includePeers: scope !== "local", force }));
  } catch (error) {
    console.error("[system/sync/conflicts] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system sync conflicts" },
      { status: 500 },
    );
  }
}
