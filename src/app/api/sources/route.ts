import { NextRequest, NextResponse } from "next/server";
import {
  getSources,
  addSource,
  updateSource,
  deleteSource,
  reorderSources,
} from "@/lib/db";

// GET — list all sources sorted by rank
export async function GET() {
  try {
    const sources = await getSources();
    return NextResponse.json(sources);
  } catch (error) {
    console.error("Error fetching sources:", error);
    return NextResponse.json(
      { error: "Failed to fetch sources" },
      { status: 500 }
    );
  }
}

// POST — add a new source
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, url, type, folder } = body;

    if (!name || !type) {
      return NextResponse.json(
        { error: "name and type are required" },
        { status: 400 }
      );
    }

    if (type !== "local" && type !== "remote") {
      return NextResponse.json(
        { error: "type must be 'local' or 'remote'" },
        { status: 400 }
      );
    }

    // Remote sources require a URL; local sources can have empty URL (Electron fills it)
    if (type === "remote" && !url) {
      return NextResponse.json(
        { error: "url is required for remote sources" },
        { status: 400 }
      );
    }

    const source = await addSource(name, url || "", type, folder);
    return NextResponse.json(source);
  } catch (error) {
    console.error("Error adding source:", error);
    return NextResponse.json(
      { error: "Failed to add source" },
      { status: 500 }
    );
  }
}

// PATCH — update source or reorder
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();

    // Reorder action
    if (body.action === "reorder") {
      if (!Array.isArray(body.orderedIds)) {
        return NextResponse.json(
          { error: "orderedIds array is required" },
          { status: 400 }
        );
      }
      const sources = await reorderSources(body.orderedIds);
      return NextResponse.json(sources);
    }

    // Update a single source
    const { id, name, url, type, folder } = body;
    if (!id) {
      return NextResponse.json(
        { error: "id is required" },
        { status: 400 }
      );
    }

    const updates: Record<string, string> = {};
    if (name !== undefined) updates.name = name;
    if (url !== undefined) updates.url = url;
    if (type !== undefined) updates.type = type;
    if (folder !== undefined) updates.folder = folder;

    const source = await updateSource(id, updates);
    if (!source) {
      return NextResponse.json(
        { error: "Source not found" },
        { status: 404 }
      );
    }
    return NextResponse.json(source);
  } catch (error) {
    console.error("Error updating source:", error);
    return NextResponse.json(
      { error: "Failed to update source" },
      { status: 500 }
    );
  }
}

// DELETE — remove a source by id
export async function DELETE(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get("id");
    if (!id) {
      return NextResponse.json(
        { error: "id query parameter is required" },
        { status: 400 }
      );
    }

    await deleteSource(id);
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting source:", error);
    return NextResponse.json(
      { error: "Failed to delete source" },
      { status: 500 }
    );
  }
}
