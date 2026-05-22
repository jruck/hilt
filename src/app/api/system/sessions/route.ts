import { NextRequest, NextResponse } from "next/server";
import { sessionsQuerySchema } from "@/lib/map/local-contracts";
import { querySystemSessionPage } from "@/lib/system/map";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const parsed = sessionsQuerySchema.safeParse(Object.fromEntries(request.nextUrl.searchParams.entries()));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid query parameters", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    return NextResponse.json(await querySystemSessionPage(parsed.data));
  } catch (error) {
    console.error("[system/sessions] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system sessions" },
      { status: 500 },
    );
  }
}
