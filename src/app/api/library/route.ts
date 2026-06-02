import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listLibraryArtifactDetails, summarizeArtifact } from "@/lib/library/library";
import type { LibraryLifecycleStatus, LibraryModeFilter } from "@/lib/library/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const params = request.nextUrl.searchParams;
    const offset = Number(params.get("offset") || 0);
    const limit = Number(params.get("limit") || 50);
    const includeCandidates = params.get("includeCandidates") !== "false";
    const status = params.get("status") as LibraryLifecycleStatus | "all" | null;
    const { artifacts, total, unread_total } = listLibraryArtifactDetails(vaultPath, {
      source: params.get("source"),
      channel: params.get("channel"),
      tag: params.get("tag"),
      mode: params.get("mode") as LibraryModeFilter | null,
      status,
      unread: params.get("unread") === "true",
      q: params.get("q"),
      after: params.get("after"),
      before: params.get("before"),
      offset,
      limit,
      includeCandidates,
    });
    return NextResponse.json({
      artifacts: artifacts.map(summarizeArtifact),
      total,
      unread_total,
      offset,
      limit,
    });
  } catch (error) {
    console.error("[library] list failed:", error);
    return NextResponse.json({ error: "Failed to list library artifacts" }, { status: 500 });
  }
}
