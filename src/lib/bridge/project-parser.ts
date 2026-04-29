import * as fs from "fs";
import * as path from "path";
import type { BridgeProject, BridgeProjectStatus, BridgeProjectsResponse } from "../types";

const VALID_STATUSES: Set<string> = new Set(["considering", "refining", "doing", "done"]);

/** Map common status aliases to canonical board statuses */
const STATUS_ALIASES: Record<string, BridgeProjectStatus> = {
  "completed": "done",
  "complete": "done",
  "finished": "done",
  "shipped": "done",
  "in-progress": "doing",
  "active": "doing",
  "building": "doing",
  "thinking": "considering",
  "idea": "considering",
  "planned": "refining",
  "planning": "refining",
  "scoping": "refining",
  "designing": "refining",
};

function cleanFrontmatterScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) {
      return trimmed.slice(1, -1).trim();
    }
  }
  return trimmed;
}

function codePointFromHex(hex: string): string {
  const codePoint = Number.parseInt(hex, 16);
  if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) return "";
  return String.fromCodePoint(codePoint);
}

function decodeUnicodeEscapes(value: string): string {
  return value
    .replace(/\\+U([0-9a-fA-F]{8})/g, (_, hex: string) => codePointFromHex(hex))
    .replace(/\\+u\{([0-9a-fA-F]{1,6})\}/g, (_, hex: string) => codePointFromHex(hex))
    .replace(/\\+u([0-9a-fA-F]{4})/g, (_, hex: string) => codePointFromHex(hex))
    .replace(/\\"/g, "\"")
    .replace(/\\'/g, "'");
}

function normalizeIcon(value: string): string {
  const decoded = decodeUnicodeEscapes(cleanFrontmatterScalar(value)).trim();
  if (!decoded || decoded.includes("\n")) return "";

  const hasPictograph = (text: string) => /\p{Extended_Pictographic}/u.test(text);
  if (!hasPictograph(decoded)) return "";

  if (typeof Intl.Segmenter === "function") {
    const segmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
    for (const segment of segmenter.segment(decoded)) {
      if (hasPictograph(segment.segment)) return segment.segment;
    }
  }

  return decoded.match(/\p{Extended_Pictographic}/u)?.[0] ?? "";
}

/**
 * Parse a project index.md file into partial project data.
 * Returns extracted fields, or defaults for missing/invalid content.
 */
function parseIndexFile(content: string): { title: string | null; status: BridgeProjectStatus; area: string; icon: string; tags: string[]; description: string } {
  let title: string | null = null;
  let status: BridgeProjectStatus = "considering";
  let area = "";
  let icon = "";
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

      if (fm.status) {
        const normalized = fm.status.toLowerCase();
        if (VALID_STATUSES.has(normalized)) {
          status = normalized as BridgeProjectStatus;
        } else if (STATUS_ALIASES[normalized]) {
          status = STATUS_ALIASES[normalized];
        }
      }
      area = fm.area || "";
      icon = fm.icon ? normalizeIcon(fm.icon) : "";
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

  return { title, status, area, icon, tags, description };
}

/**
 * Humanize a folder name for display (e.g., "everpro" → "EverPro", "priceless-misc" → "Priceless Misc").
 */
function humanizeFolderName(name: string): string {
  // Special cases
  const specials: Record<string, string> = {
    cde: "CDE",
    cml: "CML",
    everpro: "EverPro",
    fftc: "FFTC",
    lanc: "LANC",
  };
  if (specials[name]) return specials[name];

  return name
    .split("-")
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Build project metadata from a single project folder.
 */
function getLatestMtime(dir: string, depth = 2): number {
  let latest = 0;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) continue;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isFile()) {
          const mt = fs.statSync(full).mtimeMs;
          if (mt > latest) latest = mt;
        } else if (entry.isDirectory() && depth > 0) {
          const sub = getLatestMtime(full, depth - 1);
          if (sub > latest) latest = sub;
        }
      } catch { /* skip unreadable */ }
    }
  } catch { /* skip unreadable */ }
  return latest;
}

