import { NextRequest, NextResponse } from "next/server";
import { updateAccomplishments } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function PUT(request: NextRequest) {
  try {
    const { accomplishments, week } = await request.json();

    if (typeof accomplishments !== "string") {
      return NextResponse.json({ error: "accomplishments must be a string" }, { status: 400 });
    }

    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    // If a specific week is provided, update that file; otherwise latest
    const filename = week ? `${week}.md` : mdFiles[0];
    if (!mdFiles.includes(filename)) {
      return NextResponse.json({ error: "Week not found" }, { status: 404 });
    }

    const content = await readVaultFile(`lists/now/${filename}`);
    const updated = updateAccomplishments(content, accomplishments);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/accomplishments] Error:", err);
    return NextResponse.json({ error: "Failed to update accomplishments" }, { status: 500 });
  }
}
