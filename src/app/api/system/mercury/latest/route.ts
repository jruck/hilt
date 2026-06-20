import { NextResponse } from "next/server";
import { fetchMercuryJson } from "@/lib/system/mercury";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Proxy to Mercury's GET /api/latest → { sample, ageSeconds }.
export async function GET() {
  try {
    const data = await fetchMercuryJson("/api/latest");
    return NextResponse.json(data);
  } catch (error) {
    console.error("[mercury] latest proxy failed", error);
    return NextResponse.json({ error: "Mercury dashboard unreachable" }, { status: 502 });
  }
}
