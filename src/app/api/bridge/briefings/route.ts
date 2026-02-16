import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { getVaultPath } from "@/lib/bridge/vault";

export async function GET() {
  try {
    const vaultPath = await getVaultPath();
    const briefingsDir = path.join(vaultPath, "briefings");

    let files: string[];
    try {
      files = await fs.readdir(briefingsDir);
    } catch {
      // No briefings directory — return empty list
      return NextResponse.json([]);
    }

    const mdFiles = files.filter((f) => f.endsWith(".md") && /^\d{4}-\d{2}-\d{2}\.md$/.test(f));

    const briefings = await Promise.all(
      mdFiles.map(async (filename) => {
        const filePath = path.join(briefingsDir, filename);
        const raw = await fs.readFile(filePath, "utf-8");
        const { data } = matter(raw);
        const date = filename.replace(/\.md$/, "");
        return {
          date,
          title: data.title || `Briefing — ${date}`,
          summary: data.summary || null,
        };
      })
    );

    // Sort newest first
    briefings.sort((a, b) => b.date.localeCompare(a.date));

    return NextResponse.json(briefings);
  } catch (err) {
    console.error("Failed to list briefings:", err);
    return NextResponse.json({ error: "Failed to list briefings" }, { status: 500 });
  }
}
