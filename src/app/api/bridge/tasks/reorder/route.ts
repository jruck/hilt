import { NextRequest, NextResponse } from "next/server";
import { reorderTasks } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function PUT(request: NextRequest) {
  try {
    const { order, groupUpdates, week } = await request.json();

    if (!Array.isArray(order)) {
      return NextResponse.json({ error: "order must be an array" }, { status: 400 });
    }
    if (week !== undefined && (typeof week !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(week))) {
      return NextResponse.json({ error: "week must be YYYY-MM-DD" }, { status: 400 });
    }

    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    const requestedFilename = week ? `${week}.md` : null;
    const filename = requestedFilename ?? mdFiles[0];
    if (requestedFilename && !mdFiles.includes(requestedFilename)) {
      return NextResponse.json({ error: "Requested weekly list not found" }, { status: 404 });
    }

    const content = await readVaultFile(`lists/now/${filename}`);
    const updated = reorderTasks(content, order, groupUpdates);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/tasks/reorder] Error:", err);
    const message = err instanceof Error ? err.message : "Failed to reorder tasks";
    const status = message.startsWith("Reorder payload") ? 400 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
