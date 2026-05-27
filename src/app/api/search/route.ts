import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { searchLibrary } from "@/lib/library/search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const started = Date.now();
    const query = request.nextUrl.searchParams.get("q") || "";
    const limit = Number(request.nextUrl.searchParams.get("limit") || 20);
    const vaultPath = await getVaultPath();
    const results = searchLibrary(vaultPath, query).slice(0, limit);
    return NextResponse.json({
      results,
      query,
      elapsed_ms: Date.now() - started,
      mode: "file-native-v0",
    });
  } catch (error) {
    console.error("[search] failed:", error);
    return NextResponse.json({ error: "Failed to search" }, { status: 500 });
  }
}

