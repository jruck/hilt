import { NextResponse } from "next/server";
import { getAllThoughts } from "@/lib/bridge/thought-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const thoughts = await getAllThoughts(vaultPath);
    return NextResponse.json(thoughts);
  } catch (err) {
    console.error("[bridge/thoughts] Error:", err);
    return NextResponse.json({ error: "Failed to read thoughts" }, { status: 500 });
  }
}
