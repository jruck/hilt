import { NextResponse } from "next/server";
import { getAllAreas } from "@/lib/bridge/area-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const areas = await getAllAreas(vaultPath);
    return NextResponse.json(areas);
  } catch (err) {
    console.error("[bridge/areas] Error:", err);
    return NextResponse.json({ error: "Failed to read areas" }, { status: 500 });
  }
}
