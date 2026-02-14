import type { BridgeTask, BridgeWeekly } from "../types";

/**
 * Parse frontmatter from markdown content.
 * Returns [frontmatter object, body string after frontmatter].
 */
function parseFrontmatter(content: string): [Record<string, string>, string] {
  const fm: Record<string, string> = {};
  if (!content.startsWith("---")) return [fm, content];

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return [fm, content];

  const fmBlock = content.slice(4, endIdx);
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      fm[key] = value;
    }
  }

  const body = content.slice(endIdx + 4); // skip \n---
  return [fm, body];
}

/**
 * Get the ISO week start (Monday) for a given date.
 */
function getISOWeekStart(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Sunday = 0, Monday = 1, ...
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Strip one level of indentation (tab or 2 spaces) from a line.
 * Preserves deeper indentation as relative nesting.
 */
function stripOneIndent(line: string): string {
  if (line.startsWith("\t")) return line.slice(1);
  if (line.startsWith("  ")) return line.slice(2);
  return line;
}

/**
 * Add one level of indentation (tab) to a line.
 * Empty lines are left empty.
 */
function addOneIndent(line: string): string {
  if (line.trim() === "") return "";
  return "\t" + line;
}

/**
 * Parse a weekly list markdown file into structured data.
 *
 * Details are stored WITHOUT their leading indentation level — the first
 * indent that makes them sub-items of the parent checkbox is structural
 * and gets stripped on parse / re-added on save. Nested indentation beyond
 * the first level is preserved as-is.
 */
export function parseWeeklyFile(content: string, filename: string): Omit<BridgeWeekly, 'vaultPath' | 'filePath' | 'availableWeeks' | 'latestWeek'> {
  const [fm, body] = parseFrontmatter(content);
  const week = fm.week || "";
  const lines = body.split("\n");

  // Find section boundaries
  let accomplishmentsStart = -1;
  let accomplishmentsEnd = -1;
  let tasksStart = -1;
  let tasksEnd = lines.length;
  let notesStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "## Accomplishments") {
      accomplishmentsStart = i + 1;
    } else if (line === "## Tasks") {
      if (accomplishmentsStart !== -1 && accomplishmentsEnd === -1) {
        accomplishmentsEnd = i;
      }
      tasksStart = i + 1;
    } else if (line === "## Notes") {
      if (accomplishmentsStart !== -1 && accomplishmentsEnd === -1) {
        accomplishmentsEnd = i;
      }
      if (tasksStart !== -1 && tasksEnd === lines.length) {
        tasksEnd = i;
      }
      notesStart = i + 1;
    } else if (line.startsWith("## ")) {
      if (accomplishmentsStart !== -1 && accomplishmentsEnd === -1) {
        accomplishmentsEnd = i;
      }
      if (tasksStart !== -1 && tasksEnd === lines.length) {
        tasksEnd = i;
      }
    }
  }

  // Parse tasks
  const tasks: BridgeTask[] = [];
  if (tasksStart !== -1) {
    let currentTask: { titleLine: string; done: boolean; rawLines: string[]; detailLines: string[]; projectPath: string | null } | null = null;

    for (let i = tasksStart; i < tasksEnd; i++) {
      const line = lines[i];
      const taskMatch = line.match(/^- \[([ x])\] (.+)$/);

      if (taskMatch) {
        // Save previous task
        if (currentTask) {
          tasks.push({
            id: `task-${tasks.length}`,
            title: currentTask.titleLine,
            done: currentTask.done,
            details: currentTask.detailLines,
            rawLines: currentTask.rawLines,
            projectPath: currentTask.projectPath,
          });
        }
        // Check if title contains a markdown link: [display text](path)
        // Handles prefix text (emoji markers, etc.) before the link
        const titleRaw = taskMatch[2];
        const linkMatch = titleRaw.match(/^(.*?)\[(.+?)\]\((.+?)\)(.*)$/);
        currentTask = {
          titleLine: linkMatch
            ? `${linkMatch[1]}${linkMatch[2]}${linkMatch[4]}`.trim()
            : titleRaw,
          done: taskMatch[1] === "x",
          rawLines: [line],
          detailLines: [],
          projectPath: linkMatch ? linkMatch[3] : null,
        };
      } else if (currentTask && line.match(/^[\t ]{2,}|^\t/)) {
        // Indented line belongs to current task
        currentTask.rawLines.push(line);
        // Strip one indent level so details are clean markdown
        currentTask.detailLines.push(stripOneIndent(line));
      } else if (currentTask && line.trim() === "") {
        // Empty line — keep in both for structure and markdown rendering
        currentTask.rawLines.push(line);
        currentTask.detailLines.push("");
      } else if (line.trim() === "") {
        // Empty line outside a task context, skip
      }
    }

    // Save last task
    if (currentTask) {
      tasks.push({
        id: `task-${tasks.length}`,
        title: currentTask.titleLine,
        done: currentTask.done,
        details: currentTask.detailLines,
        rawLines: currentTask.rawLines,
        projectPath: currentTask.projectPath,
      });
    }
  }

  // Parse accomplishments
  let accomplishments = "";
  if (accomplishmentsStart !== -1) {
    const end = accomplishmentsEnd !== -1 ? accomplishmentsEnd : lines.length;
    accomplishments = lines.slice(accomplishmentsStart, end).join("\n").trim();
  }

  // Parse notes
  let notes = "";
  if (notesStart !== -1) {
    notes = lines.slice(notesStart).join("\n").trim();
  }

  // Compute needsRecycle
  let needsRecycle = false;
  if (week) {
    const weekDate = new Date(week + "T00:00:00");
    const weekStart = getISOWeekStart(weekDate);
    const currentWeekStart = getISOWeekStart(new Date());
    needsRecycle = currentWeekStart > weekStart;
  }

  return {
    filename,
    week,
    needsRecycle,
    tasks,
    accomplishments,
    notes,
  };
}

