import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import { ConfigFileSaveRequest, ConfigFileSaveResponse } from "./types";

export async function saveConfigFile(
  request: ConfigFileSaveRequest
): Promise<ConfigFileSaveResponse> {
  try {
    // Security check: normalize the path
    const normalizedPath = path.normalize(request.path);
    const home = homedir();

    // Must be in ~/.claude/ or project .claude/ or be a CLAUDE.md file
    const isClaudeDir = normalizedPath.includes(".claude");
    const isClaudeMd =
      normalizedPath.endsWith("CLAUDE.md") || normalizedPath.endsWith("CLAUDE.local.md");
    const isInHomeDir = normalizedPath.startsWith(home);

    const isValidPath = isClaudeDir || isClaudeMd;

    if (!isValidPath) {
      return {
        success: false,
        error: "Invalid path: must be a Claude configuration file",
      };
    }

    // Don't allow writing to system layer
    if (
      normalizedPath.includes("/Library/Application Support/ClaudeCode") ||
      normalizedPath.includes("/etc/claude-code") ||
      normalizedPath.includes("ProgramData\\ClaudeCode")
    ) {
      return {
        success: false,
        error: "Cannot write to system configuration",
      };
    }

    // Create parent directories if needed
    if (request.createDirectories) {
      await fs.mkdir(path.dirname(request.path), { recursive: true });
    }

    // Write the file
    await fs.writeFile(request.path, request.content, "utf-8");

    // Get new mtime
    const stats = await fs.stat(request.path);

    return {
      success: true,
      mtime: stats.mtimeMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function deleteConfigFile(filePath: string): Promise<ConfigFileSaveResponse> {
  try {
    // Security checks similar to save
    const normalizedPath = path.normalize(filePath);

    const isValidPath =
      normalizedPath.includes(".claude") ||
      normalizedPath.endsWith("CLAUDE.md") ||
      normalizedPath.endsWith("CLAUDE.local.md");

    if (!isValidPath) {
      return {
        success: false,
        error: "Invalid path: must be a Claude configuration file",
      };
    }

    // Don't allow deleting system files
    if (
      normalizedPath.includes("/Library/Application Support/ClaudeCode") ||
      normalizedPath.includes("/etc/claude-code") ||
      normalizedPath.includes("ProgramData\\ClaudeCode")
    ) {
      return {
        success: false,
        error: "Cannot delete system configuration",
      };
    }

    await fs.unlink(filePath);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

export async function createSkillDirectory(
  skillsDir: string,
  skillName: string,
  initialContent: string
): Promise<ConfigFileSaveResponse> {
  try {
    const skillDir = path.join(skillsDir, skillName);
    const skillMdPath = path.join(skillDir, "SKILL.md");

    // Create directory
    await fs.mkdir(skillDir, { recursive: true });

    // Create SKILL.md
    await fs.writeFile(skillMdPath, initialContent, "utf-8");

    const stats = await fs.stat(skillMdPath);

    return {
      success: true,
      mtime: stats.mtimeMs,
    };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
