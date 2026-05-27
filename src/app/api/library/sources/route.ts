import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listLibrarySources } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json({ sources: listLibrarySources(vaultPath) });
  } catch (error) {
    console.error("[library/sources] failed:", error);
    return NextResponse.json({ error: "Failed to list library sources" }, { status: 500 });
  }
}

