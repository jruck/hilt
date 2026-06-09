import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { buildWorkbenchRows } from "@/lib/library/workbench";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json(buildWorkbenchRows(vaultPath));
  } catch (error) {
    console.error("[library] workbench failed:", error);
    return NextResponse.json({ error: "Failed to build workbench" }, { status: 500 });
  }
}
