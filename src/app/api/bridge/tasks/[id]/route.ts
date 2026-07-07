import { NextRequest, NextResponse } from "next/server";
import { updateTask, deleteTask, reorderTasks as reorderTasksInContent } from "@/lib/bridge/weekly-parser";
import { parseWeeklyFile } from "@/lib/bridge/weekly-parser";
import { hydrateWeeklyTasks, removeWeeklyLines, replaceWeeklyLine, taskIdFromTaskPath } from "@/lib/bridge/weekly-v2-view";
import { getVaultPath, listVaultDir, readVaultFile, writeVaultFileAtomic } from "@/lib/bridge/vault";
import { canTransition } from "@/lib/tasks/status";
import { readTask, transitionTask, updateTask as updateTaskFile } from "@/lib/tasks/store";
import type { TaskPatch } from "@/lib/tasks/store";
import { mirrorCheckbox, renderWeeklyV2Line } from "@/lib/tasks/weekly-v2";
import type { TaskFile } from "@/lib/tasks/types";
import type { BridgeWeekly } from "@/lib/types";

async function getCurrentWeekly() {
  const files = await listVaultDir("lists/now");
  const mdFiles = files.filter(f => f.endsWith(".md")).sort().reverse();
  if (mdFiles.length === 0) throw new Error("No weekly list found");
  const filename = mdFiles[0];
  const content = await readVaultFile(`lists/now/${filename}`);
  return { filename, content };
}

/** Same validation the v1 branch has always applied to [due:: …] payloads. */
function isValidDueDate(dueDate: unknown): boolean {
  const match = typeof dueDate === "string" ? dueDate.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null;
  if (!match) return false;
  const parsed = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return (
    parsed.getFullYear() === Number(match[1]) &&
    parsed.getMonth() === Number(match[2]) - 1 &&
    parsed.getDate() === Number(match[3])
  );
}

interface V2PutInput {
  filename: string;
  content: string;
  weekly: Omit<BridgeWeekly, "vaultPath" | "filePath" | "availableWeeks" | "latestWeek">;
  id: string;
  done?: boolean;
  title?: string;
  details?: string[];
  dueDate?: string | null;
  projectPaths?: string[];
  moveTo?: string;
}

/**
 * Weekly list v2 write-through (v3 unit A3). The task FILE is the source of truth and is
 * written FIRST; the weekly list line is a mirror updated second. A failed mirror is
 * cosmetic (warn + success — the next hydrated read self-heals); a failed file write is an
 * error and the list is left untouched. NEVER list-first.
 *
 * Checkbox semantics: checked → done (accepted-* may shortcut straight to done),
 * unchecked → in-progress (the reopen path). Details/body and project edits land in the
 * task file ONLY — the v2 line never carries them.
 */
