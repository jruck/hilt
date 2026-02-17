import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

/**
 * Resolve vault-relative wikilink targets by walking up from the scope directory.
 * Used for Obsidian-style links like "libraries/everpro/..." that are relative
 * to the vault root, not the current scope.
 *
 * POST /api/docs/resolve-links
 * Body: { targets: string[], currentFile: string, scope: string }
 * Returns: { resolved: Record<string, string | null> }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { targets, currentFile, scope } = body;

    if (!Array.isArray(targets) || !currentFile || !scope) {
      return NextResponse.json(
        { error: "targets (array), currentFile, and scope are required" },
        { status: 400 }
      );
    }

    const resolved: Record<string, string | null> = {};
    const root = path.parse(scope).root;

    for (const target of targets) {
      if (typeof target !== "string") continue;
      resolved[target] = null;

      // Walk up from scope to find the file
      let walkDir = scope;
      for (let i = 0; i < 10 && walkDir !== root; i++) {
        walkDir = path.dirname(walkDir);

        // Try with common extensions
        const candidates = [
          path.join(walkDir, target),
          path.join(walkDir, `${target}.md`),
          path.join(walkDir, `${target}.markdown`),
          path.join(walkDir, target, "index.md"),
        ];

        for (const candidate of candidates) {
          try {
            const stat = fs.statSync(candidate);
            if (stat.isFile()) {
              resolved[target] = candidate;
              break;
            }
          } catch {
            // File doesn't exist at this level, continue
          }
        }

        if (resolved[target]) break;
      }
    }

    return NextResponse.json({ resolved });
  } catch (error) {
    console.error("Error resolving links:", error);
    return NextResponse.json(
      { error: "Failed to resolve links" },
      { status: 500 }
    );
  }
}
