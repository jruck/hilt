import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { readDeadLetters } from "@/lib/library/dead-letter";
import { readSourceState } from "@/lib/library/source-config";
import { listLibrarySources } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json({
      sources: listLibrarySources(vaultPath),
      state: readSourceState(vaultPath),
      dead_letters: readDeadLetters(vaultPath).slice(-50),
    });
  } catch (error) {
    console.error("[sources/status] failed:", error);
    return NextResponse.json({ error: "Failed to read source status" }, { status: 500 });
  }
}

