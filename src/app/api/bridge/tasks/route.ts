import { NextRequest, NextResponse } from "next/server";
import { addTask, parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

async function getCurrentWeekly() {
  const files = await listVaultDir("lists/now");
  const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
  if (mdFiles.length === 0) throw new Error("No weekly list found");
  const filename = mdFiles[0];
  const content = await readVaultFile(`lists/now/${filename}`);
  return { filename, content };
}

export async function POST(request: NextRequest) {
  try {
    const { title } = await request.json();
    if (!title || typeof title !== "string") {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const { filename, content } = await getCurrentWeekly();
    const updated = addTask(content, title.trim());
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    const parsed = parseWeeklyFile(updated, filename);
    return NextResponse.json({ task: parsed.tasks[0] });
  } catch (err) {
    console.error("[bridge/tasks] Error:", err);
    return NextResponse.json({ error: "Failed to add task" }, { status: 500 });
  }
}
