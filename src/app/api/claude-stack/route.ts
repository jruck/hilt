import { NextRequest, NextResponse } from "next/server";
import { discoverStack } from "@/lib/claude-config/discovery";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope");

  if (!scope) {
    return NextResponse.json({ error: "scope parameter required" }, { status: 400 });
  }

  try {
    const stack = await discoverStack(scope);
    return NextResponse.json({ stack });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
