import fs from "fs/promises";
import os from "os";
import path from "path";
import matter from "gray-matter";
import { NextRequest, NextResponse } from "next/server";
import { parseBriefingId } from "@/lib/bridge/briefing-files";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function getDataDir(): string {
  return process.env.DATA_DIR || path.join(os.homedir(), ".hilt", "data");
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "ENOENT";
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id") || "";
    const parsed = parseBriefingId(id);
    if (!parsed) {
      return NextResponse.json({ error: "Invalid briefing id" }, { status: 400 });
    }

    // The shadow tree mirrors the vault layout MINUS the `briefings/` prefix (dailies flat,
    // weekends under weekend/ — see scripts/briefing-generate.ts --shadow).
    const relPath = parsed.relativePath.replace(/^briefings[/\\]/, "");
    const filePath = path.join(getDataDir(), "briefing-shadow", relPath);
    try {
      const [raw, stat] = await Promise.all([
        fs.readFile(filePath, "utf-8"),
        fs.stat(filePath),
      ]);
      const { content } = matter(raw);
      return NextResponse.json({
        exists: true,
        content: content.trim(),
        generated_at: stat.mtime.toISOString(),
      });
    } catch (error) {
      if (isNotFound(error)) {
        return NextResponse.json({
          exists: false,
          content: null,
          generated_at: null,
        });
      }
      throw error;
    }
  } catch (error) {
    console.error("[briefings/shadow] failed to read shadow briefing:", error);
    return NextResponse.json({ error: "Failed to read shadow briefing" }, { status: 500 });
  }
}
