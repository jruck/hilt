import { NextRequest, NextResponse } from "next/server";
import { sessionsQuerySchema, sessionsResponseSchema } from "@/lib/map/local-contracts";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh } from "@/lib/map/local-indexer";
import { queryIndexedSessionPage } from "@/lib/map/local-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalMapEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
    }, { status: 403 });
  }

  const parsed = sessionsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await ensureMapIndexFresh(15_000);
    const result = sessionsResponseSchema.parse(queryIndexedSessionPage(parsed.data));
    return NextResponse.json(result);
  } catch (error) {
    console.error("[map/local/sessions] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read local sessions" },
      { status: 500 },
    );
  }
}
