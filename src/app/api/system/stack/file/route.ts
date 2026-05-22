import { NextRequest, NextResponse } from "next/server";
import { readLocalSystemStackFile, readSystemStackFile } from "@/lib/system/stack";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const filePath = request.nextUrl.searchParams.get("path");
  const projectPath = request.nextUrl.searchParams.get("project");
  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  try {
    if (request.nextUrl.searchParams.get("scope") === "local") {
      const file = await readLocalSystemStackFile(filePath, projectPath, true);
      if (!file) return NextResponse.json({ error: "File is not part of the discovered stack" }, { status: 404 });
      return NextResponse.json({ file });
    }

    const machineId = request.nextUrl.searchParams.get("machine");
    if (!machineId) {
      return NextResponse.json({ error: "machine parameter required" }, { status: 400 });
    }

    const file = await readSystemStackFile(machineId, filePath, projectPath);
    if (!file) return NextResponse.json({ error: "File is not part of the discovered stack" }, { status: 404 });
    return NextResponse.json({ file });
  } catch (error) {
    console.error("[system/stack/file] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to read system stack file" },
      { status: 500 },
    );
  }
}
