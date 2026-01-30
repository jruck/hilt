import * as fs from "fs";
import * as path from "path";
import { DerivedSessionState, SummaryEntrySchema } from "./types";
import { parseJSONLEntries, deriveSessionState } from "./session-status";

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "projects"
);

/**
 * Encode a project path to Claude's folder name format
 * e.g., "/Users/jruck/Bridge" -> "-Users-jruck-Bridge"
 */
function encodeProjectPath(projectPath: string): string {
  return projectPath.replace(/\//g, "-");
}

/**
 * Get the JSONL file path for a known session ID and project path.
 * Returns null if the file doesn't exist.
 */
export function getSessionJSONLPath(sessionId: string, projectPath: string): string | null {
  const folderName = encodeProjectPath(projectPath);
  const filePath = path.join(CLAUDE_PROJECTS_DIR, folderName, `${sessionId}.jsonl`);
  if (fs.existsSync(filePath)) {
    return filePath;
  }
  return null;
}

/**
 * Parse a session file synchronously for metadata updates (title, slug, messageCount, etc.)
 * Used to keep registry data fresh for running sessions.
 */
export function parseSessionFileForMetadata(
  sessionId: string,
  projectPath: string
): {
  title: string;
  messageCount: number;
  slug: string | null;
  slugs: string[];
  gitBranch: string | null;
  lastPrompt: string | null;
  lastMessage: string | null;
} | null {
  const filePath = getSessionJSONLPath(sessionId, projectPath);
  if (!filePath) return null;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    let summary: string | null = null;
    let customTitle: string | null = null;
    let firstPrompt: string | null = null;
    let lastPrompt: string | null = null;
    let lastMessage: string | null = null;
    let messageCount = 0;
    let gitBranch: string | null = null;
    let slug: string | null = null;
    const slugs = new Set<string>();

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);

        if (entry.type === "custom-title" && entry.customTitle) {
          customTitle = entry.customTitle;
        }

        if (entry.type === "summary") {
          if (entry.summary) summary = entry.summary;
        }

        if (entry.type === "user" || entry.type === "assistant") {
          messageCount++;

          if (entry.gitBranch && !gitBranch) {
            gitBranch = entry.gitBranch;
          }

          if (entry.slug) {
            slugs.add(entry.slug);
            if (!slug) slug = entry.slug;
          }

          if (entry.type === "user" && entry.message?.content) {
            const msgContent = entry.message.content;
            let promptText: string | null = null;

            if (typeof msgContent === "string") {
              promptText = msgContent.slice(0, 200);
            } else if (Array.isArray(msgContent)) {
              const textBlock = msgContent.find(
                (block: { type?: string; text?: string }) => block.type === "text" && block.text
              );
              if (textBlock?.text) {
                promptText = textBlock.text.slice(0, 200);
              }
            }

            if (promptText && !(
              promptText.startsWith("Caveat: ") ||
              promptText.startsWith("<command-name>") ||
              promptText.startsWith("<local-command-stdout>") ||
              promptText.startsWith("<system-reminder>")
            )) {
              if (!firstPrompt) firstPrompt = promptText;
              lastPrompt = promptText;
              lastMessage = promptText;
            }
          }

          if (entry.type === "assistant" && entry.message?.content) {
            const msgContent = entry.message.content;
            if (Array.isArray(msgContent)) {
              const textBlock = msgContent.find(
                (block: { type?: string; text?: string }) => block.type === "text" && block.text
              );
              if (textBlock?.text) {
                lastMessage = textBlock.text.slice(0, 200);
              }
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    if (messageCount === 0) return null;

    return {
      title: customTitle || summary || firstPrompt?.slice(0, 50) || "Untitled Session",
      messageCount,
      slug,
      slugs: Array.from(slugs),
      gitBranch,
      lastPrompt,
      lastMessage,
    };
  } catch {
    return null;
  }
}

/**
 * Get derived state for a session by reading its JSONL file.
 * Only call this for running/active sessions to avoid performance issues.
 * If projectPath is provided, looks up the file directly (fast path).
 */
export function getSessionDerivedState(sessionId: string, projectPath?: string): DerivedSessionState | null {
  // Fast path: direct lookup using known project path
  if (projectPath) {
    const filePath = getSessionJSONLPath(sessionId, projectPath);
    if (filePath) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const entries = parseJSONLEntries(content);
        return deriveSessionState(entries);
      } catch {
        return null;
      }
    }
    return null;
  }

  // Slow path: scan all project folders
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return null;
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, "utf-8");
        const entries = parseJSONLEntries(content);
        return deriveSessionState(entries);
      } catch {
        return null;
      }
    }
  }

  return null;
}

/**
 * Get all summaries for a specific session.
 * Requires knowing the project path for direct lookup.
 */
export async function getSummariesForSession(
  sessionId: string,
  projectPath?: string
): Promise<Array<{ summary: string; messageIndex: number }>> {
  let filePath: string | null = null;

  if (projectPath) {
    filePath = getSessionJSONLPath(sessionId, projectPath);
  } else {
    // Scan for it (slow path)
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return [];
    const folders = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    for (const folder of folders) {
      if (folder.startsWith(".")) continue;
      const testPath = path.join(CLAUDE_PROJECTS_DIR, folder, `${sessionId}.jsonl`);
      if (fs.existsSync(testPath)) {
        filePath = testPath;
        break;
      }
    }
  }

  if (!filePath) return [];

  const summaries: Array<{ summary: string; messageIndex: number }> = [];
  let messageCount = 0;

  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const lines = content.split("\n");

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.type === "user" || entry.type === "assistant") {
          messageCount++;
        }
        if (entry.type === "summary") {
          const parsed = SummaryEntrySchema.safeParse(entry);
          if (parsed.success) {
            summaries.push({
              summary: parsed.data.summary,
              messageIndex: messageCount,
            });
          }
        }
      } catch {
        // Skip malformed lines
      }
    }
  } catch {
    // Ignore errors
  }

  return summaries;
}
