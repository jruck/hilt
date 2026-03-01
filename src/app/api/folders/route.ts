import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import os from "os";
import { execSync } from "child_process";
import { getAllPreferences, getActiveFolder } from "@/lib/db";

// Decode an encoded path by checking against filesystem
// Claude Code encodes paths by replacing / with -, but folder names can contain hyphens
// So we need to find the actual path that exists
function decodePath(encoded: string): string | null {
  // Remove leading hyphen and split by hyphen, filtering empty parts
  const parts = encoded.slice(1).split("-").filter(Boolean);

  // Try to reconstruct the path by checking which combinations exist
  let currentPath = "";
  let i = 0;

  while (i < parts.length) {
    // Try progressively longer hyphenated names
    let found = false;
    for (let j = parts.length; j > i; j--) {
      const segment = parts.slice(i, j).join("-");
      const testPath = currentPath + "/" + segment;

      if (fs.existsSync(testPath)) {
        currentPath = testPath;
        i = j;
        found = true;
        break;
      }
    }

    if (!found) {
      // Single segment (might not exist yet, but continue)
      currentPath = currentPath + "/" + parts[i];
      i++;
    }
  }

  // Verify the final path exists
  if (fs.existsSync(currentPath)) {
    return currentPath;
  }

  return null;
}

// Get all project folders from ~/.claude/projects
async function getProjectFolders(): Promise<string[]> {
  const claudeProjectsDir = path.join(os.homedir(), ".claude", "projects");

  if (!fs.existsSync(claudeProjectsDir)) {
    return [];
  }

  const entries = fs.readdirSync(claudeProjectsDir, { withFileTypes: true });
  const folderSet = new Set<string>();

  for (const entry of entries) {
    if (entry.isDirectory()) {
      // Skip the root directory marker
      if (entry.name === "-") continue;

      // Decode the folder name back to a path
      const decodedPath = decodePath(entry.name);
      if (decodedPath && decodedPath !== "/") {
        // Use Set to automatically dedupe (multiple encoded names can decode to same path)
        folderSet.add(decodedPath);
      }
    }
  }

  const folders = Array.from(folderSet);

  // Sort by path depth (shallower first) then alphabetically
  folders.sort((a, b) => {
    const depthA = a.split("/").length;
    const depthB = b.split("/").length;
    if (depthA !== depthB) return depthA - depthB;
    return a.localeCompare(b);
  });

  return folders;
}

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const validatePath = searchParams.get("validate");
    const scopePath = searchParams.get("scope");

    // If validating a specific path
    if (validatePath) {
      const exists = fs.existsSync(validatePath);
      const isDirectory = exists && fs.statSync(validatePath).isDirectory();
      return NextResponse.json({
        path: validatePath,
        exists,
        isDirectory,
        valid: exists && isDirectory,
      });
    }

    // Get all project folders
    let folders = await getProjectFolders();
    const homeDir = os.homedir();
    const prefs = await getAllPreferences();
    // Prefer active source folder, then preferences, then null
    const workingFolder = getActiveFolder() || prefs.workingFolder || null;

    // Filter to only show folders under the current scope (children only, not the scope itself)
    if (scopePath) {
      folders = folders.filter(f => f.startsWith(scopePath) && f !== scopePath);
    }

    return NextResponse.json({
      folders,
      homeDir,
      workingFolder,
    });
  } catch (error) {
    console.error("Error fetching folders:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}

// POST - Open native folder picker dialog (macOS)
export async function POST() {
  try {
    // Use osascript to open native macOS folder picker
    const script = `
      set chosenFolder to choose folder with prompt "Select project folder"
      return POSIX path of chosenFolder
    `;

    const result = execSync(`osascript -e '${script}'`, {
      encoding: "utf-8",
      timeout: 60000, // 60 second timeout for user to pick folder
    });

    // Remove trailing newline and slash
    let folderPath = result.trim();
    if (folderPath.endsWith("/") && folderPath.length > 1) {
      folderPath = folderPath.slice(0, -1);
    }

    return NextResponse.json({ path: folderPath });
  } catch (error: unknown) {
    // User cancelled or error occurred
    const err = error as { status?: number; message?: string };
    if (err.status === 1) {
      // User cancelled
      return NextResponse.json({ cancelled: true });
    }
    console.error("Error opening folder picker:", error);
    return NextResponse.json(
      { error: "Failed to open folder picker" },
      { status: 500 }
    );
  }
}
