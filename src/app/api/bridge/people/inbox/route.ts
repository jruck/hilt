import { NextRequest, NextResponse } from "next/server";
import { getAllMeetings } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET(request: NextRequest) {
  try {
    const vaultPath = await getVaultPath();
    const filterName = request.nextUrl.searchParams.get("name") || undefined;
    const result = await getAllMeetings(vaultPath, filterName);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[bridge/people/inbox] Error:", err);
    return NextResponse.json({ error: "Failed to read meetings" }, { status: 500 });
  }
}
