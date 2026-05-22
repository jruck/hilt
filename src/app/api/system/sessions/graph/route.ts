import { NextRequest, NextResponse } from "next/server";
import { graphQuerySchema } from "@/lib/map/local-contracts";
import { buildSystemSessionGraph } from "@/lib/system/map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const parsed = graphQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    return NextResponse.json(await buildSystemSessionGraph(parsed.data));
  } catch (error) {
    console.error("[system/sessions/graph] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to build system session graph" },
      { status: 500 },
    );
  }
}
