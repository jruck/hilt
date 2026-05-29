import { NextResponse } from "next/server";
import { getGranolaSyncStatus } from "@/lib/granola/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    return NextResponse.json(await getGranolaSyncStatus());
  } catch (error) {
    console.error("[granola-sync/status] Error:", error);
    return NextResponse.json({ error: "Failed to read Granola sync status" }, { status: 500 });
  }
}
