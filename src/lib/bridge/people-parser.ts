import * as fs from "fs";
import * as path from "path";
import type {
  BridgePerson,
  BridgePeopleResponse,
  PersonMeeting,
  PersonDetail,
} from "../types";

/**
 * Parse people/index.md to extract slug → description mapping.
 * Lines like: - [[amrit]] — Product counterpart
 */
export function parsePeopleIndex(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  const regex = /^\s*-\s*\[\[([^\]]+)\]\]\s*(?:—|--)\s*(.+)$/gm;
  let match;
  while ((match = regex.exec(content)) !== null) {
    result[match[1].trim()] = match[2].trim();
  }
  return result;
}

/**
 * Parse frontmatter from a markdown file. Returns key-value pairs and the body after frontmatter.
 */
function parseFrontmatter(content: string): { fm: Record<string, string>; body: string } {
  const fm: Record<string, string> = {};
  let body = content;

  if (content.startsWith("---")) {
    const endIdx = content.indexOf("\n---", 3);
    if (endIdx !== -1) {
      const fmBlock = content.slice(4, endIdx);
      for (const line of fmBlock.split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const value = line.slice(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
          fm[key] = value;
        }
      }
      body = content.slice(endIdx + 4);
    }
  }

  return { fm, body };
}

/**
 * Parse an individual person .md file into a BridgePerson.
 */