async function putWeeklyV2(input: V2PutInput): Promise<NextResponse> {
  const { filename, content, weekly, id, done, title, details, dueDate, projectPaths, moveTo } = input;
  const vaultPath = await getVaultPath();

  const task = weekly.tasks.find(t => t.id === id);
  if (!task) {
    return NextResponse.json({ error: "Task not found in weekly list" }, { status: 404 });
  }

  // Validate BEFORE any write: the task file is the truth store, and a bad patch that lands
  // there bricks the task (an empty title makes the file unparseable — every later read
  // degrades to missing and every mutation 500s). The UI trims, but curl/agents hit this raw.
  if (title !== undefined && (typeof title !== "string" || !title.trim())) {
    return NextResponse.json({ error: "title must be a non-empty string" }, { status: 400 });
  }
  if (details !== undefined && !(Array.isArray(details) && details.every(d => typeof d === "string"))) {
    return NextResponse.json({ error: "details must be an array of strings" }, { status: 400 });
  }
  if (projectPaths !== undefined && !(Array.isArray(projectPaths) && projectPaths.every(p => typeof p === "string"))) {
    return NextResponse.json({ error: "projectPaths must be an array of strings" }, { status: 400 });
  }

  const wantsFileWrite =
    done !== undefined || title !== undefined || details !== undefined ||
    dueDate !== undefined || projectPaths !== undefined;

  let updatedFile: TaskFile | null = null;
  if (wantsFileWrite) {
    const fileId = taskIdFromTaskPath(task.taskPath);
    if (!fileId) {
      return NextResponse.json(
        { error: "This line has no task-file link — edit the weekly file directly" },
        { status: 409 },
      );
    }
    const file = readTask(vaultPath, fileId);
    if (!file) {
      return NextResponse.json(
        { error: `Task file missing: tasks/${fileId}.md` },
        { status: 404 },
      );
    }

    // Validate the checkbox transition BEFORE any write so combined edits stay atomic.
    const wantsDone = done === true && file.status !== "done";
    const wantsReopen = done === false && file.status === "done";
    if (wantsDone && !canTransition(file.status, "done")) {
      return NextResponse.json(
        { error: `Cannot mark a ${file.status} task done` },
        { status: 409 },
      );
    }

    // File first (truth): non-status fields via the store patch…
    const patch: TaskPatch = {};
    if (title !== undefined) patch.title = title;
    if (dueDate !== undefined) patch.due = dueDate === null ? undefined : dueDate;
    if (details !== undefined) patch.body = details.join("\n");
    if (projectPaths !== undefined) patch.projects = projectPaths.length > 0 ? projectPaths : undefined;

    updatedFile = Object.keys(patch).length > 0 ? updateTaskFile(vaultPath, fileId, patch) : file;

    // …then the audited status transition (appends the History ledger line).
    if (wantsDone) {
      updatedFile = transitionTask(vaultPath, fileId, "done", "weekly-checkbox");
    } else if (wantsReopen) {
      updatedFile = transitionTask(vaultPath, fileId, "in-progress", "weekly-checkbox");
    }
  }

  // List second (mirror). Title/due changes re-render the whole line from the file;
  // a bare checkbox toggle mirrors just the checkbox, leaving the rest byte-untouched.
  let updatedContent = content;
  let mirrorFailed = false;
  if (updatedFile) {
    let newLine: string | null = null;
    if (title !== undefined || dueDate !== undefined) {
      newLine = renderWeeklyV2Line(updatedFile, task.taskPath!);
    } else if (done !== undefined) {
      newLine = mirrorCheckbox(task.rawLines[0], updatedFile.status === "done");
    }
    if (newLine !== null && newLine !== task.rawLines[0]) {
      const replaced = replaceWeeklyLine(updatedContent, task.startLine, task.rawLines[0], newLine);
      if (replaced === null) {
        mirrorFailed = true;
        console.warn(`[bridge/tasks] v2 mirror skipped: could not locate line for ${id} in ${filename}`);
      } else {
        updatedContent = replaced;
      }
    }
  }

  // Reorder is a pure list-view concern (rawLines round-trip verbatim, v2-safe).
  if (moveTo === "top" || moveTo === "bottom") {
    const parsed = parseWeeklyFile(updatedContent, filename);
    const current = parsed.tasks.find(t => t.id === id);
    if (current) {
      const rest = parsed.tasks.filter(t => t.id !== id);
      const reordered = moveTo === "top" ? [current, ...rest] : [...rest, current];
      updatedContent = reorderTasksInContent(updatedContent, reordered.map(t => t.id));
    }
  }

  if (updatedContent !== content) {
    try {
      await writeVaultFileAtomic(`lists/now/${filename}`, updatedContent);
    } catch (err) {
      if (updatedFile) {
        // The truth (task file) is written; the stale mirror self-heals on next read.
        mirrorFailed = true;
        updatedContent = content;
        console.warn(`[bridge/tasks] v2 mirror write failed for ${filename}:`, err);
      } else {
        throw err;
      }
    }
  }

  const finalParsed = parseWeeklyFile(updatedContent, filename);
  return NextResponse.json({
    tasks: hydrateWeeklyTasks(vaultPath, finalParsed.tasks),
    listFormat: 2,
    ...(mirrorFailed ? { mirrorFailed: true } : {}),
  });
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

    const weekly = parseWeeklyFile(content, filename);
    if (weekly.listFormat === 2) {
      if (dueDate !== undefined && dueDate !== null && !isValidDueDate(dueDate)) {
        return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
      }
      const v2Projects = projectPaths !== undefined
        ? projectPaths
        : projectPath !== undefined
          ? (projectPath ? [projectPath] : [])
          : undefined;
      return await putWeeklyV2({
        filename, content, weekly, id,
        done, title, details, dueDate, moveTo,
        projectPaths: v2Projects,
      });
    }

    const updates: { done?: boolean; title?: string; details?: string[]; projectPaths?: string[]; dueDate?: string | null } = {};
    if (done !== undefined) updates.done = done;
    if (title !== undefined) updates.title = title;
    if (details !== undefined) updates.details = details;
    if (dueDate !== undefined) {
      if (dueDate !== null && !isValidDueDate(dueDate)) {
        return NextResponse.json({ error: "Invalid due date" }, { status: 400 });
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

/**
 * v2 delete: the weekly list is a VIEW — removing a line drops the task from the week, but the
 * task FILE stays as the record. File first (non-done tasks transition to `dropped` with a
 * History line; a done task keeps its status — the work happened), then the line is removed
 * surgically (never through the v1 serializer, which would rewrite v2 content).
 */
async function deleteWeeklyV2(
  filename: string,
  content: string,
  weekly: Omit<BridgeWeekly, "vaultPath" | "filePath" | "availableWeeks" | "latestWeek">,
  id: string,
): Promise<NextResponse> {
  const vaultPath = await getVaultPath();
  const task = weekly.tasks.find(t => t.id === id);
  if (!task) {
    return NextResponse.json({ error: "Task not found in weekly list" }, { status: 404 });
  }

  const fileId = taskIdFromTaskPath(task.taskPath);
  if (fileId) {
    const file = readTask(vaultPath, fileId);
    if (file && file.status !== "done" && file.status !== "dropped") {
      if (!canTransition(file.status, "dropped")) {
        return NextResponse.json(
          { error: `Cannot drop a ${file.status} task from the weekly list` },
          { status: 409 },
        );
      }
      transitionTask(vaultPath, fileId, "dropped", "weekly-delete");
    }
    // Missing file: the line is all there is — removing it is the whole delete.
  }

  const removed = removeWeeklyLines(content, task.startLine, task.rawLines);
  if (removed === null) {
    // File already transitioned (truth updated); the stale line self-heals visually via
    // hydration and can be retried. Consistent with the mirror-failure contract in PUT.
    console.warn(`[bridge/tasks] v2 delete mirror skipped: could not locate line for ${id} in ${filename}`);
    return NextResponse.json({ ok: true, mirrorFailed: true });
  }
  await writeVaultFileAtomic(`lists/now/${filename}`, removed);
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { filename, content } = await getCurrentWeekly();

    const weekly = parseWeeklyFile(content, filename);
    if (weekly.listFormat === 2) {
      return await deleteWeeklyV2(filename, content, weekly, id);
    }

    const updated = deleteTask(content, id);
    await writeVaultFileAtomic(`lists/now/${filename}`, updated);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[bridge/tasks] Error:", err);
    return NextResponse.json({ error: "Failed to delete task" }, { status: 500 });
  }
}
