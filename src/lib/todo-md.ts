import * as fs from "fs";
import * as path from "path";

/**
 * Get the Todo.md file path for a given scope
 * Uses docs/Todo.md in the scoped folder (standard Claude Code convention)
 * Returns null if no scope is provided (All Projects view shows empty state)
 */
function getTodoFilePath(scopePath?: string): string | null {
  if (scopePath) {
    return path.join(scopePath, "docs", "Todo.md");
  }
  // No scope = All Projects view, which has no Todo.md file
  return null;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  section: string | null; // null for items not under a section
  lineNumber: number; // Track original line for updates
}

export interface TodoSection {
  heading: string;
  level: number; // 1 for #, 2 for ##, etc.
  items: TodoItem[];
}

export interface TodoData {
  preamble: string[]; // Lines before first section or task
  sections: TodoSection[];
  orphanItems: TodoItem[]; // Tasks not under any section
  postamble: string[]; // Lines after last task
}

/**
 * Parse the Todo.md file into structured data
 */
export function parseTodoFile(scopePath?: string): TodoData {
  const todoFile = getTodoFilePath(scopePath);

  // No scope (All Projects view) or file doesn't exist = empty data
  if (!todoFile || !fs.existsSync(todoFile)) {
    return {
      preamble: [],
      sections: [],
      orphanItems: [],
      postamble: [],
    };
  }

  const content = fs.readFileSync(todoFile, "utf-8");
  const lines = content.split("\n");

  const preamble: string[] = [];
  const sections: TodoSection[] = [];
  const orphanItems: TodoItem[] = [];
  const postamble: string[] = [];

  let currentSection: TodoSection | null = null;
  let inPreamble = true;
  let lastTaskLine = -1;
  let taskCounter = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Check if it's a heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      inPreamble = false;
      const level = headingMatch[1].length;
      const heading = headingMatch[2].trim();

      currentSection = {
        heading,
        level,
        items: [],
      };
      sections.push(currentSection);
      continue;
    }

    // Check if it's a task checkbox
    const taskMatch = line.match(/^(\s*)-\s+\[([ x])\]\s+(.+)$/);
    if (taskMatch) {
      inPreamble = false;
      lastTaskLine = i;

      const completed = taskMatch[2] === "x";
      const text = taskMatch[3].trim();

      // Remove bold markdown if present (e.g., "**Real-time log viewing**")
      const cleanText = text.replace(/\*\*(.+?)\*\*/g, "$1");

      const item: TodoItem = {
        id: `task-${taskCounter++}-${i}`,
        text: cleanText,
        completed,
        section: currentSection?.heading || null,
        lineNumber: i,
      };

      if (currentSection) {
        currentSection.items.push(item);
      } else {
        orphanItems.push(item);
      }
      continue;
    }

    // Otherwise, it's content
    if (inPreamble) {
      preamble.push(line);
    } else if (i > lastTaskLine && lastTaskLine >= 0) {
      postamble.push(line);
    }
  }

  return {
    preamble,
    sections,
    orphanItems,
    postamble,
  };
}

/**
 * Write the structured data back to Todo.md
 */
export function writeTodoFile(data: TodoData, scopePath?: string): void {
  const todoFile = getTodoFilePath(scopePath);

  // Cannot write todos without a scope (All Projects view)
  if (!todoFile) {
    throw new Error("Cannot write todos without a scope. Navigate to a project folder first.");
  }

  const lines: string[] = [];

  // Write preamble
  lines.push(...data.preamble);

  // Write orphan items (tasks before any section)
  for (const item of data.orphanItems) {
    const checkbox = item.completed ? "[x]" : "[ ]";
    lines.push(`- ${checkbox} ${item.text}`);
  }

  // Write sections with their items
  for (const section of data.sections) {
    const heading = "#".repeat(section.level) + " " + section.heading;
    lines.push(heading);
    lines.push(""); // Empty line after heading

    for (const item of section.items) {
      const checkbox = item.completed ? "[x]" : "[ ]";
      lines.push(`- ${checkbox} ${item.text}`);
    }

    lines.push(""); // Empty line after section
  }

  // Write postamble
  lines.push(...data.postamble);

  // Ensure file ends with newline
  const content = lines.join("\n");
  const finalContent = content.endsWith("\n") ? content : content + "\n";

  // Ensure directory exists
  fs.mkdirSync(path.dirname(todoFile), { recursive: true });
  fs.writeFileSync(todoFile, finalContent);
}

/**
 * Add a new todo item to a specific section (or orphan if section is null)
 */
export function addTodoItem(text: string, section: string | null = null, scopePath?: string): TodoItem {
  const data = parseTodoFile(scopePath);

  let taskCounter = 0;
  data.sections.forEach(s => taskCounter += s.items.length);
  taskCounter += data.orphanItems.length;

  const newItem: TodoItem = {
    id: `task-${taskCounter}-${Date.now()}`,
    text,
    completed: false,
    section,
    lineNumber: -1,
  };

  if (section === null) {
    data.orphanItems.unshift(newItem);
  } else {
    const targetSection = data.sections.find((s) => s.heading === section);
    if (targetSection) {
      targetSection.items.unshift(newItem);
    } else {
      // Section doesn't exist, create it
      data.sections.push({
        heading: section,
        level: 2,
        items: [newItem],
      });
    }
  }

  writeTodoFile(data, scopePath);
  return newItem;
}

/**
 * Update a todo item
 */
