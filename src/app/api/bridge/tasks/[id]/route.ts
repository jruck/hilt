import { NextRequest, NextResponse } from "next/server";
import { updateTask, deleteTask, reorderTasks as reorderTasksInContent } from "@/lib/bridge/weekly-parser";
import { parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";

async function getCurrentWeekly() {
  const files = await listVaultDir("lists/now");
  const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
  if (mdFiles.length === 0) throw new Error("No weekly list found");
  const filename = mdFiles[0];
  const content = await readVaultFile(`lists/now/${filename}`);
  return { filename, content };
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { done, title, details, moveTo, projectPath, projectPaths, projectTitles, dueDate } = body;

    const { filename, content } = await getCurrentWeekly();

    const updates: { done?: boolean; title?: string; details?: string[]; projectPaths?: string[]; dueDate?: string | null } = {};
    if (done !== undefined) updates.done = done;
    if (title !== undefined) updates.title = title;
    if (details !== undefined) updates.details = details;
    if (dueDate !== undefined) {
      if (dueDate !== null) {
        const match = typeof dueDate === "string" ? dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
        const parsed = match
          ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
          : null;
        if (
          !match ||
          !parsed ||
          parsed.getFullYear() !== Number(match[1]) ||
          parsed.getMonth() !== Number(match[2]) - 1 ||
          parsed.getDate() !== Number(match[3])
        ) {
          return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
        }
      }
      updates.dueDate = dueDate;
    }
    // Support both legacy projectPath and new projectPaths
    if (projectPaths !== undefined) updates.projectPaths = projectPaths;
    else if (projectPath !== undefined) updates.projectPaths = projectPath ? [projectPath] : [];

    let updated = updateTask(content, id, updates, projectTitles);

    // Optionally move the task to top or bottom after update
    if (moveTo === "top" || moveTo === "bottom") {
      const parsed = parseWeeklyFile(updated, filename);
      const task = parsed.tasks.find(t => t.id === id);
      if (task) {
        const rest = parsed.tasks.filter(t => t.id !== id);
        const reordered = moveTo === "top"
          ? [task, ...rest]
          : [...rest, task];
        const newOrder = reordered.map(t => t.id);
        updated = reorderTasksInContent(updated, newOrder);
      }
    }

    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    const parsed = parseWeeklyFile(updated, filename);
    return NextResponse.json({ tasks: parsed.tasks });
  } catch (err) {
    console.error("[bridge/tasks] Error:", err);
    return NextResponse.json({ error: "Failed to update task" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { filename, content } = await getCurrentWeekly();

    const updated = deleteTask(content, id);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bridge/tasks] Error:", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
