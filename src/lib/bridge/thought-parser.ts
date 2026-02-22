import * as fs from "fs";
import * as path from "path";
import type { BridgeThought, BridgeThoughtStatus, BridgeThoughtsResponse } from "../types";

const VALID_STATUSES: Set<string> = new Set(["next", "later"]);

/**
 * Get the most recent mtime (ms) of any file in a directory (non-recursive, one level).
 * Falls back to directory mtime if empty.
 */
function getFolderUpdatedAt(dirPath: string): number {
  try {
    const dirStat = fs.statSync(dirPath);
    let latest = dirStat.mtimeMs;
    for (const name of fs.readdirSync(dirPath)) {
      if (name.startsWith(".")) continue;
      try {
        const st = fs.statSync(path.join(dirPath, name));
        if (st.mtimeMs > latest) latest = st.mtimeMs;
      } catch {
        // skip
      }
    }
    return latest;
  } catch {
    return 0;
  }
}

/**
 * Parse a thought index.md file.
 */
function parseIndexFile(content: string): {
  title: string | null;
  status: BridgeThoughtStatus;
  icon: string;
  created: string;
  description: string;
} {
  let title: string | null = null;
  let status: BridgeThoughtStatus = "later";
  let icon = "";
  let created = "";
  let body = content;

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
          status = normalized as BridgeThoughtStatus;
        }
      }
      icon = fm.icon || "";
      created = fm.created || "";

      body = content.slice(endIdx + 4);
      const h1Match = body.match(/^#\s+(.+)$/m);
      if (h1Match) title = h1Match[1].trim();
    }
  }

  if (!title) {
    const h1Match = content.match(/^#\s+(.+)$/m);
    if (h1Match) title = h1Match[1].trim();
  }

  const description = body.replace(/^#\s+.+$/m, "").trim();

  return { title, status, icon, created, description };
}

function humanizeFolderName(name: string): string {
  return name
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * Read all thoughts from the vault's thoughts/ directory.
 */
export async function getAllThoughts(vaultPath: string): Promise<BridgeThoughtsResponse> {
  const columns: Record<BridgeThoughtStatus, BridgeThought[]> = {
    next: [],
    later: [],
  };

  const thoughtsDir = path.join(vaultPath, "thoughts");
  if (!fs.existsSync(thoughtsDir)) return { vaultPath, columns };

  const entries = fs.readdirSync(thoughtsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

    const thoughtDir = path.join(thoughtsDir, entry.name);
    const indexPath = path.join(thoughtDir, "index.md");
    const relativePath = path.relative(vaultPath, thoughtDir);

    let title = humanizeFolderName(entry.name);
    let status: BridgeThoughtStatus = "later";
    let icon = "";
    let created = "";
    let description = "";

    if (fs.existsSync(indexPath)) {
      try {
        const content = fs.readFileSync(indexPath, "utf-8");
        const parsed = parseIndexFile(content);
        if (parsed.title) title = parsed.title;
        status = parsed.status;
        icon = parsed.icon;
        created = parsed.created;
        description = parsed.description;
      } catch {
        // Use defaults
      }
    }

    columns[status].push({
      slug: entry.name,
      path: thoughtDir,
      relativePath,
      title,
      status,
      icon,
      created,
      description,
      lastModified: getFolderUpdatedAt(thoughtDir),
    });
  }

  // Sort by most recently updated first
  for (const list of Object.values(columns)) {
    list.sort((a, b) => b.lastModified - a.lastModified);
  }

  return { vaultPath, columns };
}

/**
 * Update a thought's status in its index.md frontmatter.
 */
export function updateThoughtStatus(thoughtPath: string, newStatus: BridgeThoughtStatus): void {
  const indexPath = path.join(thoughtPath, "index.md");

  if (!fs.existsSync(indexPath)) {
    const slug = path.basename(thoughtPath);
    const title = humanizeFolderName(slug);
    const content = `---\ntype: thought\nstatus: ${newStatus}\n---\n\n# ${title}\n`;
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
      const updated = lines.map((line) => {
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

  const newContent = `---\ntype: thought\nstatus: ${newStatus}\n---\n\n${content}`;
  fs.writeFileSync(indexPath, newContent, "utf-8");
}
