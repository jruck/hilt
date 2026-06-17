import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { resolveBriefingNativeLinkTarget } from "@/lib/bridge/briefing-link-targets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const href = request.nextUrl.searchParams.get("href");
    if (!href) {
      return NextResponse.json({ error: "Missing href" }, { status: 400 });
    }
    const vaultPath = await getVaultPath();
    const target = resolveBriefingNativeLinkTarget(
      vaultPath,
      href,
      request.nextUrl.searchParams.get("date"),
    );
    if (!target) {
      return NextResponse.json({ target: null });
    }
    return NextResponse.json({ target });
  } catch (error) {
    console.error("[briefings] failed to resolve link target:", error);
    return NextResponse.json({ error: "Failed to resolve link target" }, { status: 500 });
  }
}
