import * as fs from "fs";
import * as path from "path";
import type { BridgeProject, BridgeProjectStatus, BridgeProjectsResponse } from "../types";

const VALID_STATUSES: Set<string> = new Set(["thinking", "refining", "scoping", "doing"]);

/**
 * Parse a project index.md file into a BridgeProject.
 * Returns null if the file doesn't have a valid status.
 */
export function parseProjectIndex(content: string, slug: string, projectPath: string): BridgeProject | null {
  // Parse frontmatter
  if (!content.startsWith("---")) return null;

  const endIdx = content.indexOf("\n---", 3);
  if (endIdx === -1) return null;

  const fmBlock = content.slice(4, endIdx);
  const fm: Record<string, string> = {};
  for (const line of fmBlock.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim();
      const value = line.slice(colonIdx + 1).trim();
      fm[key] = value;
    }
  }

  const status = fm.status;
  if (!status || !VALID_STATUSES.has(status)) return null;

  // Extract H1 title from body
  const body = content.slice(endIdx + 4);
  const h1Match = body.match(/^#\s+(.+)$/m);
  const title = h1Match ? h1Match[1].trim() : slug;

  // Parse tags (YAML array format: [tag1, tag2])
  let tags: string[] = [];
  if (fm.tags) {
    const tagsStr = fm.tags.replace(/^\[|\]$/g, "");
    tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
  }

  return {
    slug,
    path: projectPath,
    title,
    status: status as BridgeProjectStatus,
    area: fm.area || "",
    tags,
  };
}

/**
 * Read all projects from the vault and group by status.
 */
export async function getAllProjects(vaultPath: string): Promise<BridgeProjectsResponse> {
  const columns: Record<BridgeProjectStatus, BridgeProject[]> = {
    thinking: [],
    refining: [],
    scoping: [],
    doing: [],
  };

  // Scan projects directory
  const projectsDir = path.join(vaultPath, "projects");
  if (!fs.existsSync(projectsDir)) return { vaultPath, columns };

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const projectDir = path.join(projectsDir, entry.name);
    const indexPath = path.join(projectDir, "index.md");
    if (!fs.existsSync(indexPath)) continue;

    try {
      const content = fs.readFileSync(indexPath, "utf-8");
      const project = parseProjectIndex(content, entry.name, projectDir);
      if (project) {
        columns[project.status].push(project);
      }
    } catch {
      // Skip files that can't be read
    }
  }

  return { vaultPath, columns };
}
