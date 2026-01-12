import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import type { FileNode, DocsTreeResponse } from "@/lib/types";

// Directories to completely skip (dev tooling)
const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  ".cache",
  "__pycache__",
  ".DS_Store",
  "dist",
  "build",
  ".turbo",
  ".vercel",
  "coverage",
  ".nyc_output",
]);

// Exact directory names to show dimmed/unclickable (macOS system)
const IGNORED_DIRS_EXACT = new Set([
  // macOS home directory folders (avoid file descriptor exhaustion)
  "Applications",
  "Library",
  "System",
  "Movies",
  "Music",
  "Pictures",
  "Downloads",
  "Documents",
  "Desktop",
  "Public",
]);

// Partial matches for cloud sync folders (case-insensitive)
const IGNORED_DIRS_PATTERNS = [
  "onedrive",
  "google drive",
  "my drive",
  "creative cloud",
  "dropbox",
  "icloud drive",
  "box sync",
];

// Check if a directory name should be ignored
function isIgnoredDir(name: string): boolean {
  // Exact match for macOS system folders
  if (IGNORED_DIRS_EXACT.has(name)) return true;

  // Partial match for cloud sync folders (case-insensitive)
  const lowerName = name.toLowerCase();
  return IGNORED_DIRS_PATTERNS.some(pattern => lowerName.includes(pattern));
}

// Max recursion depth
const MAX_DEPTH = 15;

// Max files per directory (prevent huge directories from overwhelming)
const MAX_FILES_PER_DIR = 500;

function buildFileTree(
  dirPath: string,
  depth: number = 0
): { node: FileNode; maxModTime: number } {
  const stats = fs.statSync(dirPath);
  const name = path.basename(dirPath);
  let maxModTime = stats.mtimeMs;

  const node: FileNode = {
    name,
    path: dirPath,
    type: "directory",
    modTime: stats.mtimeMs,
    children: [],
  };

  if (depth >= MAX_DEPTH) {
    return { node, maxModTime };
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    const children: FileNode[] = [];
    let fileCount = 0;

    // Sort: directories first, then alphabetically
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });

    for (const entry of sorted) {
      // Skip hidden files and directories
      if (entry.name.startsWith(".")) continue;

      // Skip known problematic directories (dev tooling)
      if (SKIP_DIRS.has(entry.name)) continue;

      // Limit files per directory
      if (fileCount >= MAX_FILES_PER_DIR) break;

      const fullPath = path.join(dirPath, entry.name);

      try {
        if (entry.isDirectory()) {
          // Skip ignored directories entirely (macOS system, cloud sync)
          if (isIgnoredDir(entry.name)) continue;

          const result = buildFileTree(fullPath, depth + 1);
          children.push(result.node);
          maxModTime = Math.max(maxModTime, result.maxModTime);
        } else if (entry.isFile()) {
          const fileStats = fs.statSync(fullPath);
          const ext = path.extname(entry.name).slice(1).toLowerCase();

          children.push({
            name: entry.name,
            path: fullPath,
            type: "file",
            extension: ext || undefined,
            size: fileStats.size,
            modTime: fileStats.mtimeMs,
          });

          maxModTime = Math.max(maxModTime, fileStats.mtimeMs);
        }
        fileCount++;
      } catch {
        // Skip files we can't access
        continue;
      }
    }

    node.children = children;
  } catch {
    // Directory not readable
  }

  return { node, maxModTime };
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const scope = searchParams.get("scope");

  if (!scope) {
    return NextResponse.json(
      { error: "scope parameter is required" },
      { status: 400 }
    );
  }

  // Validate scope exists and is a directory
  try {
    const stats = fs.statSync(scope);
    if (!stats.isDirectory()) {
      return NextResponse.json(
        { error: "scope must be a directory" },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "scope directory does not exist" },
      { status: 404 }
    );
  }

  try {
    const { node: root, maxModTime } = buildFileTree(scope);

    const response: DocsTreeResponse = {
      root,
      scope,
      modTime: maxModTime,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error building file tree:", error);
    return NextResponse.json(
      { error: "Failed to build file tree" },
      { status: 500 }
    );
  }
}
