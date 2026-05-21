import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { hideSuggestedMeeting } from "@/lib/bridge/people-parser";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const count = Number(body.count);
    const lastDate = typeof body.lastDate === "string" ? body.lastDate : "";

    if (!name || !Number.isFinite(count) || count < 1) {
      return NextResponse.json(
        { error: "name and count are required" },
        { status: 400 },
      );
    }

    const vaultPath = await getVaultPath();
    hideSuggestedMeeting(vaultPath, { name, count, lastDate });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[bridge/people/suggestions/hide] Error:", err);
    return NextResponse.json(
      { error: "Failed to hide suggestion" },
      { status: 500 },
    );
  }
}
