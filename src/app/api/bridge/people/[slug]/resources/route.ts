import { NextRequest, NextResponse } from "next/server";
import { addPersonResource, getPersonDetail, removePersonResource } from "@/lib/bridge/people-parser";
import { getVaultPath } from "@/lib/bridge/vault";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null);
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    const label = typeof body?.label === "string" ? body.label : undefined;

    if (!url) {
      return NextResponse.json({ error: "url is required" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    addPersonResource(vaultPath, slug, { url, label });
    const detail = await getPersonDetail(vaultPath, slug);
    if (!detail) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to add resource";
    const status = message.includes("http(s)") ? 400 : message.includes("Person not found") ? 404 : 500;
    if (status === 500) console.error("[bridge/people/resources] POST error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const { slug } = await params;
    const body = await request.json().catch(() => null);
    const id = typeof body?.id === "string" ? body.id.trim() : "";

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    removePersonResource(vaultPath, slug, id);
    const detail = await getPersonDetail(vaultPath, slug);
    if (!detail) {
      return NextResponse.json({ error: "Person not found" }, { status: 404 });
    }
    return NextResponse.json(detail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to remove resource";
    const status = message.includes("Person not found") ? 404 : 500;
    if (status === 500) console.error("[bridge/people/resources] DELETE error:", error);
    return NextResponse.json({ error: message }, { status });
  }
}
