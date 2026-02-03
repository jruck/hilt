import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import { parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, getVaultPath } from "@/lib/bridge/vault";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();

    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    // Available weeks for the dropdown (newest first)
    const availableWeeks = mdFiles.map(f => f.replace(".md", ""));

    // Check for ?week= query param to preview a specific week
    const requestedWeek = request.nextUrl.searchParams.get("week");
    let filename = mdFiles[0]; // default to latest

    if (requestedWeek) {
      const requestedFile = `${requestedWeek}.md`;
      if (mdFiles.includes(requestedFile)) {
        filename = requestedFile;
      }
    }

    const content = await readVaultFile(`lists/now/${filename}`);
    const weekly = parseWeeklyFile(content, filename);

    return NextResponse.json({
      ...weekly,
      vaultPath,
      filePath: path.join(vaultPath, "lists/now", filename),
      availableWeeks,
      latestWeek: availableWeeks[0],
    });
  } catch (err) {
    console.error("[bridge/weekly] Error:", err);
    return NextResponse.json({ error: "Failed to read weekly list" }, { status: 500 });
  }
}
