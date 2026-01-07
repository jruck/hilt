import { NextRequest, NextResponse } from "next/server";
import {
  getAllPreferences,
  getPinnedFolders,
  pinFolder,
  unpinFolder,
  reorderPinnedFolders,
  getSidebarCollapsed,
  setSidebarCollapsed,
  getTheme,
  setTheme,
  getRecentScopes,
  addRecentScope,
  getViewMode,
  setViewMode,
} from "@/lib/db";

// GET all preferences or specific preference
export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const key = searchParams.get("key");

    if (!key) {
      // Return all preferences
      const prefs = await getAllPreferences();
      return NextResponse.json(prefs);
    }

    // Return specific preference
    switch (key) {
      case "pinnedFolders":
        return NextResponse.json(await getPinnedFolders());
      case "sidebarCollapsed":
        return NextResponse.json({ value: await getSidebarCollapsed() });
      case "theme":
        return NextResponse.json({ value: await getTheme() });
      case "recentScopes":
        return NextResponse.json(await getRecentScopes());
      case "viewMode":
        return NextResponse.json({ value: await getViewMode() });
      default:
        return NextResponse.json(
          { error: `Unknown preference key: ${key}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error fetching preferences:", error);
    return NextResponse.json(
      { error: "Failed to fetch preferences" },
      { status: 500 }
    );
  }
}

// POST - create/add operations
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, ...params } = body;

    switch (action) {
      case "pinFolder": {
        if (!params.path) {
          return NextResponse.json(
            { error: "path is required" },
            { status: 400 }
          );
        }
        const folder = await pinFolder(params.path);
        return NextResponse.json(folder);
      }
      case "addRecentScope": {
        if (!params.scope) {
          return NextResponse.json(
            { error: "scope is required" },
            { status: 400 }
          );
        }
        const scopes = await addRecentScope(params.scope);
        return NextResponse.json(scopes);
      }
      default:
        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error creating preference:", error);
    return NextResponse.json(
      { error: "Failed to create preference" },
      { status: 500 }
    );
  }
}

// PATCH - update operations
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { key, value, action, ...params } = body;

    // Handle special actions
    if (action === "reorderPinnedFolders") {
      if (!params.activeId || !params.overId) {
        return NextResponse.json(
          { error: "activeId and overId are required" },
          { status: 400 }
        );
      }
      const folders = await reorderPinnedFolders(params.activeId, params.overId);
      return NextResponse.json(folders);
    }

    // Handle simple key-value updates
    if (!key) {
      return NextResponse.json(
        { error: "key is required" },
        { status: 400 }
      );
    }

    switch (key) {
      case "sidebarCollapsed":
        await setSidebarCollapsed(value);
        return NextResponse.json({ success: true });
      case "theme":
        await setTheme(value);
        return NextResponse.json({ success: true });
      case "viewMode":
        await setViewMode(value);
        return NextResponse.json({ success: true });
      default:
        return NextResponse.json(
          { error: `Cannot update preference: ${key}` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error updating preference:", error);
    return NextResponse.json(
      { error: "Failed to update preference" },
      { status: 500 }
    );
  }
}

// DELETE - remove operations
export async function DELETE(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get("action");
    const id = searchParams.get("id");

    if (action === "unpinFolder") {
      if (!id) {
        return NextResponse.json(
          { error: "id is required" },
          { status: 400 }
        );
      }
      await unpinFolder(id);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json(
      { error: `Unknown action: ${action}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error deleting preference:", error);
    return NextResponse.json(
      { error: "Failed to delete preference" },
      { status: 500 }
    );
  }
}
