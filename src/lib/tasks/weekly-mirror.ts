import fs from "fs";
import path from "path";
import { parseWeeklyFile } from "../bridge/weekly-parser";
import { AGENT_SECTION_HEADING, insertWeeklyV2Line, insertWeeklyV2LineInSection } from "../bridge/weekly-v2-view";
import { atomicWriteFile } from "../library/utils";
import { updateTask } from "./store";
import type { TaskFile } from "./types";
import { renderWeeklyV2Line } from "./weekly-v2";

export { AGENT_SECTION_HEADING };

const NEW_MARKER_PREFIX = "🆕 ";

function markTaskFileNew(vaultPath: string, task: TaskFile): TaskFile {
  if (task.title.trimStart().startsWith("🆕")) return task;
  try {
    return updateTask(vaultPath, task.id, { title: `${NEW_MARKER_PREFIX}${task.title}` });
  } catch (error) {
    console.warn(`[tasks/weekly-mirror] new marker write failed for ${task.id}:`, error);
    return task;
  }
}

/**
 * Mirror an accepted task into the current v2 weekly list. Task files remain authoritative:
 * absent/v1 lists and cosmetic mirror failures never roll back the proposal decision.
 */
export function mirrorAcceptedTaskIntoWeekly(
  vaultPath: string,
  task: TaskFile,
  options?: { section?: string; mark?: boolean },
): void {
  try {
    const listsDir = path.join(vaultPath, "lists", "now");
    if (!fs.existsSync(listsDir)) return;
    const filename = fs.readdirSync(listsDir)
      .filter((name) => name.endsWith(".md") && !name.startsWith("."))
      .sort()
      .at(-1);
    if (!filename) return;
    const listPath = path.join(listsDir, filename);
    const content = fs.readFileSync(listPath, "utf-8");
    if (parseWeeklyFile(content, filename).listFormat !== 2) return;
    const relTaskPath = `tasks/${task.id}.md`;
    if (content.includes(`](${relTaskPath})`)) return;
    const marked = options?.mark ? markTaskFileNew(vaultPath, task) : task;
    const line = renderWeeklyV2Line(marked, relTaskPath);
    const inserted = options?.section !== undefined
      ? insertWeeklyV2LineInSection(content, line, options.section)
      : insertWeeklyV2Line(content, line);
    if (inserted === null) {
      console.warn(`[tasks/weekly-mirror] no task-section anchor in ${filename} for ${task.id}`);
      return;
    }
    atomicWriteFile(listPath, inserted);
  } catch (error) {
    console.warn(`[tasks/weekly-mirror] mirror failed for ${task.id}:`, error);
  }
}
