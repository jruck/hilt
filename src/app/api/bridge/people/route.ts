import { NextResponse } from "next/server";
import { getAllPeople } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const people = await getAllPeople(vaultPath);
    return NextResponse.json(people);
  } catch (err) {
    console.error("[bridge/people] Error:", err);
    return NextResponse.json({ error: "Failed to read people" }, { status: 500 });
  }
}
