/**
 * Skills Discovery API
 *
 * GET /api/skills?scope={path}
 * Returns all available skills for a given scope, merging global and project skills
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverSkills } from "@/lib/skill-parser";
import type { SkillsResponse } from "@/lib/types";

export async function GET(request: NextRequest) {
  const scope = request.nextUrl.searchParams.get("scope");

  if (!scope) {
    return NextResponse.json(
      { error: "scope parameter is required" },
      { status: 400 }
    );
  }

  try {
    const skills = await discoverSkills(scope);

    const response: SkillsResponse = {
      skills,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error discovering skills:", error);
    return NextResponse.json(
      { error: "Failed to discover skills" },
      { status: 500 }
    );
  }
}