function buildProject(
  projectDir: string,
  vaultPath: string,
  source: string,
): BridgeProject {
  const slug = path.basename(projectDir);
  const indexPath = path.join(projectDir, "index.md");
  const relativePath = path.relative(vaultPath, projectDir);

  let title = humanizeFolderName(slug);
  let status: BridgeProjectStatus = "considering";
  let area = "";
  let icon = "";
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
      icon = parsed.icon;
      tags = parsed.tags;
      description = parsed.description;
    } catch {
      // Use defaults
    }
  }

  return {
    slug,
    path: projectDir,
    relativePath,
    title,
    status,
    area,
    icon,
    tags,
    source,
    description,
    lastModified: getLatestMtime(projectDir),
  };
}

function getDirectoryEntries(dir: string): fs.Dirent[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true });
}

/**
 * Scan a single projects directory and return all projects found.
 */
function scanProjectsDir(
  projectsDir: string,
  vaultPath: string,
  source: string,
): BridgeProject[] {
  const entries = getDirectoryEntries(projectsDir);

  const results: BridgeProject[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    results.push(buildProject(path.join(projectsDir, entry.name), vaultPath, source));
  }

  return results;
}

/**
 * Scan clients/{client}/{project} folders. If a client has no child project
 * folders but does have its own index.md, include the client folder itself.
 */
function scanClientsDir(
  clientsDir: string,
  vaultPath: string,
  parentSource: string | null,
): BridgeProject[] {
  const clientEntries = getDirectoryEntries(clientsDir);
  const results: BridgeProject[] = [];

  for (const clientEntry of clientEntries) {
    if (!clientEntry.isDirectory() || clientEntry.name.startsWith(".")) continue;

    const clientDir = path.join(clientsDir, clientEntry.name);
    const clientName = humanizeFolderName(clientEntry.name);
    const source = parentSource ? `${parentSource} / ${clientName}` : clientName;
    const beforeCount = results.length;

    for (const entry of getDirectoryEntries(clientDir)) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name === "projects") continue;
      results.push(buildProject(path.join(clientDir, entry.name), vaultPath, source));
    }

    results.push(...scanProjectsDir(path.join(clientDir, "projects"), vaultPath, source));

    if (results.length === beforeCount && fs.existsSync(path.join(clientDir, "index.md"))) {
      results.push(buildProject(clientDir, vaultPath, parentSource ?? "Clients"));
    }
  }

  return results;
}

/**
 * Read all projects from the vault and group by status.
 * Scans root projects, client projects, library projects, and library client
 * projects.
 */
export async function getAllProjects(vaultPath: string): Promise<BridgeProjectsResponse> {
  const columns: Record<BridgeProjectStatus, BridgeProject[]> = {
    considering: [],
    refining: [],
    doing: [],
    done: [],
  };

  function addProjects(projects: BridgeProject[]) {
    for (const p of projects) {
      columns[p.status].push(p);
    }
  }

  // 1. Scan root-level projects/ and clients/
  addProjects(scanProjectsDir(path.join(vaultPath, "projects"), vaultPath, "Projects"));
  addProjects(scanClientsDir(path.join(vaultPath, "clients"), vaultPath, null));

  // 2. Scan libraries/*/projects/ and libraries/*/clients/
  const librariesDir = path.join(vaultPath, "libraries");
  for (const libEntry of getDirectoryEntries(librariesDir)) {
    if (!libEntry.isDirectory() || libEntry.name.startsWith(".")) continue;

    const libraryDir = path.join(librariesDir, libEntry.name);
    const source = humanizeFolderName(libEntry.name);
    addProjects(scanProjectsDir(path.join(libraryDir, "projects"), vaultPath, source));
    addProjects(scanClientsDir(path.join(libraryDir, "clients"), vaultPath, source));
  }

  // Fold legacy planning statuses into the active Projects list.
  for (const status of ["considering", "refining"] as const) {
    for (const p of columns[status]) {
      p.status = "doing";
      columns[p.status].push(p);
    }
    columns[status] = [];
  }

  // Sort each column by most recently updated first
  for (const list of Object.values(columns)) {
    list.sort((a, b) => b.lastModified - a.lastModified);
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
