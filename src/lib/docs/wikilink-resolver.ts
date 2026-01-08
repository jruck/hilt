import type { FileNode } from "@/lib/types";
import * as path from "path";

export interface ResolvedLink {
  absolutePath: string | null;
  exists: boolean;
  displayName: string;
}

/**
 * Build a map of all files in the tree for fast lookup
 * Stores by: relative path from scope, filename, and filename without extension
 */
function buildFileMap(node: FileNode, scopePath: string, map: Map<string, string> = new Map()): Map<string, string> {
  if (node.type === "file") {
    // Store by relative path from scope (most specific, for paths like "Roadmap/index")
    const relativePath = node.path.startsWith(scopePath)
      ? node.path.slice(scopePath.length + 1)  // +1 to remove leading slash
      : node.path;
    const relativePathLower = relativePath.toLowerCase();
    const relativePathWithoutExt = relativePathLower.replace(/\.[^/.]+$/, "");

    // Store relative path without extension (highest priority for path-based links)
    if (!map.has(relativePathWithoutExt)) {
      map.set(relativePathWithoutExt, node.path);
    }

    // Store relative path with extension
    if (!map.has(relativePathLower)) {
      map.set(relativePathLower, node.path);
    }

    // Store by filename only (for simple [[filename]] links)
    const nameWithoutExt = node.name.replace(/\.[^/.]+$/, "");
    const nameLower = nameWithoutExt.toLowerCase();
    // Only store filename if not already present (first match wins for duplicates)
    if (!map.has(nameLower)) {
      map.set(nameLower, node.path);
    }

    // Also store with extension for exact matches
    const fullNameLower = node.name.toLowerCase();
    if (!map.has(fullNameLower)) {
      map.set(fullNameLower, node.path);
    }
  }

  if (node.children) {
    for (const child of node.children) {
      buildFileMap(child, scopePath, map);
    }
  }

  return map;
}

/**
 * Resolve a wikilink target to an absolute file path
 *
 * Resolution order:
 * 1. Explicit relative path from current file (e.g., [[./subfolder/file]])
 * 2. Absolute path within scope (e.g., [[/path/to/file]])
 * 3. Implicit relative path from current file (e.g., [[subfolder/file]] -> currentDir/subfolder/file)
 * 4. Path or filename match anywhere in scope (e.g., [[file]] -> /scope/somewhere/file.md)
 */
export function resolveWikilink(
  linkTarget: string,
  currentFilePath: string,
  scopePath: string,
  fileTree: FileNode | null
): ResolvedLink {
  // Extract display name if using [[target|display]] syntax
  const [target, displayOverride] = linkTarget.split("|").map(s => s.trim());
  const displayName = displayOverride || target;

  if (!target) {
    return { absolutePath: null, exists: false, displayName };
  }

  // 1. Try relative path from current file
  if (target.startsWith("./") || target.startsWith("../")) {
    const currentDir = path.dirname(currentFilePath);
    const resolved = path.resolve(currentDir, target);

    // Try with .md extension if not present
    const candidates = [
      resolved,
      `${resolved}.md`,
      `${resolved}.markdown`,
    ];

    for (const candidate of candidates) {
      if (candidate.startsWith(scopePath)) {
        // We can't check existence here without async, so return as potentially valid
        return { absolutePath: candidate, exists: true, displayName };
      }
    }
  }

  // 2. Try absolute path within scope
  if (target.startsWith("/")) {
    const resolved = path.join(scopePath, target);
    const candidates = [
      resolved,
      `${resolved}.md`,
      `${resolved}.markdown`,
    ];

    for (const candidate of candidates) {
      if (candidate.startsWith(scopePath)) {
        return { absolutePath: candidate, exists: true, displayName };
      }
    }
  }

  // 3. Try implicit relative path (e.g., [[subfolder/file]] from current directory)
  // This handles Obsidian-style links that are relative to the current file
  if (target.includes("/") && !target.startsWith("/") && fileTree) {
    const currentDir = path.dirname(currentFilePath);
    const resolved = path.resolve(currentDir, target);

    // Build file map to check if this path exists
    const fileMap = buildFileMap(fileTree, scopePath);
    const relativePath = resolved.startsWith(scopePath)
      ? resolved.slice(scopePath.length + 1).toLowerCase()
      : null;

    if (relativePath) {
      const candidates = [
        relativePath,
        `${relativePath}.md`,
        relativePath.replace(/\.[^/.]+$/, ""),  // without extension
      ];

      for (const candidate of candidates) {
        const match = fileMap.get(candidate);
        if (match) {
          return { absolutePath: match, exists: true, displayName };
        }
      }
    }
  }

  // 4. Path or filename match in file tree
  if (fileTree) {
    const fileMap = buildFileMap(fileTree, scopePath);
    const targetLower = target.toLowerCase();

    // Try exact match first
    let match = fileMap.get(targetLower);

    // Try with .md extension
    if (!match) {
      match = fileMap.get(`${targetLower}.md`);
    }

    // Try without extension
    const targetWithoutExt = targetLower.replace(/\.[^/.]+$/, "");
    if (!match) {
      match = fileMap.get(targetWithoutExt);
    }

    // Try just the filename part if target includes a path (e.g., "Knowledge/AI Analysis")
    if (!match && target.includes("/")) {
      const filenameOnly = target.split("/").pop()?.toLowerCase() || "";
      match = fileMap.get(filenameOnly);
      if (!match) {
        match = fileMap.get(`${filenameOnly}.md`);
      }
      // Also try without extension
      const filenameWithoutExt = filenameOnly.replace(/\.[^/.]+$/, "");
      if (!match) {
        match = fileMap.get(filenameWithoutExt);
      }
    }

    if (match) {
      return { absolutePath: match, exists: true, displayName };
    }
  }

  // Not found
  return { absolutePath: null, exists: false, displayName };
}

/**
 * Parse wikilinks from markdown content
 * Returns array of { start, end, target, display }
 */
export interface ParsedWikilink {
  start: number;
  end: number;
  target: string;
  display: string;
  raw: string;
}

export function parseWikilinks(content: string): ParsedWikilink[] {
  const regex = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const links: ParsedWikilink[] = [];

  let match;
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].trim();
    const display = match[2]?.trim() || target;

    links.push({
      start: match.index,
      end: match.index + match[0].length,
      target,
      display,
      raw: match[0],
    });
  }

  return links;
}