export function updateTodoItem(id: string, updates: { text?: string; completed?: boolean; section?: string | null }, scopePath?: string): void {
  const data = parseTodoFile(scopePath);

  let found = false;

  // Find and update in orphan items
  const orphanIndex = data.orphanItems.findIndex((item) => item.id === id);
  if (orphanIndex !== -1) {
    found = true;
    const item = data.orphanItems[orphanIndex];

    if (updates.text !== undefined) item.text = updates.text;
    if (updates.completed !== undefined) item.completed = updates.completed;

    // Move to different section if requested
    if (updates.section !== undefined && updates.section !== item.section) {
      data.orphanItems.splice(orphanIndex, 1);
      item.section = updates.section;

      if (updates.section === null) {
        data.orphanItems.push(item);
      } else {
        const targetSection = data.sections.find((s) => s.heading === updates.section);
        if (targetSection) {
          targetSection.items.push(item);
        } else {
          data.sections.push({
            heading: updates.section,
            level: 2,
            items: [item],
          });
        }
      }
    }
  }

  // Find and update in sections
  if (!found) {
    for (const section of data.sections) {
      const itemIndex = section.items.findIndex((item) => item.id === id);
      if (itemIndex !== -1) {
        found = true;
        const item = section.items[itemIndex];

        if (updates.text !== undefined) item.text = updates.text;
        if (updates.completed !== undefined) item.completed = updates.completed;

        // Move to different section if requested
        if (updates.section !== undefined && updates.section !== item.section) {
          section.items.splice(itemIndex, 1);
          item.section = updates.section;

          if (updates.section === null) {
            data.orphanItems.push(item);
          } else {
            const targetSection = data.sections.find((s) => s.heading === updates.section);
            if (targetSection) {
              targetSection.items.push(item);
            } else {
              data.sections.push({
                heading: updates.section,
                level: 2,
                items: [item],
              });
            }
          }
        }
        break;
      }
    }
  }

  if (found) {
    writeTodoFile(data, scopePath);
  }
}

/**
 * Delete a todo item
 */
export function deleteTodoItem(id: string, scopePath?: string): void {
  const data = parseTodoFile(scopePath);

  // Remove from orphan items
  data.orphanItems = data.orphanItems.filter((item) => item.id !== id);

  // Remove from sections
  for (const section of data.sections) {
    section.items = section.items.filter((item) => item.id !== id);
  }

  writeTodoFile(data, scopePath);
}

/**
 * Get all todo items (flattened)
 */
export function getAllTodoItems(scopePath?: string): TodoItem[] {
  const data = parseTodoFile(scopePath);
  const items: TodoItem[] = [];

  items.push(...data.orphanItems);

  for (const section of data.sections) {
    items.push(...section.items);
  }

  return items;
}

/**
 * Get the last modified time of the Todo.md file
 */
export function getTodoFileModTime(scopePath?: string): Date | null {
  const todoFile = getTodoFilePath(scopePath);
  if (!todoFile || !fs.existsSync(todoFile)) {
    return null;
  }
  const stats = fs.statSync(todoFile);
  return stats.mtime;
}

/**
 * Reorder sections by providing an array of section headings in the desired order
 */
export function reorderSections(orderedHeadings: string[], scopePath?: string): void {
  const data = parseTodoFile(scopePath);

  // Create a map of heading to section for quick lookup
  const sectionMap = new Map<string, TodoSection>();
  for (const section of data.sections) {
    sectionMap.set(section.heading, section);
  }

  // Reorder sections based on the provided order
  const reorderedSections: TodoSection[] = [];
  for (const heading of orderedHeadings) {
    const section = sectionMap.get(heading);
    if (section) {
      reorderedSections.push(section);
      sectionMap.delete(heading);
    }
  }

  // Add any remaining sections that weren't in the order (shouldn't happen normally)
  for (const section of sectionMap.values()) {
    reorderedSections.push(section);
  }

  data.sections = reorderedSections;
  writeTodoFile(data, scopePath);
}

/**
 * Reorder an item within its section or move it to a different section at a specific position
 */
export function reorderItems(
  itemId: string,
  targetSection: string | null,
  targetIndex: number,
  scopePath?: string
): void {
  const data = parseTodoFile(scopePath);

  // Find and remove the item from its current location
  let item: TodoItem | null = null;

  // Check orphan items
  const orphanIndex = data.orphanItems.findIndex((i) => i.id === itemId);
  if (orphanIndex !== -1) {
    item = data.orphanItems.splice(orphanIndex, 1)[0];
  }

  // Check sections
  if (!item) {
    for (const section of data.sections) {
      const itemIndex = section.items.findIndex((i) => i.id === itemId);
      if (itemIndex !== -1) {
        item = section.items.splice(itemIndex, 1)[0];
        break;
      }
    }
  }

  if (!item) {
    return; // Item not found
  }

  // Update the item's section
  item.section = targetSection;

  // Insert at target location
  if (targetSection === null) {
    // Insert into orphan items
    const clampedIndex = Math.max(0, Math.min(targetIndex, data.orphanItems.length));
    data.orphanItems.splice(clampedIndex, 0, item);
  } else {
    // Find or create target section
    let section = data.sections.find((s) => s.heading === targetSection);
    if (!section) {
      section = {
        heading: targetSection,
        level: 2,
        items: [],
      };
      data.sections.push(section);
    }
    const clampedIndex = Math.max(0, Math.min(targetIndex, section.items.length));
    section.items.splice(clampedIndex, 0, item);
  }

  writeTodoFile(data, scopePath);
}
