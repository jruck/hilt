import { NextResponse } from "next/server";
import { getAllTodoItems } from "@/lib/todo-md";

/**
 * GET /api/inbox-counts?paths=/path1,/path2,/path3
 * Returns inbox (To Do) item counts for multiple paths at once.
 * Used by the sidebar to show counts for all pinned folders.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const pathsParam = searchParams.get("paths");

  if (!pathsParam) {
    return NextResponse.json({ counts: {} });
  }

  const paths = pathsParam.split(",").filter(Boolean);
  const counts: Record<string, number> = {};

  // Get inbox counts for each path
  for (const path of paths) {
    try {
      const items = getAllTodoItems(path);
      // Count incomplete items only
      counts[path] = items.filter((item) => !item.completed).length;
    } catch {
      // Path doesn't have a Todo.md or error reading it
      counts[path] = 0;
    }
  }

  return NextResponse.json({ counts });
}