export function parsePersonFile(
  content: string,
  slug: string,
  description: string,
): BridgePerson {
  const { fm, body } = parseFrontmatter(content);

  // Type: "meeting" in frontmatter maps to "group"
  const rawType = (fm.type || "person").toLowerCase();
  const type: "person" | "group" = rawType === "meeting" ? "group" : rawType === "group" ? "group" : "person";

  const created = fm.created || fm.date || "";
  const updated = fm.updated || fm.created || fm.date || "";

  // Extract H1 as name
  const h1Match = body.match(/^#\s+(.+)$/m);
  const name = h1Match ? h1Match[1].trim() : slug;

  // Extract ## Next section bullets
  const nextTopics: string[] = [];
  const nextMatch = body.match(/^##\s+Next\s*\n([\s\S]*?)(?=\n##\s)/m);
  if (nextMatch) {
    const nextBlock = nextMatch[1];
    for (const line of nextBlock.split("\n")) {
      const bulletMatch = line.match(/^\s*-\s+(.+)/);
      if (bulletMatch) {
        nextTopics.push(bulletMatch[1].trim());
      }
    }
  }

  // Count dated entries in ## Notes for meetingCount and find lastMeetingDate
  const datedEntryRegex = /^###\s+(\d{4}-\d{2}-\d{2})/gm;
  let meetingCount = 0;
  let lastMeetingDate: string | null = null;
  let dateMatch;
  while ((dateMatch = datedEntryRegex.exec(body)) !== null) {
    meetingCount++;
    const date = dateMatch[1];
    if (!lastMeetingDate || date > lastMeetingDate) {
      lastMeetingDate = date;
    }
  }

  return {
    slug,
    name,
    type,
    description,
    nextTopics,
    meetingCount,
    lastMeetingDate,
    created,
    updated,
  };
}

/**
 * Match meeting filenames to a person by checking tokens against slug and name parts.
 * Splits filename on __, spaces, dots, "and", then checks case-insensitive.
 */
export function matchMeetingsToSlug(
  slug: string,
  name: string,
  meetingFiles: string[],
): string[] {
  const slugLower = slug.toLowerCase();
  const nameParts = name.toLowerCase().split(/\s+/);

  // For multi-word names, require multiple name parts to match to avoid
  // false positives from short common words like "AI" matching everything.
  // Single-word names (e.g., "Amrit") still match on one token.
  const minMatchCount = nameParts.length >= 3 ? 2 : 1;

  return meetingFiles.filter((filename) => {
    // Remove .md extension and date suffixes for tokenizing
    const base = filename.replace(/\.md$/, "");
    // Split on __, spaces, dots, "and" (as word), hyphens-followed-by-date patterns
    const tokens = base
      .split(/__|\.|\s+and\s+|\s+/i)
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);

    // Slug match is always sufficient
    if (tokens.some((token) => token === slugLower)) return true;

    // Count how many distinct name parts appear in the tokens
    const matchedParts = nameParts.filter((np) =>
      tokens.some((token) => token === np)
    );
    return matchedParts.length >= minMatchCount;
  });
}

/**
 * Parse meeting file frontmatter for Granola meeting details.
 */
export function parseMeetingFrontmatter(content: string): {
  title: string;
  created: string;
  transcript: string;
  granolaId: string;
} {
  const { fm } = parseFrontmatter(content);
  return {
    title: fm.title || "",
    created: fm.created || "",
    transcript: fm.transcript
      ? fm.transcript.replace(/^\[\[|\]\]$/g, "")
      : "",
    granolaId: fm.granola_id || "",
  };
}

/**
 * Collect all meeting .md files from the meetings directory.
 * Supports both flat files (legacy) and date-subfolder structure (Granola resync).
 * Returns objects with `filename` (for matching) and `fullPath` (for reading).
 */
function collectMeetingFiles(meetingsDir: string): { filename: string; fullPath: string }[] {
  if (!fs.existsSync(meetingsDir)) return [];
  const results: { filename: string; fullPath: string }[] = [];
  try {
    for (const entry of fs.readdirSync(meetingsDir)) {
      if (entry.startsWith(".") || entry === "transcripts") continue;
      const entryPath = path.join(meetingsDir, entry);
      const stat = fs.statSync(entryPath);
      if (stat.isFile() && entry.endsWith(".md")) {
        // Legacy flat file
        results.push({ filename: entry, fullPath: entryPath });
      } else if (stat.isDirectory()) {
        // Date subfolder — collect .md files inside
        try {
          for (const sub of fs.readdirSync(entryPath)) {
            if (sub.endsWith(".md") && !sub.startsWith(".")) {
              results.push({ filename: sub, fullPath: path.join(entryPath, sub) });
            }
          }
        } catch {
          // Skip unreadable subfolder
        }
      }
    }
  } catch {
    // Continue without meetings
  }
  return results;
}

/**
 * Get all people from the vault, sorted by name.
 */
export async function getAllPeople(
  vaultPath: string,
): Promise<BridgePeopleResponse> {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");

  // Read index
  const indexPath = path.join(peopleDir, "index.md");
  let indexMap: Record<string, string> = {};
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      indexMap = parsePeopleIndex(indexContent);
    } catch {
      // Continue with empty index
    }
  }

  // Get meeting files for counting (supports nested date folders)
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);
  const meetingFileMap = new Map(meetingFileEntries.map((e) => [e.filename, e.fullPath]));

  // Read each person file
  const people: BridgePerson[] = [];
  const entries = fs.existsSync(peopleDir)
    ? fs.readdirSync(peopleDir).filter((f) => f.endsWith(".md") && f !== "index.md" && !f.startsWith("."))
    : [];

  for (const filename of entries) {
    const slug = filename.replace(/\.md$/, "");
    const filePath = path.join(peopleDir, filename);

    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const description = indexMap[slug] || "";
      const person = parsePersonFile(content, slug, description);

      // Add Granola meeting count
      const matchedMeetings = matchMeetingsToSlug(
        slug,
        person.name,
        meetingFilenames,
      );
      person.meetingCount += matchedMeetings.length;

      // Update lastMeetingDate from Granola meetings if newer
      for (const mf of matchedMeetings) {
        const mfPath = meetingFileMap.get(mf);
        if (!mfPath) continue;
        try {
          const mfContent = fs.readFileSync(mfPath, "utf-8");
          const mfMeta = parseMeetingFrontmatter(mfContent);
          if (mfMeta.created) {
            const date = mfMeta.created.slice(0, 10); // YYYY-MM-DD
            if (!person.lastMeetingDate || date > person.lastMeetingDate) {
              person.lastMeetingDate = date;
            }
          }
        } catch {
          // Skip unreadable meeting
        }
      }

      people.push(person);
    } catch {
      // Skip unreadable person file
    }
  }

  // Sort by most recently updated (lastMeetingDate descending, then name)
  people.sort((a, b) => {
    const dateA = a.lastMeetingDate || "";
    const dateB = b.lastMeetingDate || "";
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return a.name.localeCompare(b.name);
  });

  return { vaultPath, people };
}

/**
 * Parse the ## Next section to extract an optional date and the content body.
 * Format: first line may be "date: YYYY-MM-DD", rest is content.
 */
