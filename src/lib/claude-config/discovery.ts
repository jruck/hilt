import * as fs from "fs/promises";
import * as path from "path";
import { homedir } from "os";
import { ConfigFile, ConfigFileType, ConfigLayer, ClaudeStack } from "./types";

// Platform-specific paths for managed settings
const SYSTEM_PATHS: Record<string, string> = {
  darwin: "/Library/Application Support/ClaudeCode/managed-settings.json",
  linux: "/etc/claude-code/managed-settings.json",
  win32: "C:\\ProgramData\\ClaudeCode\\managed-settings.json",
};

export async function discoverStack(projectPath: string): Promise<ClaudeStack> {
  const homePath = homedir();

  const [system, user, project, local] = await Promise.all([
    discoverSystemLayer(),
    discoverUserLayer(homePath),
    discoverProjectLayer(projectPath),
    discoverLocalLayer(projectPath),
  ]);

  return {
    projectPath,
    homePath,
    layers: { system, user, project, local },
    summary: computeSummary({ system, user, project, local }),
  };
}

async function discoverSystemLayer(): Promise<ConfigFile[]> {
  const files: ConfigFile[] = [];
  const systemPath = SYSTEM_PATHS[process.platform];

  if (systemPath) {
    files.push(await probeFile(systemPath, "settings", "system"));
  }

  return files.filter((f) => f.exists);
}

async function discoverUserLayer(homePath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(homePath, ".claude");
  const files: ConfigFile[] = [];

  // Memory files
  files.push(await probeFile(path.join(claudeDir, "CLAUDE.md"), "memory", "user"));

  // Settings files
  files.push(await probeFile(path.join(homePath, ".claude.json"), "settings", "user"));
  files.push(await probeFile(path.join(claudeDir, "settings.json"), "settings", "user"));

  // Commands
  const userCommands = await discoverDirectory(
    path.join(claudeDir, "commands"),
    "command",
    "user",
    ".md"
  );
  files.push(...userCommands);

  // Skills
  const userSkills = await discoverSkills(path.join(claudeDir, "skills"), "user");
  files.push(...userSkills);

  // Agents
  const userAgents = await discoverDirectory(
    path.join(claudeDir, "agents"),
    "agent",
    "user",
    ".md"
  );
  files.push(...userAgents);

  return files.filter((f) => f.exists);
}

async function discoverProjectLayer(projectPath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(projectPath, ".claude");
  const files: ConfigFile[] = [];

  // Memory files
  files.push(await probeFile(path.join(projectPath, "CLAUDE.md"), "memory", "project"));

  // Rules directory
  const rules = await discoverDirectory(path.join(claudeDir, "rules"), "memory", "project", ".md");
  files.push(...rules);

  // Settings
  files.push(await probeFile(path.join(claudeDir, "settings.json"), "settings", "project"));

  // Commands
  const commands = await discoverDirectory(
    path.join(claudeDir, "commands"),
    "command",
    "project",
    ".md"
  );
  files.push(...commands);

  // Skills
  const skills = await discoverSkills(path.join(claudeDir, "skills"), "project");
  files.push(...skills);

  // Agents
  const agents = await discoverDirectory(path.join(claudeDir, "agents"), "agent", "project", ".md");
  files.push(...agents);

  // Hooks (executables)
  const hooks = await discoverDirectory(path.join(claudeDir, "hooks"), "hook", "project");
  files.push(...hooks);

  // Environment files (presence only)
  files.push(await probeFile(path.join(projectPath, ".env"), "env", "project"));
  files.push(await probeFile(path.join(projectPath, ".env.local"), "env", "project"));

  return files.filter((f) => f.exists);
}

async function discoverLocalLayer(projectPath: string): Promise<ConfigFile[]> {
  const claudeDir = path.join(projectPath, ".claude");
  const files: ConfigFile[] = [];

  // Local memory - always show even if doesn't exist (for create affordance)
  files.push(await probeFile(path.join(projectPath, "CLAUDE.local.md"), "memory", "local"));

  // Local settings - always show even if doesn't exist
  files.push(await probeFile(path.join(claudeDir, "settings.local.json"), "settings", "local"));

  return files; // Include non-existent for "create" affordance
}

async function probeFile(
  filePath: string,
  type: ConfigFileType,
  layer: ConfigLayer
): Promise<ConfigFile> {
  const home = homedir();
  try {
    const stats = await fs.stat(filePath);
    return {
      path: filePath,
      relativePath: filePath.startsWith(home) ? filePath.replace(home, "~") : filePath,
      type,
      layer,
      exists: true,
      size: stats.size,
      mtime: stats.mtimeMs,
      name: path.basename(filePath),
    };
  } catch {
    return {
      path: filePath,
      relativePath: filePath.startsWith(home) ? filePath.replace(home, "~") : filePath,
      type,
      layer,
      exists: false,
      name: path.basename(filePath),
    };
  }
}

async function discoverDirectory(
  dirPath: string,
  type: ConfigFileType,
  layer: ConfigLayer,
  extension?: string
): Promise<ConfigFile[]> {
  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (extension && !entry.name.endsWith(extension)) continue;

      const filePath = path.join(dirPath, entry.name);
      files.push(await probeFile(filePath, type, layer));
    }

    return files;
  } catch {
    return [];
  }
}

async function discoverSkills(skillsDir: string, layer: ConfigLayer): Promise<ConfigFile[]> {
  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });
    const files: ConfigFile[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
      const file = await probeFile(skillMdPath, "skill", layer);
      if (file.exists) {
        file.name = entry.name; // Use directory name as skill name
        files.push(file);
      }
    }

    return files;
  } catch {
    return [];
  }
}

function computeSummary(layers: ClaudeStack["layers"]): ClaudeStack["summary"] {
  const all = [...layers.system, ...layers.user, ...layers.project, ...layers.local].filter(
    (f) => f.exists
  );

  return {
    memoryFiles: all.filter((f) => f.type === "memory").length,
    settingsFiles: all.filter((f) => f.type === "settings").length,
    commands: all.filter((f) => f.type === "command").length,
    skills: all.filter((f) => f.type === "skill").length,
    agents: all.filter((f) => f.type === "agent").length,
    hooks: all.filter((f) => f.type === "hook").length,
    mcpServers: 0, // Computed from parsed settings later
    envFiles: all.filter((f) => f.type === "env").length,
  };
}
