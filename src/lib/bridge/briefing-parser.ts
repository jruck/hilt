/**
 * Parse daily briefing MDX files from bridge/briefings/.
 */

import { readVaultFile, listVaultDir, writeVaultFileAtomic } from "./vault";

export interface BriefingMeta {
  date: string;       // YYYY-MM-DD
  title: string;
  author: string;
  readAt: string | null;  // ISO timestamp or null
  filename: string;
}

export interface BriefingFull extends BriefingMeta {
  content: string;    // raw MDX body (after frontmatter)
}

export interface BriefingsListResponse {
  briefings: BriefingMeta[];
  latest: BriefingMeta | null;
}

/**
 * Parse YAML frontmatter from a briefing file.
 */
function parseFrontmatter(content: string): [Record<string, string | null>, string] {
  const fm: Record<string, string | null> = {};
  if (!content.startsWith("---")) return [fm, content];
  const endIdx = content.indexOf("---", 3);
  if (endIdx === -1) return [fm, content];

  const fmBlock = content.slice(3, endIdx).trim();
  const body = content.slice(endIdx + 3).trim();

  for (const line of fmBlock.split("\n")) {
    const sep = line.indexOf(":");
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim();
    let value: string | null = line.slice(sep + 1).trim();
    // Remove quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value === "null" || value === "") value = null;
    fm[key] = value;
  }

  return [fm, body];
}

/**
 * List all briefings, sorted by date descending.
 */
export async function listBriefings(limit = 30): Promise<BriefingsListResponse> {
  let files: string[];
  try {
    files = await listVaultDir("briefings");
  } catch {
    return { briefings: [], latest: null };
  }

  const mdxFiles = files
    .filter(f => f.endsWith(".mdx") || f.endsWith(".md"))
    .sort()
    .reverse();

  const briefings: BriefingMeta[] = [];

  for (const filename of mdxFiles.slice(0, limit)) {
    try {
      const content = await readVaultFile(`briefings/${filename}`);
      const [fm] = parseFrontmatter(content);
      const date = fm.date ?? filename.replace(/\.(mdx|md)$/, "");
      briefings.push({
        date,
        title: fm.title ?? "Daily Briefing",
        author: fm.author ?? "bridge",
        readAt: fm.readAt ?? null,
        filename,
      });
    } catch {
      // Skip unreadable files
    }
  }

  return {
    briefings,
    latest: briefings[0] ?? null,
  };
}

/**
 * Get a single briefing by date.
 */
export async function getBriefing(date: string): Promise<BriefingFull | null> {
  let files: string[];
  try {
    files = await listVaultDir("briefings");
  } catch {
    return null;
  }

  // Try .mdx first, then .md
  const filename = files.find(f => f === `${date}.mdx`) ?? files.find(f => f === `${date}.md`);
  if (!filename) return null;

  const content = await readVaultFile(`briefings/${filename}`);
  const [fm, body] = parseFrontmatter(content);

  return {
    date: fm.date ?? date,
    title: fm.title ?? "Daily Briefing",
    author: fm.author ?? "bridge",
    readAt: fm.readAt ?? null,
    filename,
    content: body,
  };
}

/**
 * Mark a briefing as read by writing readAt to frontmatter.
 */
export async function markBriefingRead(date: string): Promise<boolean> {
  let files: string[];
  try {
    files = await listVaultDir("briefings");
  } catch {
    return false;
  }

  const filename = files.find(f => f === `${date}.mdx`) ?? files.find(f => f === `${date}.md`);
  if (!filename) return false;

  const content = await readVaultFile(`briefings/${filename}`);
  const now = new Date().toISOString();

  let updated: string;
  if (content.startsWith("---")) {
    const endIdx = content.indexOf("---", 3);
    if (endIdx === -1) return false;

    const fmBlock = content.slice(3, endIdx);
    const body = content.slice(endIdx);

    // Replace or add readAt
    if (fmBlock.includes("readAt:")) {
      updated = "---" + fmBlock.replace(/readAt:.*/, `readAt: "${now}"`) + body;
    } else {
      updated = "---" + fmBlock.trimEnd() + `\nreadAt: "${now}"\n` + body;
    }
  } else {
    // No frontmatter — add it
    updated = `---\nreadAt: "${now}"\n---\n\n${content}`;
  }

  await writeVaultFileAtomic(`briefings/${filename}`, updated);
  return true;
}
