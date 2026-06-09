import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { listLibraryFeedback, markLibraryCommentsProcessed } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const includeProcessed = request.nextUrl.searchParams.get("includeProcessed") === "true";
    return NextResponse.json({ items: listLibraryFeedback(vaultPath, { includeProcessed }) });
  } catch (error) {
    console.error("[library] list feedback failed:", error);
    return NextResponse.json({ error: "Failed to list feedback" }, { status: 500 });
  }
}

// Mark comments processed (used by /process-library-feedback after acting).
// Body: { refs: [{ id, commentIds? }] }  — omit commentIds to mark all of an item's comments.
export async function POST(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const body = await request.json().catch(() => ({}));
    const refs = Array.isArray(body.refs)
      ? body.refs.filter((ref: unknown): ref is { id: string; commentIds?: string[] } => Boolean(ref && typeof (ref as { id?: unknown }).id === "string"))
      : Array.isArray(body.ids)
        ? body.ids.filter((value: unknown): value is string => typeof value === "string").map((id: string) => ({ id }))
        : [];
    return NextResponse.json(markLibraryCommentsProcessed(vaultPath, refs));
  } catch (error) {
    console.error("[library] mark comments processed failed:", error);
    return NextResponse.json({ error: "Failed to mark processed" }, { status: 500 });
  }
}
