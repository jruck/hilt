import { NextRequest, NextResponse } from "next/server";
import { updateProjectStatus } from "@/lib/bridge/project-parser";
import type { BridgeProjectStatus } from "@/lib/types";

const VALID_STATUSES = new Set(["considering", "refining", "doing", "done"]);

export async function PUT(request: NextRequest) {
  try {
    const { projectPath, status } = await request.json();

    if (!projectPath || typeof projectPath !== "string") {
      return NextResponse.json({ error: "projectPath required" }, { status: 400 });
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    updateProjectStatus(projectPath, status as BridgeProjectStatus);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bridge/projects/status] Error:", err);
    return NextResponse.json({ error: "Failed to update project status" }, { status: 500 });
  }
}
