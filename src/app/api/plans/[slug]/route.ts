import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import os from "os";

const PLANS_DIR = path.join(os.homedir(), ".claude", "plans");

export async function GET(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }

    const planPath = path.join(PLANS_DIR, `${slug}.md`);

    try {
      const content = await fs.readFile(planPath, "utf-8");
      return NextResponse.json({
        exists: true,
        slug,
        content,
        path: planPath
      });
    } catch {
      // Plan file doesn't exist
      return NextResponse.json({
        exists: false,
        slug
      });
    }
  } catch (error) {
    console.error("Error fetching plan:", error);
    return NextResponse.json(
      { error: "Failed to fetch plan" },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { content } = await request.json();

    if (!slug) {
      return NextResponse.json({ error: "Slug is required" }, { status: 400 });
    }

    if (typeof content !== "string") {
      return NextResponse.json({ error: "Content is required" }, { status: 400 });
    }

    const planPath = path.join(PLANS_DIR, `${slug}.md`);

    // Ensure the plans directory exists
    await fs.mkdir(PLANS_DIR, { recursive: true });

    // Write the updated content
    await fs.writeFile(planPath, content, "utf-8");

    return NextResponse.json({
      success: true,
      slug,
      path: planPath
    });
  } catch (error) {
    console.error("Error saving plan:", error);
    return NextResponse.json(
      { error: "Failed to save plan" },
      { status: 500 }
    );
  }
}
