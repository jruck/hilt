import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { markLibraryArtifactsRead, markLibraryArtifactsUnread } from "@/lib/library/read-state";
import { appendLibraryEvents } from "@/lib/library/events";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as { ids?: unknown; unread?: unknown };
    const ids = Array.isArray(body.ids)
      ? body.ids.filter((id): id is string => typeof id === "string")
      : typeof body.ids === "string"
        ? [body.ids]
        : [];
    if (!ids.length) {
      return NextResponse.json({ error: "ids must include at least one artifact id" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    const result = body.unread === true
      ? markLibraryArtifactsUnread(vaultPath, ids)
      : markLibraryArtifactsRead(vaultPath, ids);
    if (body.unread !== true) {
      appendLibraryEvents(vaultPath, ids.map((id) => ({ type: "read" as const, artifact_id: id })));
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("[library/read] mark failed:", error);
    return NextResponse.json({ error: "Failed to mark library artifacts read" }, { status: 500 });
  }
}
