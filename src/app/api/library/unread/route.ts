import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { hasNewLibraryArtifacts } from "@/lib/library/library";
import { markLibraryVisited } from "@/lib/library/read-state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * The nav-dot signal. `has_new` = items ARRIVED since the user last opened the Library tab — NOT
 * "unread items exist" (which is perma-true under steady ingestion). `has_unread` is kept as an alias
 * for back-compat. POST marks the tab visited (clears the dot).
 */
export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const hasNew = hasNewLibraryArtifacts(vaultPath);
    return NextResponse.json({ has_new: hasNew, has_unread: hasNew });
  } catch (error) {
    console.error("[library] new-since-visit check failed:", error);
    return NextResponse.json({ error: "Failed to read library new-item state" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json(markLibraryVisited(vaultPath));
  } catch (error) {
    console.error("[library] mark-visited failed:", error);
    return NextResponse.json({ error: "Failed to mark library visited" }, { status: 500 });
  }
}
