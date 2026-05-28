import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listLibrarySources } from "@/lib/library/library";
import type { LibraryLifecycleStatus } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const params = request.nextUrl.searchParams;
    const status = params.get("status") as LibraryLifecycleStatus | "all" | null;
    return NextResponse.json({
      sources: listLibrarySources(vaultPath, {
        channel: params.get("channel"),
        tag: params.get("tag"),
        status,
        q: params.get("q"),
      }),
    });
  } catch (error) {
    console.error("[library/sources] failed:", error);
    return NextResponse.json({ error: "Failed to list library sources" }, { status: 500 });
  }
}
