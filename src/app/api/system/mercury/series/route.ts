import { NextRequest, NextResponse } from "next/server";
import { fetchMercuryJson, isMercuryRange } from "@/lib/system/mercury";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Proxy to Mercury's GET /api/series?range=… (avoids CORS; host stays server-side).
export async function GET(request: NextRequest) {
  const range = request.nextUrl.searchParams.get("range") ?? "24h";
  if (!isMercuryRange(range)) {
    return NextResponse.json({ error: "Invalid range (use 6h|24h|7d|all)" }, { status: 400 });
  }
  try {
    const data = await fetchMercuryJson(`/api/series?range=${encodeURIComponent(range)}`);
    return NextResponse.json(data);
  } catch (error) {
    console.error("[mercury] series proxy failed", error);
    return NextResponse.json({ error: "Mercury dashboard unreachable" }, { status: 502 });
  }
}
