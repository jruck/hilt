import fs from "fs";
import os from "os";
import path from "path";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Serves docs/HOW-IT-WORKS.md — the canonical in-app reference for the loops/briefing
 * architecture — with its `open://$VAULT|$DATA|$HILT` link placeholders expanded to this
 * machine's real paths so the renderer can open them in the Docs view.
 */
export async function GET() {
  try {
    const repo = process.env.HILT_REPO_PATH || process.cwd();
    const docPath = path.join(repo, "docs", "HOW-IT-WORKS.md");
    const vault = process.env.BRIDGE_VAULT_PATH || process.env.HILT_WORKING_FOLDER || "/Users/jruck/work/bridge";
    const dataDir = process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data");

    // Expand tokens EVERYWHERE (hrefs and visible text alike): the doc shows full real paths
    // as link text by request — "where does this actually live" must be answerable on sight.
    const content = fs.readFileSync(docPath, "utf-8")
      .replaceAll("$VAULT", vault)
      .replaceAll("$DATA", dataDir)
      .replaceAll("$HILT", repo);

    return NextResponse.json({
      content,
      updated_at: fs.statSync(docPath).mtime.toISOString(),
      doc_path: docPath,
    });
  } catch (error) {
    console.error("[how-it-works] failed to read doc:", error);
    return NextResponse.json({ error: "Failed to read HOW-IT-WORKS.md" }, { status: 500 });
  }
}
