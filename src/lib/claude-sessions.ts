import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import type { FSWatcher } from "chokidar";
import { SessionMetadata, SummaryEntry, SummaryEntrySchema } from "./types";
import { getCachedSessions, setCachedSessions } from "./session-cache";

const CLAUDE_PROJECTS_DIR = path.join(
  process.env.HOME || "~",
  ".claude",
  "projects"
);

// Threshold for considering a session "running" based on file modification time
const RUNNING_THRESHOLD_MS = 30_000; // 30 seconds

/**
 * Decode a Claude project folder name back to the original path
 * e.g., "-Users-jruck-Bridge" -> "/Users/jruck/Bridge"
 * Handles folder names with hyphens by checking filesystem
 */
function decodeProjectPath(folderName: string): string {
  // Remove leading hyphen and split by hyphen, filtering empty parts
  const parts = folderName.slice(1).split("-").filter(Boolean);

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

  return currentPath;
}

/**
 * Extract a friendly project name from the path
 * e.g., "/Users/jruck/Bridge" -> "Bridge"
 */
function getProjectName(projectPath: string): string {
  const parts = projectPath.split("/").filter(Boolean);
  return parts[parts.length - 1] || projectPath;
}

/**
 * Parse a single JSONL session file and extract metadata
 */
async function parseSessionFile(
  filePath: string,
  projectPath: string
): Promise<SessionMetadata | null> {
  const sessionId = path.basename(filePath, ".jsonl");

  // Skip agent files
  if (sessionId.startsWith("agent-")) {
    return null;
  }

  let summary: string | null = null;
  let customTitle: string | null = null;  // From /rename command
  let firstPrompt: string | null = null;
  let lastPrompt: string | null = null;
  let lastTimestamp: Date | null = null;
  let messageCount = 0;
  let gitBranch: string | null = null;
  let slug: string | null = null;
  const slugs = new Set<string>();  // Collect all unique slugs (can change mid-session)

  try {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    for await (const line of rl) {
      if (!line.trim()) continue;

      try {
        const entry = JSON.parse(line);

        // Get custom title from /rename command (takes precedence over summary)
        if (entry.type === "custom-title" && entry.customTitle) {
          customTitle = entry.customTitle;
        }

        // Get summary - use the most recent one (last in file)
        if (entry.type === "summary") {
          const parsed = SummaryEntrySchema.safeParse(entry);
          if (parsed.success) {
            summary = parsed.data.summary;
          }
        }

        // Count user/assistant messages and track timestamps
        if (entry.type === "user" || entry.type === "assistant") {
          messageCount++;

          if (entry.timestamp) {
            const ts = new Date(entry.timestamp);
            if (!lastTimestamp || ts > lastTimestamp) {
              lastTimestamp = ts;
            }
          }

          // Get git branch from first message that has it
          if (entry.gitBranch && !gitBranch) {
            gitBranch = entry.gitBranch;
          }

          // Get slug (Claude Code's internal session name)
          // Collect ALL slugs - they can change mid-session (e.g., when entering plan mode)
          if (entry.slug) {
            slugs.add(entry.slug);
            if (!slug) {
              slug = entry.slug;  // Keep first slug as primary
            }
          }

          // Get user prompts (first and last)
          if (entry.type === "user" && entry.message?.content) {
            const content = entry.message.content;
            let promptText: string | null = null;

            if (typeof content === "string") {
              promptText = content.slice(0, 200);
            } else if (Array.isArray(content)) {
              // Content can be an array of blocks - find the first text block
              const textBlock = content.find(
                (block: { type?: string; text?: string }) => block.type === "text" && block.text
              );
              if (textBlock?.text) {
                promptText = textBlock.text.slice(0, 200);
              }
            }

            // Skip system-injected messages (not actual user prompts)
            // These include context/caveat messages and local command outputs
            if (promptText && (
              promptText.startsWith("Caveat: ") ||
              promptText.startsWith("<command-name>") ||
              promptText.startsWith("<local-command-stdout>") ||
              promptText.startsWith("<system-reminder>")
            )) {
              continue;
            }

            if (promptText) {
              if (!firstPrompt) {
                firstPrompt = promptText;
              }
              lastPrompt = promptText;  // Always update to get the most recent
            }
          }
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Skip empty sessions
    if (messageCount === 0) {
      return null;
    }

    return {
      id: sessionId,
      title: customTitle || summary || firstPrompt?.slice(0, 50) || "Untitled Session",
      project: getProjectName(projectPath),
      projectPath,
      lastActivity: lastTimestamp || new Date(fs.statSync(filePath).mtime),
      messageCount,
      gitBranch,
      firstPrompt,
      lastPrompt,
      slug,
      slugs: Array.from(slugs),
    };
  } catch (error) {
    console.error(`Error parsing session file ${filePath}:`, error);
    return null;
  }
}

/**
 * Get all sessions, optionally filtered by a base path prefix
 * Uses in-memory caching for significant performance improvement
 */
export async function getSessions(
  basePath?: string
): Promise<SessionMetadata[]> {
  // Try cache first for unscoped requests (scoped requests filter from cached data)
  const cached = getCachedSessions();
  if (cached) {
    // If we have cached data, filter it for scoped requests
    if (basePath) {
      return cached.filter(s => s.projectPath.startsWith(basePath));
    }
    return cached;
  }

  // No cache - need to parse all sessions
  const sessions: SessionMetadata[] = [];

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return sessions;
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    // Skip hidden files
    if (folder.startsWith(".")) continue;

    const projectPath = decodeProjectPath(folder);

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const stat = fs.statSync(projectDir);

    if (!stat.isDirectory()) continue;

    const files = fs.readdirSync(projectDir);
    const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

    for (const file of jsonlFiles) {
      const filePath = path.join(projectDir, file);
      const metadata = await parseSessionFile(filePath, projectPath);
      if (metadata) {
        sessions.push(metadata);
      }
    }
  }

  // Sort by last activity (most recent first)
  sessions.sort((a, b) => b.lastActivity.getTime() - a.lastActivity.getTime());

  // Cache the full result (regardless of basePath filter)
  setCachedSessions(sessions);

  // Return filtered if basePath was provided
  if (basePath) {
    return sessions.filter(s => s.projectPath.startsWith(basePath));
  }

  return sessions;
}

/**
 * Get a single session by ID
 */
export async function getSessionById(
  sessionId: string
): Promise<SessionMetadata | null> {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return null;
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (fs.existsSync(filePath)) {
      const projectPath = decodeProjectPath(folder);
      return parseSessionFile(filePath, projectPath);
    }
  }

  return null;
}

/**
 * Get all summaries for a specific session
 */
export async function getSummariesForSession(
  sessionId: string
): Promise<SummaryEntry[]> {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return [];
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (fs.existsSync(filePath)) {
      const summaries: SummaryEntry[] = [];
      let messageCount = 0;

      try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity,
        });

        for await (const line of rl) {
          if (!line.trim()) continue;

          try {
            const entry = JSON.parse(line);

            // Count user/assistant messages
            if (entry.type === "user" || entry.type === "assistant") {
              messageCount++;
            }

            // Capture summaries with their position
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

        return summaries;
      } catch (error) {
        console.error(`Error parsing session file ${filePath}:`, error);
        return [];
      }
    }
  }

  return [];
}

