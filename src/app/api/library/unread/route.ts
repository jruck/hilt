import { NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { hasUnreadLibraryArtifacts } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    return NextResponse.json({ has_unread: hasUnreadLibraryArtifacts(vaultPath) });
  } catch (error) {
    console.error("[library] unread check failed:", error);
    return NextResponse.json({ error: "Failed to read library unread state" }, { status: 500 });
  }
}
