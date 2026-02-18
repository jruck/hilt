import { NextRequest, NextResponse } from "next/server";
import { getPersonDetail } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const vaultPath = await getVaultPath();
    const detail = await getPersonDetail(vaultPath, slug);

    if (!detail) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error("[bridge/people/slug] Error:", err);
    return NextResponse.json({ error: "Failed to read person detail" }, { status: 500 });
  }
}
