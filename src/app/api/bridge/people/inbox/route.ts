import { NextResponse } from "next/server";
import { getAllMeetings } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const result = await getAllMeetings(vaultPath);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bridge/people/inbox] Error:", err);
    return NextResponse.json({ error: "Failed to read meetings" }, { status: 500 });
  }
}