/**
 * Add a new task at the top of the task list.
 * Returns the updated file content.
 */
export function addTask(content: string, title: string, projectPath?: string): string {
  const parsed = parseWeeklyFile(content, "");
  const titleText = projectPath ? `[${title}](${projectPath})` : title;
  const newTask: BridgeTask = {
    id: `task-0`,
    title,
    done: false,
    details: [],
    rawLines: [`- [ ] ${titleText}`],
    projectPath: projectPath ?? null,
  };
  // Re-index existing tasks
  const reindexed = parsed.tasks.map((t, i) => ({ ...t, id: `task-${i + 1}` }));
  return rebuildContent(content, [newTask, ...reindexed], null);
}

/**
 * Delete a task by ID.
 */
export function deleteTask(content: string, taskId: string): string {
  const parsed = parseWeeklyFile(content, "");
  const filtered = parsed.tasks.filter(t => t.id !== taskId);
  return rebuildContent(content, filtered, null);
}

/**
 * Reconstruct the full weekly file content with reordered tasks.
 */
export function reorderTasks(content: string, newOrder: string[]): string {
  const parsed = parseWeeklyFile(content, "");
  const taskMap = new Map(parsed.tasks.map(t => [t.id, t]));

  const reordered = newOrder
    .map(id => taskMap.get(id))
    .filter((t): t is BridgeTask => t !== undefined);

  return rebuildContent(content, reordered, null);
}

/**
 * Update a single task's properties in the weekly file content.
 * When details are provided, they are treated as clean markdown (no leading
 * indent) and get re-indented for storage in the file.
 */
export function updateTask(
  content: string,
  taskId: string,
  updates: Partial<Pick<BridgeTask, "done" | "title" | "details" | "projectPath">>
): string {
  const parsed = parseWeeklyFile(content, "");
  const updatedTasks = parsed.tasks.map(task => {
    if (task.id !== taskId) return task;
    const done = updates.done !== undefined ? updates.done : task.done;
    const title = updates.title !== undefined ? updates.title : task.title;
    const details = updates.details !== undefined ? updates.details : task.details;
    const projPath = updates.projectPath !== undefined ? updates.projectPath : task.projectPath;
    const checkbox = done ? "[x]" : "[ ]";
    const titleText = projPath ? `[${title}](${projPath})` : title;
    const titleLine = `- ${checkbox} ${titleText}`;
    // Re-indent details for file storage
    const indentedDetails = details.map(addOneIndent);
    const rawLines = [titleLine, ...indentedDetails];
    return { ...task, done, title, details, rawLines, projectPath: projPath };
  });

  return rebuildContent(content, updatedTasks, null);
}

/**
 * Update the notes section of the weekly file.
 */
export function updateNotes(content: string, newNotes: string): string {
  const parsed = parseWeeklyFile(content, "");
  return rebuildContent(content, parsed.tasks, newNotes);
}

/**
 * Update the accomplishments section of the weekly file.
 */
export function updateAccomplishments(content: string, newAccomplishments: string): string {
  const parsed = parseWeeklyFile(content, "");
  return rebuildContent(content, parsed.tasks, null, newAccomplishments);
}

/**
 * Rebuild the full file content from its parts.
 * If notes/accomplishments is null, preserve existing.
 */
function rebuildContent(
  originalContent: string,
  tasks: BridgeTask[],
  newNotes: string | null,
  newAccomplishments?: string | null,
): string {
  const parsed = parseWeeklyFile(originalContent, "");
  const lines = originalContent.split("\n");

  // Find the title line (# Week of ...) or frontmatter end
  let preambleEnd = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith("# ")) {
      preambleEnd = i + 1;
      break;
    }
  }
  // If no H1 found, use frontmatter end
  if (preambleEnd === 0) {
    const [, body] = parseFrontmatter(originalContent);
    preambleEnd = originalContent.split("\n").length - body.split("\n").length;
  }

  const preamble = lines.slice(0, preambleEnd).join("\n");

  // Accomplishments
  const accomplishments = newAccomplishments !== undefined && newAccomplishments !== null
    ? newAccomplishments.trim()
    : parsed.accomplishments;

  // Tasks
  const taskLines = tasks.flatMap(t => t.rawLines);
  const tasksSection = taskLines.length > 0 ? taskLines.join("\n") : "";

  // Notes
  const notesContent = newNotes !== null ? newNotes.trim() : parsed.notes;

  const parts: string[] = [preamble];

  if (accomplishments) {
    parts.push("\n## Accomplishments\n" + accomplishments);
  }

  parts.push("\n## Tasks");
  if (tasksSection) parts.push(tasksSection);

  parts.push("\n## Notes");
  if (notesContent) parts.push(notesContent);

  return parts.join("\n") + "\n";
}
