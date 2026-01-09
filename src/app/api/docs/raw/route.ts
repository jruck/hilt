import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

// MIME types by extension
const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  pdf: "application/pdf",
  csv: "text/csv",
};

// Validate path is within scope (prevent directory traversal)
function isPathWithinScope(filePath: string, scope: string): boolean {
  const normalizedPath = path.resolve(filePath);
  const normalizedScope = path.resolve(scope);
  return normalizedPath.startsWith(normalizedScope + path.sep) || normalizedPath === normalizedScope;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const filePath = searchParams.get("path");
  const scope = searchParams.get("scope");

  if (!filePath) {
    return NextResponse.json(
      { error: "path parameter is required" },
      { status: 400 }
    );
  }

  if (!scope) {
    return NextResponse.json(
      { error: "scope parameter is required" },
      { status: 400 }
    );
  }

  // Security: validate path is within scope
  if (!isPathWithinScope(filePath, scope)) {
    return NextResponse.json(
      { error: "path must be within scope" },
      { status: 403 }
    );
  }

  try {
    const stats = fs.statSync(filePath);

    if (stats.isDirectory()) {
      return NextResponse.json(
        { error: "path must be a file, not a directory" },
        { status: 400 }
      );
    }

    const ext = path.extname(filePath).slice(1).toLowerCase();
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";

    // Read file as buffer
    const buffer = fs.readFileSync(filePath);

    // Return with appropriate headers
    return new NextResponse(buffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": buffer.length.toString(),
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }
    if ((error as NodeJS.ErrnoException).code === "EACCES") {
      return NextResponse.json(
        { error: "Permission denied" },
        { status: 403 }
      );
    }
    console.error("Error reading file:", error);
    return NextResponse.json(
      { error: "Failed to read file" },
      { status: 500 }
    );
  }
}
