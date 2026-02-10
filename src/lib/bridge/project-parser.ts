import * as fs from "fs";
import * as path from "path";
import type { BridgeProject, BridgeProjectStatus, BridgeProjectsResponse } from "../types";

const VALID_STATUSES: Set<string> = new Set(["considering", "refining", "doing", "done"]);

/**
 * Parse a project index.md file into partial project data.
 * Returns extracted fields, or defaults for missing/invalid content.
 */
function parseIndexFile(content: string): { title: string | null; status: BridgeProjectStatus; area: string; tags: string[]; description: string } {
  let title: string | null = null;
  let status: BridgeProjectStatus = "considering";
  let area = "";
  let tags: string[] = [];
  let body = content;

  // Try parsing frontmatter
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
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

      if (fm.status && VALID_STATUSES.has(fm.status)) {
        status = fm.status as BridgeProjectStatus;
      }
      area = fm.area || "";
      if (fm.tags) {
        const tagsStr = fm.tags.replace(/^\[|\]$/g, "");
        tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);
      }

      // Body is everything after frontmatter
      body = content.slice(endIdx + 4);
      const h1Match = body.match(/^#\s+(.+)$/m);
      if (h1Match) title = h1Match[1].trim();
    }
  }

  // If no frontmatter or no H1 found yet, look for H1 in entire content
  if (!title) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }

  // Description: body text with H1 line removed
  const description = body.replace(/^#\s+.+$/m, "").trim();

  return { title, status, area, tags, description };
}

/**
 * Humanize a folder name for display (e.g., "everpro" → "EverPro", "priceless-misc" → "Priceless Misc").
 */
function humanizeFolderName(name: string): string {
  // Special cases
  const specials: Record<string, string> = { everpro: "EverPro" };
  if (specials[name]) return specials[name];

  return name
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Scan a single projects directory and return all projects found.
 */
function scanProjectsDir(
  projectsDir: string,
  vaultPath: string,
  source: string,
): BridgeProject[] {
  if (!fs.existsSync(projectsDir)) return [];

  const results: BridgeProject[] = [];
  const entries = fs.readdirSync(projectsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const projectDir = path.join(projectsDir, entry.name);
    const indexPath = path.join(projectDir, "index.md");
    const relativePath = path.relative(vaultPath, projectDir);

    let title = humanizeFolderName(entry.name);
    let status: BridgeProjectStatus = "considering";
    let area = "";
    let tags: string[] = [];
    let description = "";

    // Try to read index.md for richer metadata
    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, "utf-8");
        const parsed = parseIndexFile(content);
        if (parsed.title) title = parsed.title;
        status = parsed.status;
        area = parsed.area;
        tags = parsed.tags;
        description = parsed.description;
      } catch {
        // Use defaults
      }
    }

    results.push({
      slug: entry.name,
      path: projectDir,
      relativePath,
      title,
      status,
      area,
      tags,
      source,
      description,
    });
  }

  return results;
}

/**
 * Read all projects from the vault and group by status.
 * Scans top-level projects/ and each libraries/{name}/projects/ folder.
 */
export async function getAllProjects(vaultPath: string): Promise<BridgeProjectsResponse> {
  const columns: Record<BridgeProjectStatus, BridgeProject[]> = {
    considering: [],
    refining: [],
    doing: [],
    done: [],
  };

  // 1. Scan top-level projects/
  const topLevelProjects = scanProjectsDir(
    path.join(vaultPath, "projects"),
    vaultPath,
    "Projects",
  );
  for (const p of topLevelProjects) {
    columns[p.status].push(p);
  }

  // 2. Scan libraries/*/projects/
  const librariesDir = path.join(vaultPath, "libraries");
  if (fs.existsSync(librariesDir)) {
    const libEntries = fs.readdirSync(librariesDir, { withFileTypes: true });
    for (const libEntry of libEntries) {
      if (!libEntry.isDirectory() || libEntry.name.startsWith(".")) continue;

      const libProjectsDir = path.join(librariesDir, libEntry.name, "projects");
      const source = humanizeFolderName(libEntry.name);
      const libProjects = scanProjectsDir(libProjectsDir, vaultPath, source);
      for (const p of libProjects) {
        columns[p.status].push(p);
      }
    }
  }

  // Sort each column alphabetically by title
  for (const list of Object.values(columns)) {
    list.sort((a, b) => a.title.localeCompare(b.title));
  }

  return { vaultPath, columns };
}

/**
 * Update a project's status in its index.md frontmatter.
 * Creates index.md with frontmatter if it doesn't exist.
 */
export function updateProjectStatus(projectPath: string, newStatus: BridgeProjectStatus): void {
  const indexPath = path.join(projectPath, "index.md");

  if (!fs.existsSync(indexPath)) {
    // Create minimal index.md with frontmatter
    const slug = path.basename(projectPath);
    const title = humanizeFolderName(slug);
    const content = `---\nstatus: ${newStatus}\n---\n\n# ${title}\n`;
    fs.writeFileSync(indexPath, content, "utf-8");
    return;
  }

  const content = fs.readFileSync(indexPath, "utf-8");

  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const fmBlock = content.slice(4, endIdx);
      const lines = fmBlock.split("\n");
      let found = false;
      const updated = lines.map(line => {
        if (line.match(/^status\s*:/)) {
          found = true;
          return `status: ${newStatus}`;
        }
        return line;
      });
      if (!found) updated.push(`status: ${newStatus}`);
      const newContent = `---\n${updated.join("\n")}\n---${content.slice(endIdx + 4)}`;
      fs.writeFileSync(indexPath, newContent, "utf-8");
      return;
    }
  }

  // No frontmatter — prepend it
  const newContent = `---\nstatus: ${newStatus}\n---\n\n${content}`;
  fs.writeFileSync(indexPath, newContent, "utf-8");
}

// Re-export for backward compatibility (used by tests if any)
export { parseIndexFile as parseProjectIndex };
