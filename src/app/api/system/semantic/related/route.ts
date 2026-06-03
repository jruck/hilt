import { NextRequest, NextResponse } from "next/server";
import { isSemanticEnabled } from "@/lib/semantic/config";
import { relatedToItem } from "@/lib/semantic/query";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/system/semantic/related?item=<itemId>&k=N — items semantically related to an
 * item via embedding KNN (chunk-grain, rolled up to items by MAX cosine — ruling R5/R8).
 * Thin wrapper over query.ts; the JSON matches the CLI `related` `--json` shape (a
 * RelatedHit[]). 404 when the flag is off; 400 when `item` is missing.
 */
export async function GET(request: NextRequest) {
  if (!isSemanticEnabled()) {
    return NextResponse.json({ error: "Semantic layer disabled" }, { status: 404 });
  }
  const search = request.nextUrl.searchParams;
  const item = search.get("item");
  if (!item) {
    return NextResponse.json({ error: "Missing item parameter" }, { status: 400 });
  }
  const k = clampInt(search.get("k"), 10, 1, 100);
  return NextResponse.json(relatedToItem(item, k));
}

function clampInt(raw: string | null, fallback: number, min: number, max: number): number {
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(n)));
}
