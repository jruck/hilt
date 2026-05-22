import { NextRequest, NextResponse } from "next/server";
import { readLocalSystemSync, readSystemSync } from "@/lib/system/sync";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope");
  const force = request.nextUrl.searchParams.get("force") === "true";

  try {
    if (scope === "local") {
      return NextResponse.json(await readLocalSystemSync({ force }));
    }

    return NextResponse.json(await readSystemSync({ includePeers: scope !== "local", force }));
  } catch (error) {
    console.error("[system/sync] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system sync" },
      { status: 500 },
    );
  }
}