export function parseNextSection(nextRaw: string): { date: string | null; content: string } {
  const lines = nextRaw.split("\n");
  const dateMatch = lines[0]?.match(/^date:\s*(\d{4}-\d{2}-\d{2})\s*$/);
  if (dateMatch) {
    return {
      date: dateMatch[1],
      content: lines.slice(1).join("\n").trim(),
    };
  }
  return { date: null, content: nextRaw.trim() };
}

/**
 * Decay the ## Next section: move its content into ## Notes ### YYYY-MM-DD,
 * then clear ## Next. Returns the updated file content.
 */
export function decayNext(fileContent: string, date: string): string {
  const { body } = parseFrontmatter(fileContent);
  const nextRawMatch = body.match(/^##\s+Next\s*\n([\s\S]*?)(?=\n##\s)/m);
  if (!nextRawMatch) return fileContent;

  const { content } = parseNextSection(nextRawMatch[1].trim());
  if (!content) return fileContent; // Nothing to decay

  // Insert content as a dated notes section, then clear Next
  let updated = updatePersonNotes(fileContent, date, content);
  updated = updatePersonNext(updated, "");
  return updated;
}

/**
 * Delete a dated notes section (### YYYY-MM-DD) from a person's markdown file.
 * Removes the heading and all content until the next ### or end of ## Notes.
 */
export function deletePersonNotes(fileContent: string, date: string): string {
  const { fm, body } = parseFrontmatter(fileContent);

  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  const escapedDate = date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const sectionRegex = new RegExp(
    `\\n?###\\s+${escapedDate}[^\\n]*\\n[\\s\\S]*?(?=\\n###\\s|$)`,
    "m"
  );

  const updatedBody = body.replace(sectionRegex, "");
  return fmBlock + updatedBody;
}

/**
 * Update a specific dated notes section in a person's markdown file.
 * Finds ### YYYY-MM-DD and replaces the content until the next ### or end of file.
 */
export function updatePersonNotes(
  fileContent: string,
  date: string,
  newNotes: string,
): string {
  const { fm, body } = parseFrontmatter(fileContent);

  // Reconstruct frontmatter
  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  // Find the ### date section and replace its content
  const sectionRegex = new RegExp(
    `(^###\\s+${date.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\n]*\\n)([\\s\\S]*?)(?=\\n###\\s|$)`,
    "m"
  );

  const match = body.match(sectionRegex);
  if (match) {
    const updatedBody = body.replace(sectionRegex, `$1\n${newNotes}\n`);
    return fmBlock + updatedBody;
  }

  // Section not found — append to end of ## Notes
  const notesHeaderMatch = body.match(/^(##\s+Notes\s*\n)/m);
  if (notesHeaderMatch) {
    const insertPos = body.indexOf(notesHeaderMatch[0]) + notesHeaderMatch[0].length;
    const before = body.slice(0, insertPos);
    const after = body.slice(insertPos);
    return fmBlock + before + `\n### ${date}\n\n${newNotes}\n` + after;
  }

  // No ## Notes section — append one
  return fmBlock + body + `\n\n## Notes\n\n### ${date}\n\n${newNotes}\n`;
}

/**
 * Update the ## Next section in a person's markdown file.
 * Finds ## Next and replaces content until the next ## heading.
 */
export function updatePersonNext(
  fileContent: string,
  newNext: string,
): string {
  const { fm, body } = parseFrontmatter(fileContent);

  // Reconstruct frontmatter
  let fmBlock = "";
  if (Object.keys(fm).length > 0) {
    fmBlock = "---\n";
    for (const [key, value] of Object.entries(fm)) {
      fmBlock += `${key}: ${value}\n`;
    }
    fmBlock += "---\n";
  }

  // Find ## Next section and replace its content
  const nextRegex = /^(##\s+Next\s*\n)([\s\S]*?)(?=\n##\s)/m;
  const match = body.match(nextRegex);
  if (match) {
    const updatedBody = body.replace(nextRegex, `$1\n${newNext}\n`);
    return fmBlock + updatedBody;
  }

  // No ## Next section — insert before ## Notes (or append)
  const notesHeaderMatch = body.match(/^(##\s+Notes)/m);
  if (notesHeaderMatch) {
    const insertPos = body.indexOf(notesHeaderMatch[0]);
    const before = body.slice(0, insertPos);
    const after = body.slice(insertPos);
    return fmBlock + before + `## Next\n\n${newNext}\n\n` + after;
  }

  // No ## Notes either — append
  return fmBlock + body + `\n\n## Next\n\n${newNext}\n`;
}

/**
 * Get full detail for a single person, including meeting timeline.
 */
export async function getPersonDetail(
  vaultPath: string,
  slug: string,
): Promise<PersonDetail | null> {
  const peopleDir = path.join(vaultPath, "people");
  const meetingsDir = path.join(vaultPath, "meetings");

  // Read index for description
  const indexPath = path.join(peopleDir, "index.md");
  let description = "";
  if (fs.existsSync(indexPath)) {
    try {
      const indexContent = fs.readFileSync(indexPath, "utf-8");
      const indexMap = parsePeopleIndex(indexContent);
      description = indexMap[slug] || "";
    } catch {
      // Continue
    }
  }

  // Read person file
  const filePath = path.join(peopleDir, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  // eslint-disable-next-line prefer-const
  let person = parsePersonFile(content, slug, description);

  // Extract raw ## Next section and parse date
  const { body } = parseFrontmatter(content);
  const nextRawMatch = body.match(/^##\s+Next\s*\n([\s\S]*?)(?=\n##\s)/m);
  let nextRaw = nextRawMatch ? nextRawMatch[1].trim() : "";
  let parsedNext = parseNextSection(nextRaw);

  // Auto-decay: if Next has a past date, move content to Notes
  const today = new Date().toISOString().slice(0, 10);
  if (parsedNext.date && parsedNext.date < today) {
    const decayedContent = decayNext(content, parsedNext.date);
    // Atomic rewrite
    const tmpPath = filePath + ".tmp." + Date.now();
    fs.writeFileSync(tmpPath, decayedContent, "utf-8");
    fs.renameSync(tmpPath, filePath);
    // Re-read and re-parse after decay
    content = decayedContent;
    person = parsePersonFile(content, slug, description);
    const { body: newBody } = parseFrontmatter(content);
    const newNextMatch = newBody.match(/^##\s+Next\s*\n([\s\S]*?)(?=\n##\s)/m);
    nextRaw = newNextMatch ? newNextMatch[1].trim() : "";
    parsedNext = parseNextSection(nextRaw);
  }

  // Extract inline meetings from ## Notes section
  const meetings: PersonMeeting[] = [];
  const notesMatch = body.match(/^##\s+Notes\s*\n([\s\S]*)/m);
  if (notesMatch) {
    const notesBlock = notesMatch[1];
    // Split into dated sections
    const sections = notesBlock.split(/(?=^###\s+\d{4}-\d{2}-\d{2})/m);
    for (const section of sections) {
      const dateMatch = section.match(/^###\s+(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        const date = dateMatch[1];
        // Notes content is everything after the ### heading line
        const notes = section.replace(/^###\s+.+\n?/, "").trim();
        meetings.push({
          source: "inline",
          date,
          title: "Notes",
          notes,
        });
      }
    }
  }

  // Match Granola meetings (supports nested date folders)
  const meetingFileEntries = collectMeetingFiles(meetingsDir);
  const meetingFilenames = meetingFileEntries.map((e) => e.filename);
  const meetingFileMap = new Map(meetingFileEntries.map((e) => [e.filename, e.fullPath]));

  const matchedMeetings = matchMeetingsToSlug(slug, person.name, meetingFilenames);
  for (const mf of matchedMeetings) {
    const mfPath = meetingFileMap.get(mf);
    if (!mfPath) continue;
    try {
      const mfContent = fs.readFileSync(mfPath, "utf-8");
      const mfMeta = parseMeetingFrontmatter(mfContent);
      const date = mfMeta.created ? mfMeta.created.slice(0, 10) : "";
      const { body: mfBody } = parseFrontmatter(mfContent);
      const summary = mfBody.trim();

      meetings.push({
        source: "granola",
        date,
        title: mfMeta.title || mf.replace(/\.md$/, ""),
        filePath: mfPath,
        transcriptPath: mfMeta.transcript
          ? path.join(vaultPath, mfMeta.transcript)
          : undefined,
        summary,
      });
    } catch {
      // Skip unreadable meeting
    }
  }

  // Sort newest first
  meetings.sort((a, b) => b.date.localeCompare(a.date));

  // Update counts to reflect total
  const totalMeetings = meetings.length;
  const latestDate = meetings.length > 0 ? meetings[0].date : null;

  return {
    ...person,
    meetingCount: totalMeetings,
    lastMeetingDate: latestDate,
    nextRaw,
    meetings,
    personFilePath: filePath,
  };
}
