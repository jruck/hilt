import { NextRequest, NextResponse } from "next/server";
import { getPersonDetail, updatePersonMetadata } from "@/lib/bridge/people-parser";
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

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const body = await req.json();
    const vaultPath = await getVaultPath();

    const name = typeof body.name === "string" ? body.name.trim() : undefined;
    const description = typeof body.description === "string" ? body.description : undefined;
    const aliases = Array.isArray(body.aliases)
      ? body.aliases.filter((alias: unknown): alias is string => typeof alias === "string")
      : undefined;

    if (name !== undefined && !name) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    updatePersonMetadata(vaultPath, slug, { name, description, aliases });
    const detail = await getPersonDetail(vaultPath, slug);

    if (!detail) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }

    return NextResponse.json(detail);
  } catch (err) {
    console.error("[bridge/people/slug] Patch error:", err);
    return NextResponse.json({ error: "Failed to update person" }, { status: 500 });
  }
}
