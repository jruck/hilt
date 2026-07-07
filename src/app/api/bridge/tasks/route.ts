import { NextRequest, NextResponse } from "next/server";
import { addTask, parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { hydrateWeeklyTasks, insertWeeklyV2Line } from "@/lib/bridge/weekly-v2-view";
import { getVaultPath, listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";
import { createTask } from "@/lib/tasks/store";
import { renderWeeklyV2Line } from "@/lib/tasks/weekly-v2";
import type { BridgeTask } from "@/lib/types";

async function getCurrentWeekly() {
  const files = await listVaultDir("lists/now");
  const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
  if (mdFiles.length === 0) throw new Error("No weekly list found");
  const filename = mdFiles[0];
  const content = await readVaultFile(`lists/now/${filename}`);
  return { filename, content };
}

/**
 * v2 add (v3 unit A4): the task FILE is created first (truth — the task exists even if the
 * list line never lands), then the rendered line is spliced surgically into the top of the
 * weekly task section (v1's insertion convention; never the v1 serializer). A failed splice
 * or list write is a cosmetic mirror failure — warn + success + `mirrorFailed` (A6's
 * proposal/task surfaces show the orphaned file; the next recycle can re-carry it).
 */
async function addTaskV2(filename: string, content: string, title: string): Promise<NextResponse> {
  const vaultPath = await getVaultPath();

  // File first (truth).
  const file = createTask(vaultPath, { title, status: "accepted-me" });
  const relTaskPath = `tasks/${file.id}.md`;
  const line = renderWeeklyV2Line(file, relTaskPath);

  // Response fallback when the mirror fails — same shape the v1 add returns (task-0 = top).
  const fallbackTask: BridgeTask = {
    id: "task-0",
    title: file.title,
    done: false,
    details: [],
    rawLines: [line],
    projectPath: null,
    projectPaths: [],
    dueDate: null,
    group: null,
    taskPath: relTaskPath,
    missing: false,
  };

  const inserted = insertWeeklyV2Line(content, line);
  if (inserted === null) {
    console.warn(
      `[bridge/tasks] v2 add mirror skipped: no task-section anchor in ${filename} (task file ${file.id} created)`,
    );
    return NextResponse.json({ task: fallbackTask, mirrorFailed: true });
  }
  try {
    await writeVaultFileAtomic(`lists/now/${filename}`, inserted);
  } catch (err) {
    console.warn(
      `[bridge/tasks] v2 add mirror write failed for ${filename} (task file ${file.id} created):`,
      err,
    );
    return NextResponse.json({ task: fallbackTask, mirrorFailed: true });
  }

  const parsed = parseWeeklyFile(inserted, filename);
  const tasks = hydrateWeeklyTasks(vaultPath, parsed.tasks);
  const created = tasks.find(t => t.taskPath === relTaskPath) ?? fallbackTask;
  return NextResponse.json({ task: created });
}

export async function POST(request: NextRequest) {
  try {
    const { title } = await request.json();
    if (!title || typeof title !== "string" || !title.trim()) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const { filename, content } = await getCurrentWeekly();
    if (parseWeeklyFile(content, filename).listFormat === 2) {
      return await addTaskV2(filename, content, title.trim());
    }
    const updated = addTask(content, title.trim());
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    const parsed = parseWeeklyFile(updated, filename);
    return NextResponse.json({ task: parsed.tasks[0] });
  } catch (err) {
    console.error("[bridge/tasks] Error:", err);
    return NextResponse.json({ error: "Failed to add task" }, { status: 500 });
  }
}
