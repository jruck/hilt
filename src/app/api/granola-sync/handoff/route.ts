import { NextRequest, NextResponse } from "next/server";
import {
  disableObsidianGranolaSync,
  getObsidianHandoffStatus,
  restoreObsidianGranolaSync,
} from "@/lib/granola/handoff";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getObsidianHandoffStatus());
  } catch (error) {
    console.error("[granola-sync/handoff] Error:", error);
    return NextResponse.json({ error: "Failed to inspect Obsidian handoff status" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = body.action === "restore" ? "restore" : "disable";
    const dryRun = body.dryRun !== false;
    const status = action === "restore"
      ? await restoreObsidianGranolaSync({ dryRun })
      : await disableObsidianGranolaSync({ dryRun });
    return NextResponse.json({ action, dryRun, status });
  } catch (error) {
    console.error("[granola-sync/handoff] Error:", error);
    return NextResponse.json({ error: "Failed to update Obsidian handoff" }, { status: 500 });
  }
}
