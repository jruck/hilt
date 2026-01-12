/**
 * Skill Content API
 *
 * GET /api/skills/{name}?scope={path}
 * Returns the full content of a skill file for injection into prompts
 */

import { NextRequest, NextResponse } from "next/server";
import { discoverSkills, getSkillContent } from "@/lib/skill-parser";
import type { SkillContentResponse } from "@/lib/types";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name } = await params;
  const scope = request.nextUrl.searchParams.get("scope");

  if (!scope) {
    return NextResponse.json(
      { error: "scope parameter is required" },
      { status: 400 }
    );
  }

  if (!name) {
    return NextResponse.json(
      { error: "skill name is required" },
      { status: 400 }
    );
  }

  try {
    // Find the skill by name
    const skills = await discoverSkills(scope);
    const skill = skills.find((s) => s.name === name);

    if (!skill) {
      return NextResponse.json(
        { error: `Skill '${name}' not found` },
        { status: 404 }
      );
    }

    // Get the full content
    const content = await getSkillContent(skill.path);

    if (content === null) {
      return NextResponse.json(
        { error: `Failed to read skill content for '${name}'` },
        { status: 500 }
      );
    }

    const response: SkillContentResponse = {
      skill,
      content,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error(`Error fetching skill '${name}':`, error);
    return NextResponse.json(
      { error: "Failed to fetch skill content" },
      { status: 500 }
    );
  }
}
