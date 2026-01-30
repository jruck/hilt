import { NextRequest, NextResponse } from "next/server";
import { parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function POST(request: NextRequest) {
  try {
    const { carry, newWeek } = await request.json();

    if (!Array.isArray(carry) || typeof newWeek !== "string") {
      return NextResponse.json(
        { error: "carry must be an array and newWeek must be a string" },
        { status: 400 }
      );
    }

    // Read current weekly file
    const files = await listVaultDir("lists/now");
    const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
    if (mdFiles.length === 0) {
      return NextResponse.json({ error: "No weekly list found" }, { status: 404 });
    }

    const currentFilename = mdFiles[0];
    const currentContent = await readVaultFile(`lists/now/${currentFilename}`);
    const parsed = parseWeeklyFile(currentContent, currentFilename);

    // Extract carried task blocks
    const carrySet = new Set(carry);
    const carriedTasks = parsed.tasks.filter(t => carrySet.has(t.id));

    // Read template
    let template: string;
    try {
      template = await readVaultFile("meta/templates/weekly-list.md");
    } catch {
      // Fallback template
      template = `---\ntype: weekly-list\nweek: {{date:YYYY-MM-DD}}\n---\n\n# Week of {{date:YYYY-MM-DD}}\n\n## Tasks\n\n## Notes\n`;
    }

    // Interpolate date
    const newContent = template.replace(/\{\{date:YYYY-MM-DD\}\}/g, newWeek);

    // Insert carried tasks into ## Tasks section
    const taskLines = carriedTasks.flatMap(t => {
      // Reset checkbox to unchecked for carried tasks
      const titleLine = `- [ ] ${t.title}`;
      return [titleLine, ...t.details];
    });

    let finalContent: string;
    if (taskLines.length > 0) {
      finalContent = newContent.replace(
        "## Tasks\n",
        "## Tasks\n" + taskLines.join("\n") + "\n"
      );
    } else {
      finalContent = newContent;
    }

    const newFilename = `${newWeek}.md`;
    await writeVaultFileAtomic(`lists/now/${newFilename}`, finalContent);

    return NextResponse.json({ filename: newFilename });
  } catch (err) {
    console.error("[bridge/recycle] Error:", err);
    return NextResponse.json({ error: "Failed to create new week" }, { status: 500 });
  }
}
