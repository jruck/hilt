import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { markLibraryArtifactsRead } from "@/lib/library/read-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { ids?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : typeof body.ids === "string"
        ? [body.ids]
        : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids must include at least one artifact id" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    return NextResponse.json(markLibraryArtifactsRead(vaultPath, ids));
  } catch (error) {
    console.error("[library/read] mark failed:", error);
    return NextResponse.json({ error: "Failed to mark library artifacts read" }, { status: 500 });
  }
}
