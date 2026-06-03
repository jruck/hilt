import { NextRequest, NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import matter from "gray-matter";
import { getVaultPath } from "@/lib/bridge/vault";
import { getHermesBriefingFailureForDate } from "@/lib/bridge/briefing-status";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ date: string }> }
) {
  try {
    const { date } = await params;

    // Validate date format
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return NextResponse.json({ error: "Invalid date format" }, { status: 400 });
    }

    const vaultPath = await getVaultPath();
    const filePath = path.join(vaultPath, "briefings", `${date}.md`);

    let raw: string;
    try {
      raw = await fs.readFile(filePath, "utf-8");
    } catch {
      const failure = await getHermesBriefingFailureForDate(date);
      if (failure) {
        return NextResponse.json({
          date,
          title: `Morning Briefing — ${date}`,
          summary: `Generation failed: ${failure.error}`,
          content: "",
          status: failure.status,
          run: failure,
        });
      }
      return NextResponse.json({ error: "Briefing not found" }, { status: 404 });
    }

    const { data, content } = matter(raw);

    return NextResponse.json({
      date,
      title: data.title || `Briefing — ${date}`,
      summary: data.summary || null,
      content: content.trim(),
    });
  } catch (err) {
    console.error("Failed to read briefing:", err);
    return NextResponse.json({ error: "Failed to read briefing" }, { status: 500 });
  }
}
