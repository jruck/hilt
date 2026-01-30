import { NextRequest, NextResponse } from "next/server";
import { updateNotes } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function PUT(request: NextRequest) {
  try {
    const { notes } = await request.json();

    if (typeof notes !== "string") {
      return NextResponse.json({ error: "notes must be a string" }, { status: 400 });
    }

    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    const filename = mdFiles[0];
    const content = await readVaultFile(`lists/now/${filename}`);
    const updated = updateNotes(content, notes);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/notes] Error:", err);
    return NextResponse.json({ error: "Failed to update notes" }, { status: 500 });
  }
}
