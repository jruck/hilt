import { NextRequest, NextResponse } from "next/server";
import { isSemanticEnabled } from "@/lib/semantic/config";
import { entityByName } from "@/lib/semantic/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/semantic/entity/:name — resolve an entity by canonical name or alias and
 * return it with its top items (the in-API version of the CLI `entity <name>`). Thin wrapper
 * over query.ts; the JSON matches the CLI `--json` shape (an EntityResult). 404 when the flag
 * is off; 404 when no entity matches (mirrors the CLI's "no entity matching" exit).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  if (!isSemanticEnabled()) {
    return NextResponse.json({ error: "Semantic layer disabled" }, { status: 404 });
  }
  const { name } = await params;
  const entity = entityByName(decodeURIComponent(name));
  if (!entity) {
    return NextResponse.json({ error: "Entity not found" }, { status: 404 });
  }
  return NextResponse.json(entity);
}
