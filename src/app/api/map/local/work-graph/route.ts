import { NextRequest, NextResponse } from "next/server";
import { graphQuerySchema, graphResponseSchema } from "@/lib/map/local-contracts";
import { isLocalMapEnabled } from "@/lib/map/local-config";
import { ensureMapIndexFresh } from "@/lib/map/local-indexer";
import { buildIndexedWorkGraph } from "@/lib/map/local-query";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isLocalMapEnabled()) {
    return NextResponse.json({
      disabled: true,
      error: "Hilt Map local indexing is disabled. Set HILT_MAP_LOCAL_ENABLED=true to enable it.",
    }, { status: 403 });
  }

  const parsed = graphQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    await ensureMapIndexFresh(15_000);
    const graph = graphResponseSchema.parse(buildIndexedWorkGraph(parsed.data));
    return NextResponse.json(graph);
  } catch (error) {
    console.error("[map/local/work-graph] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build local work graph" },
      { status: 500 },
    );
  }
}
