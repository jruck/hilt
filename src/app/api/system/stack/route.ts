import { NextRequest, NextResponse } from "next/server";
import { readLocalSystemStack, readSystemStacks } from "@/lib/system/stack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const projectPath = request.nextUrl.searchParams.get("project");
    if (request.nextUrl.searchParams.get("scope") === "local") {
      return NextResponse.json(await readLocalSystemStack(projectPath));
    }
    return NextResponse.json(await readSystemStacks(projectPath));
  } catch (error) {
    console.error("[system/stack] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system stack" },
      { status: 500 },
    );
  }
}
