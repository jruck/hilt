import { NextRequest, NextResponse } from "next/server";
import {
  parseTodoFile,
  addTodoItem,
  updateTodoItem,
  deleteTodoItem,
  getTodoFileModTime,
  reorderSections,
  reorderItems,
} from "@/lib/todo-md";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const lastModTime = searchParams.get("lastModTime");
    const scopePath = searchParams.get("scope") || undefined;

    const currentModTime = getTodoFileModTime(scopePath);
    const data = parseTodoFile(scopePath);

    // Flatten all items with section information
    const items = [];

    // Add orphan items (no section)
    items.push(
      ...data.orphanItems.map((item) => ({
        id: item.id,
        prompt: item.text,
        completed: item.completed,
        section: null,
        projectPath: null,
        createdAt: new Date().toISOString(),
        sortOrder: 0,
      }))
    );

    // Add items from each section
    for (const section of data.sections) {
      items.push(
        ...section.items.map((item) => ({
          id: item.id,
          prompt: item.text,
          completed: item.completed,
          section: section.heading,
          projectPath: null,
          createdAt: new Date().toISOString(),
          sortOrder: 0,
        }))
      );
    }

    return NextResponse.json({
      items,
      sections: data.sections.map((s) => ({
        heading: s.heading,
        level: s.level,
      })),
      lastModTime: currentModTime?.getTime() || null,
    });
  } catch (error) {
    console.error("Error fetching todo items:", error);
    return NextResponse.json(
      { error: "Failed to fetch todo items" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { prompt, section, scope } = body;

    if (!prompt) {
      return NextResponse.json(
        { error: "prompt is required" },
        { status: 400 }
      );
    }

    const item = addTodoItem(prompt, section || null, scope || undefined);

    return NextResponse.json({ id: item.id, success: true });
  } catch (error) {
    console.error("Error creating todo item:", error);
    return NextResponse.json(
      { error: "Failed to create todo item" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { id, prompt, completed, section, scope } = body;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    const updates: { text?: string; completed?: boolean; section?: string | null } = {};
    if (prompt !== undefined) updates.text = prompt;
    if (completed !== undefined) updates.completed = completed;
    if (section !== undefined) updates.section = section;

    updateTodoItem(id, updates, scope || undefined);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error updating todo item:", error);
    return NextResponse.json(
      { error: "Failed to update todo item" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const id = searchParams.get("id");
    const scopePath = searchParams.get("scope") || undefined;

    if (!id) {
      return NextResponse.json({ error: "id is required" }, { status: 400 });
    }

    deleteTodoItem(id, scopePath);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting todo item:", error);
    return NextResponse.json(
      { error: "Failed to delete todo item" },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { sectionOrder, itemReorder, scope } = body;

    // Handle section reordering
    if (sectionOrder && Array.isArray(sectionOrder)) {
      reorderSections(sectionOrder, scope || undefined);
      return NextResponse.json({ success: true });
    }

    // Handle item reordering
    if (itemReorder) {
      const { itemId, targetSection, targetIndex } = itemReorder;
      if (!itemId || targetIndex === undefined) {
        return NextResponse.json(
          { error: "itemReorder requires itemId and targetIndex" },
          { status: 400 }
        );
      }
      reorderItems(itemId, targetSection ?? null, targetIndex, scope || undefined);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: "sectionOrder or itemReorder is required" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error reordering:", error);
    return NextResponse.json(
      { error: "Failed to reorder" },
      { status: 500 }
    );
  }
}
