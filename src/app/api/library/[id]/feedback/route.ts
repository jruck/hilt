import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { addLibraryComment, editLibraryComment, deleteLibraryComment } from "@/lib/library/library";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Post a new comment.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const body = await request.json().catch(() => ({}));
    const comment = addLibraryComment(vaultPath, id, typeof body.text === "string" ? body.text : "");
    return NextResponse.json({ comment });
  } catch (error) {
    console.error("[library] add comment failed:", error);
    return NextResponse.json({ error: "Failed to add comment" }, { status: 500 });
  }
}

// Edit an existing comment.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const body = await request.json().catch(() => ({}));
    if (typeof body.commentId !== "string") return NextResponse.json({ error: "commentId required" }, { status: 400 });
    const comment = editLibraryComment(vaultPath, id, body.commentId, typeof body.text === "string" ? body.text : "");
    return NextResponse.json({ comment });
  } catch (error) {
    console.error("[library] edit comment failed:", error);
    return NextResponse.json({ error: "Failed to edit comment" }, { status: 500 });
  }
}

// Delete a comment.
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const vaultPath = await getVaultPath();
    const body = await request.json().catch(() => ({}));
    if (typeof body.commentId !== "string") return NextResponse.json({ error: "commentId required" }, { status: 400 });
    return NextResponse.json(deleteLibraryComment(vaultPath, id, body.commentId));
  } catch (error) {
    console.error("[library] delete comment failed:", error);
    return NextResponse.json({ error: "Failed to delete comment" }, { status: 500 });
  }
}
