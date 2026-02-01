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
export function parseWeeklyFile(content: string, filename: string): Omit<BridgeWeekly, 'vaultPath' | 'filePath'> {
  const [fm, body] = parseFrontmatter(content);
  const week = fm.week || "";
  const lines = body.split("\n");

  // Find ## Tasks section
  let tasksStart = -1;
  let tasksEnd = lines.length;
  let notesStart = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "## Tasks") {
      tasksStart = i + 1;
    } else if (line.trim() === "## Notes") {
      if (tasksStart !== -1 && tasksEnd === lines.length) {
        tasksEnd = i;
      }
      notesStart = i + 1;
    } else if (line.startsWith("## ") && tasksStart !== -1 && tasksEnd === lines.length) {
      tasksEnd = i;
    }
  }

  // Parse tasks
  const tasks: BridgeTask[] = [];
  if (tasksStart !== -1) {
    let currentTask: { titleLine: string; done: boolean; rawLines: string[]; detailLines: string[] } | null = null;

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
          });
        }
        currentTask = {
          titleLine: taskMatch[2],
          done: taskMatch[1] === "x",
          rawLines: [line],
          detailLines: [],
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
      });
    }
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
    notes,
  };
}

/**
 * Add a new task at the top of the task list.
 * Returns the updated file content.
 */
export function addTask(content: string, title: string): string {
  const parsed = parseWeeklyFile(content, "");
  const newTask: BridgeTask = {
    id: `task-0`,
    title,
    done: false,
    details: [],
    rawLines: [`- [ ] ${title}`],
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
  updates: Partial<Pick<BridgeTask, "done" | "title" | "details">>
): string {
  const parsed = parseWeeklyFile(content, "");
  const updatedTasks = parsed.tasks.map(task => {
    if (task.id !== taskId) return task;
    const done = updates.done !== undefined ? updates.done : task.done;
    const title = updates.title !== undefined ? updates.title : task.title;
    const details = updates.details !== undefined ? updates.details : task.details;
    const checkbox = done ? "[x]" : "[ ]";
    const titleLine = `- ${checkbox} ${title}`;
    // Re-indent details for file storage
    const indentedDetails = details.map(addOneIndent);
    const rawLines = [titleLine, ...indentedDetails];
    return { ...task, done, title, details, rawLines };
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
 * Rebuild the full file content from its parts.
 * If notes is null, preserve existing notes.
 */
function rebuildContent(
  originalContent: string,
  tasks: BridgeTask[],
  newNotes: string | null
): string {
  const lines = originalContent.split("\n");

  // Find section boundaries
  let tasksHeadingIdx = -1;
  let notesHeadingIdx = -1;

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "## Tasks") {
      tasksHeadingIdx = i;
    } else if (lines[i].trim() === "## Notes") {
      notesHeadingIdx = i;
    }
  }

  // Build preamble (everything before ## Tasks, including the heading)
  const preamble = tasksHeadingIdx !== -1
    ? lines.slice(0, tasksHeadingIdx + 1).join("\n")
    : lines.join("\n");

  // Build tasks section (strip trailing blank lines from each task)
  const taskLines = tasks.flatMap(t => t.rawLines);
  const tasksSection = taskLines.length > 0 ? taskLines.join("\n") : "";

  // Build notes section
  let notesContent: string;
  if (newNotes !== null) {
    notesContent = newNotes.trim();
  } else if (notesHeadingIdx !== -1) {
    notesContent = lines.slice(notesHeadingIdx + 1).join("\n").trim();
  } else {
    notesContent = "";
  }

  const parts = [preamble, tasksSection, "\n## Notes", notesContent];
  return parts.join("\n") + "\n";
}
