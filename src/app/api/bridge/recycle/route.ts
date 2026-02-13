import { NextRequest, NextResponse } from "next/server";
import { parseWeeklyFile, updateAccomplishments } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

export async function POST(request: NextRequest) {
  try {
    const { carry, newWeek, notes, accomplishments } = await request.json();

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
    // Details are stored without their leading indent (stripped on parse),
    // so we must re-indent them when writing to the new file.
    const taskLines = carriedTasks.flatMap(t => {
      // Reset checkbox to unchecked for carried tasks
      const projPath = t.projectPath;
      const titleText = projPath ? `[${t.title}](${projPath})` : t.title;
      const titleLine = `- [ ] ${titleText}`;
      const indentedDetails = t.details.map(line =>
        line.trim() === "" ? "" : "\t" + line
      );
      return [titleLine, ...indentedDetails];
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

    // Insert carried notes if provided
    if (typeof notes === "string" && notes.trim()) {
      finalContent = finalContent.replace(
        "## Notes\n",
        "## Notes\n" + notes.trim() + "\n"
      );
    }

    // Save accomplishments to the outgoing (current) week file
    if (typeof accomplishments === "string" && accomplishments.trim()) {
      const updatedCurrent = updateAccomplishments(currentContent, accomplishments.trim());
      await writeVaultFileAtomic(`lists/now/${currentFilename}`, updatedCurrent);
    }

    const newFilename = `${newWeek}.md`;
    await writeVaultFileAtomic(`lists/now/${newFilename}`, finalContent);

    return NextResponse.json({ filename: newFilename });
  } catch (err) {
    console.error("[bridge/recycle] Error:", err);
    return NextResponse.json({ error: "Failed to create new week" }, { status: 500 });
  }
}
