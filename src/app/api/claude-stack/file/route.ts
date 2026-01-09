import { NextRequest, NextResponse } from "next/server";
import { readConfigFile } from "@/lib/claude-config/parsers";
import { saveConfigFile, deleteConfigFile } from "@/lib/claude-config/writers";
import { discoverStack } from "@/lib/claude-config/discovery";
import type { ConfigFile } from "@/lib/claude-config/types";

// GET - Read a specific file
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");
  const scope = searchParams.get("scope");

  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  try {
    // Find the file in the stack to get its metadata
    let fileInfo: ConfigFile | undefined;

    if (scope) {
      const stack = await discoverStack(scope);
      const allFiles = [
        ...stack.layers.system,
        ...stack.layers.user,
        ...stack.layers.project,
        ...stack.layers.local,
      ];
      fileInfo = allFiles.find((f) => f.path === filePath);
    }

    // If file not found in stack, create a minimal file info
    if (!fileInfo) {
      const path = await import("path");
      fileInfo = {
        path: filePath,
        relativePath: filePath,
        type: filePath.endsWith(".json") ? "settings" : "memory",
        layer: "project",
        exists: true,
        name: path.basename(filePath),
      };
    }

    const content = await readConfigFile(fileInfo);
    return NextResponse.json({ file: content });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// PUT - Save a file
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { path, content, createDirectories } = body;

    if (!path || content === undefined) {
      return NextResponse.json({ error: "path and content required" }, { status: 400 });
    }

    const result = await saveConfigFile({ path, content, createDirectories });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

// DELETE - Delete a file
export async function DELETE(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const filePath = searchParams.get("path");

  if (!filePath) {
    return NextResponse.json({ error: "path parameter required" }, { status: 400 });
  }

  try {
    const result = await deleteConfigFile(filePath);

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