/**
 * Check if a session is currently running based on file modification time
 * A session is considered running if its JSONL file was modified within the last 30 seconds
 */
export function isSessionRunning(sessionId: string): boolean {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return false;
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      const mtime = stats.mtime.getTime();
      const now = Date.now();
      return (now - mtime) < RUNNING_THRESHOLD_MS;
    }
  }

  return false;
}

/**
 * Get running status for multiple sessions at once (more efficient than checking individually)
 * Returns a Map of sessionId -> mtime for sessions modified within RUNNING_THRESHOLD_MS
 */
export function getRunningSessionIds(): Map<string, number> {
  const runningIds = new Map<string, number>();

  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return runningIds;
  }

  const now = Date.now();
  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);

    try {
      const stat = fs.statSync(projectDir);
      if (!stat.isDirectory()) continue;

      const files = fs.readdirSync(projectDir);
      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl") && !f.startsWith("agent-"));

      for (const file of jsonlFiles) {
        const filePath = path.join(projectDir, file);
        const stats = fs.statSync(filePath);
        const mtime = stats.mtime.getTime();

        if ((now - mtime) < RUNNING_THRESHOLD_MS) {
          const sessionId = path.basename(file, ".jsonl");
          runningIds.set(sessionId, mtime);
        }
      }
    } catch {
      // Skip folders we can't read
    }
  }

  return runningIds;
}

/**
 * Get the mtime for a specific session's JSONL file
 */
export function getSessionMtime(sessionId: string): number | null {
  if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) {
    return null;
  }

  const projectFolders = fs.readdirSync(CLAUDE_PROJECTS_DIR);

  for (const folder of projectFolders) {
    if (folder.startsWith(".")) continue;

    const projectDir = path.join(CLAUDE_PROJECTS_DIR, folder);
    const filePath = path.join(projectDir, `${sessionId}.jsonl`);

    if (fs.existsSync(filePath)) {
      const stats = fs.statSync(filePath);
      return stats.mtime.getTime();
    }
  }

  return null;
}

/**
 * Watch for changes in the Claude projects directory
 */
export function watchSessions(
  callback: () => void,
  basePath?: string
): () => void {
  // Dynamic import chokidar since it's ESM
  let watcher: FSWatcher | null = null;

  import("chokidar").then((chokidar) => {
    const watchPath = path.join(CLAUDE_PROJECTS_DIR, "**/*.jsonl");
    watcher = chokidar.watch(watchPath, {
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100,
      },
    });

    watcher.on("add", callback);
    watcher.on("change", callback);
    watcher.on("unlink", callback);
  });

  return () => {
    if (watcher) {
      watcher.close();
    }
  };
}
