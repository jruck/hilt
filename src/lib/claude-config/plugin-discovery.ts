import * as fs from "fs/promises";
import * as path from "path";
import { PluginConfig, MCPServerConfig } from "./types";

interface RawInstalledPlugins {
  version: number;
  plugins: Record<
    string,
    Array<{
      scope: string;
      installPath: string;
      version: string;
      installedAt?: string;
      lastUpdated?: string;
      gitCommitSha?: string;
    }>
  >;
}

interface RawPluginJson {
  name?: string;
  description?: string;
  version?: string;
  author?: {
    name?: string;
    email?: string;
    url?: string;
  };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
}

interface RawSettings {
  enabledPlugins?: Record<string, boolean>;
}

/**
 * Discover all installed plugins from the plugin registry
 * Enriches with metadata from plugin.json and enablement status from settings.json
 */
export async function discoverPlugins(
  homePath: string,
  mcpServers: MCPServerConfig[] = []
): Promise<PluginConfig[]> {
  const plugins: PluginConfig[] = [];

  // Read enabled plugins from settings.json
  const enabledPlugins = await readEnabledPlugins(homePath);

  // Build a map of pluginId -> MCP server names for linking
  const pluginMcpMap = buildPluginMcpMap(mcpServers);

  // Read installed plugins registry
  const pluginsPath = path.join(
    homePath,
    ".claude",
    "plugins",
    "installed_plugins.json"
  );

  try {
    const content = await fs.readFile(pluginsPath, "utf-8");
    const registry = JSON.parse(content) as RawInstalledPlugins;

    for (const [pluginId, installations] of Object.entries(registry.plugins)) {
      // Use the first (most recent) installation
      const install = installations[0];
      if (!install) continue;

      // Parse plugin ID into name and marketplace
      const atIndex = pluginId.indexOf("@");
      const name = atIndex > 0 ? pluginId.slice(0, atIndex) : pluginId;
      const marketplace = atIndex > 0 ? pluginId.slice(atIndex + 1) : "";

      // Read plugin metadata from .claude-plugin/plugin.json
      const metadata = await readPluginMetadata(install.installPath);

      // Check if enabled in settings
      const enabled = enabledPlugins[pluginId] ?? false;

      // Get linked MCP servers
      const mcpServerNames = pluginMcpMap.get(pluginId) || [];

      // Discover skills and agents from plugin directory
      const skillNames = await discoverPluginSkills(install.installPath);
      const agentNames = await discoverPluginAgents(install.installPath);

      const plugin: PluginConfig = {
        id: pluginId,
        name: metadata?.name || name,
        marketplace,
        scope: "user", // Currently all plugins are user-scoped
        enabled,
        version: install.version,
        installPath: install.installPath,
        installedAt: install.installedAt,
        lastUpdated: install.lastUpdated,
        gitCommitSha: install.gitCommitSha,

        // Metadata from plugin.json
        description: metadata?.description,
        author: metadata?.author,
        homepage: metadata?.homepage,
        repository: metadata?.repository,
        license: metadata?.license,
        keywords: metadata?.keywords,

        // Relationships
        mcpServerNames,
        skillNames,
        agentNames,
      };

      plugins.push(plugin);
    }
  } catch {
    // Plugin registry doesn't exist or is invalid
  }

  // Sort by enabled status (enabled first), then by name
  plugins.sort((a, b) => {
    if (a.enabled !== b.enabled) {
      return a.enabled ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return plugins;
}

/**
 * Read enabled plugins from settings.json
 */
async function readEnabledPlugins(
  homePath: string
): Promise<Record<string, boolean>> {
  const settingsPath = path.join(homePath, ".claude", "settings.json");
  try {
    const content = await fs.readFile(settingsPath, "utf-8");
    const settings = JSON.parse(content) as RawSettings;
    return settings.enabledPlugins || {};
  } catch {
    return {};
  }
}

/**
 * Read plugin metadata from .claude-plugin/plugin.json
 */
async function readPluginMetadata(
  installPath: string
): Promise<RawPluginJson | null> {
  const pluginJsonPath = path.join(
    installPath,
    ".claude-plugin",
    "plugin.json"
  );
  try {
    const content = await fs.readFile(pluginJsonPath, "utf-8");
    return JSON.parse(content) as RawPluginJson;
  } catch {
    return null;
  }
}

/**
 * Build a map from pluginId to MCP server names
 * This allows us to link plugins to their provided MCP servers
 */
function buildPluginMcpMap(
  mcpServers: MCPServerConfig[]
): Map<string, string[]> {
  const map = new Map<string, string[]>();

  for (const server of mcpServers) {
    if (server.pluginId) {
      const existing = map.get(server.pluginId) || [];
      existing.push(server.name);
      map.set(server.pluginId, existing);
    }
  }

  return map;
}

/**
 * Discover skills from a plugin's skills/ directory
 * Skills are directories containing a SKILL.md file
 */
async function discoverPluginSkills(installPath: string): Promise<string[]> {
  const skillNames: string[] = [];
  const skillsDir = path.join(installPath, "skills");

  try {
    const entries = await fs.readdir(skillsDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      // Check if this directory has a SKILL.md file
      const skillMdPath = path.join(skillsDir, entry.name, "SKILL.md");
      try {
        await fs.access(skillMdPath);
        skillNames.push(entry.name);
      } catch {
        // No SKILL.md in this directory
      }
    }
  } catch {
    // skills/ directory doesn't exist
  }

  return skillNames;
}

/**
 * Discover agents from a plugin's agents/ directory
 * Agents are .md files in the agents/ directory or its subdirectories
 * Names are formatted as category:name for nested agents
 */
async function discoverPluginAgents(installPath: string): Promise<string[]> {
  const agentNames: string[] = [];
  const agentsDir = path.join(installPath, "agents");

  async function scanDir(dir: string, prefix: string = ""): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          // Recurse into subdirectory with category prefix
          const newPrefix = prefix ? `${prefix}:${entry.name}` : entry.name;
          await scanDir(fullPath, newPrefix);
        } else if (entry.isFile() && entry.name.endsWith(".md")) {
          // Use filename without .md extension as agent name
          const baseName = entry.name.slice(0, -3);
          const name = prefix ? `${prefix}:${baseName}` : baseName;
          agentNames.push(name);
        }
      }
    } catch {
      // Directory doesn't exist or not readable
    }
  }

  await scanDir(agentsDir);
  return agentNames;
}
