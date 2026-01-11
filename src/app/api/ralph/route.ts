import { NextResponse } from "next/server";
import { checkRalphPlugin } from "@/lib/ralph-server";
import { RALPH_INSTALL_COMMAND } from "@/lib/ralph";

/**
 * GET /api/ralph
 * Check Ralph Wiggum plugin installation status
 */
export async function GET() {
  try {
    const status = checkRalphPlugin();

    return NextResponse.json({
      ...status,
      installCommand: RALPH_INSTALL_COMMAND,
    });
  } catch (error) {
    console.error("Error checking Ralph plugin:", error);
    return NextResponse.json(
      { error: "Failed to check plugin status" },
      { status: 500 }
    );
  }
}
