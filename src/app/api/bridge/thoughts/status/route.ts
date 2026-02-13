import { NextRequest, NextResponse } from "next/server";
import { updateThoughtStatus } from "@/lib/bridge/thought-parser";
import type { BridgeThoughtStatus } from "@/lib/types";

const VALID_STATUSES = new Set(["next", "later"]);

export async function PUT(request: NextRequest) {
  try {
    const { thoughtPath, status } = await request.json();

    if (!thoughtPath || typeof thoughtPath !== "string") {
      return NextResponse.json({ error: "thoughtPath required" }, { status: 400 });
    }
    if (!status || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    updateThoughtStatus(thoughtPath, status as BridgeThoughtStatus);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bridge/thoughts/status] Error:", err);
    return NextResponse.json({ error: "Failed to update thought status" }, { status: 500 });
  }
}
