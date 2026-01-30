import { NextRequest, NextResponse } from "next/server";
import { reorderTasks } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function PUT(request: NextRequest) {
  try {
    const { order } = await request.json();

    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }

    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    const filename = mdFiles[0];
    const content = await readVaultFile(`lists/now/${filename}`);
    const updated = reorderTasks(content, order);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/tasks/reorder] Error:", err);
    return NextResponse.json({ error: "Failed to reorder tasks" }, { status: 500 });
  }
}
