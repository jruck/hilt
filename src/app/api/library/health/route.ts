import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { getLibraryOperationalHealth } from "@/lib/library/health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json(getLibraryOperationalHealth(vaultPath), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[library/health] failed:", error);
    return NextResponse.json({ error: "Failed to read library health" }, { status: 500 });
  }
}
