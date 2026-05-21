import { NextRequest, NextResponse } from "next/server";
import { getVaultPath } from "@/lib/bridge/vault";
import { promoteSuggestedMeeting } from "@/lib/bridge/people-parser";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const type = body.type === "person" ? "person" : "group";
    const description = typeof body.description === "string" ? body.description : "";

    if (!name) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    const person = promoteSuggestedMeeting(vaultPath, { name, type, description });

    return NextResponse.json({ person, slug: person.slug });
  } catch (err) {
    console.error("[bridge/people/suggestions/promote] Error:", err);
    return NextResponse.json(
      { error: "Failed to accept suggestion" },
      { status: 500 },
    );
  }
}
