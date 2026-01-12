import * as fs from "fs/promises";
import * as path from "path";
import {
  MCPServerConfig,
  MCPServerType,
  PluginMetadata,
  ConfigLayer,
  AuthStatus,
} from "./types";

interface RawMCPServer {
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
}

interface RawMCPFile {
  mcpServers?: Record<string, RawMCPServer>;
  [key: string]: RawMCPServer | Record<string, RawMCPServer> | undefined;
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
  mcpServers?: Record<string, RawMCPServer>;
}

interface RawInstalledPlugins {
  version: number;
  plugins: Record<string, Array<{
    scope: string;
    installPath: string;
    version: string;
    installedAt?: string;
    lastUpdated?: string;
    gitCommitSha?: string;
  }>>;
}

interface RawSettings {
  enabledPlugins?: Record<string, boolean>;
}

interface RawOAuthCredential {
  serverName: string;
  serverUrl?: string;
  accessToken?: string;
  expiresAt?: number;
  refreshToken?: string;
  scope?: string;
}

interface RawCredentials {
  mcpOAuth?: Record<string, RawOAuthCredential>;
}

/**
 * Discover all MCP servers from user, plugin, and project sources
 */
export async function discoverMCPServers(
  homePath: string,
  projectPath: string
): Promise<MCPServerConfig[]> {
  const servers: MCPServerConfig[] = [];

  // Get enabled plugins map
  const enabledPlugins = await readEnabledPlugins(homePath);

  // 1. User-level MCP servers from ~/.claude/.mcp.json
  const userServers = await discoverUserMCPServers(homePath);
  servers.push(...userServers);

  // 2. Plugin MCP servers
  const pluginServers = await discoverPluginMCPServers(homePath, enabledPlugins);
  servers.push(...pluginServers);

  // 3. Project-level MCP servers from .claude/.mcp.json
  // Skip if projectPath is the home directory (would duplicate user servers)
  if (projectPath !== homePath) {
    const projectServers = await discoverProjectMCPServers(projectPath);
    servers.push(...projectServers);
  }

  // 4. Enrich servers with auth status from credentials file
  const enrichedServers = await enrichWithAuthStatus(servers, homePath);

  return enrichedServers;
}

/**
 * Read enabled plugins from settings.json
 */
async function readEnabledPlugins(homePath: string): Promise<Record<string, boolean>> {
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
 * Discover user-defined MCP servers from ~/.claude/.mcp.json
 */
async function discoverUserMCPServers(homePath: string): Promise<MCPServerConfig[]> {
  const mcpPath = path.join(homePath, ".claude", ".mcp.json");
  const servers: MCPServerConfig[] = [];

  try {
    const content = await fs.readFile(mcpPath, "utf-8");
    const mcpFile = JSON.parse(content) as RawMCPFile;

    // Handle both { mcpServers: {...} } and { serverName: {...} } formats
    const serversObj = mcpFile.mcpServers || mcpFile;

    for (const [name, config] of Object.entries(serversObj)) {
      if (name === "mcpServers" || !config || typeof config !== "object") continue;

      const rawConfig = config as RawMCPServer;
      const server = parseRawMCPServer(name, rawConfig, {
        layer: "user",
        source: mcpPath,
        enabled: true, // User-defined servers are always enabled
      });
      if (server) {
        servers.push(server);
      }
    }
  } catch {
    // File doesn't exist or is invalid - that's fine
  }

  return servers;
}

/**
 * Discover MCP servers from installed plugins
 */
async function discoverPluginMCPServers(
  homePath: string,
  enabledPlugins: Record<string, boolean>
): Promise<MCPServerConfig[]> {
  const servers: MCPServerConfig[] = [];
  const pluginsPath = path.join(homePath, ".claude", "plugins", "installed_plugins.json");

  try {
    const content = await fs.readFile(pluginsPath, "utf-8");
    const registry = JSON.parse(content) as RawInstalledPlugins;

    for (const [pluginId, installations] of Object.entries(registry.plugins)) {
      // Use the first (most recent) installation
      const install = installations[0];
      if (!install) continue;

      const isEnabled = enabledPlugins[pluginId] ?? false;

      // Try to read plugin metadata and MCP servers
      const pluginData = await readPluginData(install.installPath);

      if (pluginData.mcpServers) {
        for (const [serverName, serverConfig] of Object.entries(pluginData.mcpServers)) {
          const server = parseRawMCPServer(serverName, serverConfig, {
            layer: "user", // Plugins are user-installed
            source: install.installPath,
            enabled: isEnabled,
            pluginId,
            pluginMetadata: pluginData.metadata,
          });
          if (server) {
            servers.push(server);
          }
        }
      }
    }
  } catch {
    // Plugin registry doesn't exist or is invalid
  }

  return servers;
}

/**
 * Read plugin metadata and MCP server config from plugin directory
 */
async function readPluginData(installPath: string): Promise<{
  metadata?: PluginMetadata;
  mcpServers?: Record<string, RawMCPServer>;
}> {
  let metadata: PluginMetadata | undefined;
  let mcpServers: Record<string, RawMCPServer> | undefined;

  // Try to read plugin.json for metadata
  const pluginJsonPath = path.join(installPath, ".claude-plugin", "plugin.json");
  try {
    const content = await fs.readFile(pluginJsonPath, "utf-8");
    const pluginJson = JSON.parse(content) as RawPluginJson;

    metadata = {
      name: pluginJson.name || "",
      description: pluginJson.description,
      version: pluginJson.version,
      author: pluginJson.author,
      homepage: pluginJson.homepage,
      repository: pluginJson.repository,
      license: pluginJson.license,
      keywords: pluginJson.keywords,
    };

    // Some plugins define mcpServers in plugin.json
    if (pluginJson.mcpServers) {
      mcpServers = pluginJson.mcpServers;
    }
  } catch {
    // plugin.json doesn't exist
  }

  // Try to read .mcp.json for server config (if not already found in plugin.json)
  if (!mcpServers) {
    const mcpJsonPath = path.join(installPath, ".mcp.json");
    try {
      const content = await fs.readFile(mcpJsonPath, "utf-8");
      const mcpJson = JSON.parse(content) as Record<string, RawMCPServer>;
      mcpServers = mcpJson;
    } catch {
      // .mcp.json doesn't exist
    }
  }

  return { metadata, mcpServers };
}

/**
 * Discover project-level MCP servers from .claude/.mcp.json
 */
async function discoverProjectMCPServers(projectPath: string): Promise<MCPServerConfig[]> {
  const mcpPath = path.join(projectPath, ".claude", ".mcp.json");
  const servers: MCPServerConfig[] = [];

  try {
    const content = await fs.readFile(mcpPath, "utf-8");
    const mcpFile = JSON.parse(content) as RawMCPFile;

    // Handle both { mcpServers: {...} } and { serverName: {...} } formats
    const serversObj = mcpFile.mcpServers || mcpFile;

    for (const [name, config] of Object.entries(serversObj)) {
      if (name === "mcpServers" || !config || typeof config !== "object") continue;

      const rawConfig = config as RawMCPServer;
      const server = parseRawMCPServer(name, rawConfig, {
        layer: "project",
        source: mcpPath,
        enabled: true, // Project servers are always enabled
      });
      if (server) {
        servers.push(server);
      }
    }
  } catch {
    // File doesn't exist or is invalid
  }

  return servers;
}

/**
 * Parse a raw MCP server config into our structured format
 */
function parseRawMCPServer(
  name: string,
  config: RawMCPServer,
  options: {
    layer: ConfigLayer;
    source: string;
    enabled: boolean;
    pluginId?: string;
    pluginMetadata?: PluginMetadata;
  }
): MCPServerConfig | null {
  // Determine server type
  let type: MCPServerType;
  if (config.url || config.type === "http") {
    type = "http";
  } else if (config.command || config.type === "stdio") {
    type = "stdio";
  } else {
    // Can't determine type - skip
    return null;
  }

  const server: MCPServerConfig = {
    name,
    type,
    enabled: options.enabled,
    layer: options.layer,
    source: options.source,
  };

  // Add plugin info if present
  if (options.pluginId) {
    server.pluginId = options.pluginId;
  }
  if (options.pluginMetadata) {
    server.pluginMetadata = options.pluginMetadata;
  }

  // Add type-specific fields
  if (type === "stdio") {
    server.command = config.command;
    server.args = config.args;
    server.env = config.env;
  } else {
    server.url = config.url;
    server.headers = config.headers;
  }

  return server;
}

/**
 * Enrich MCP servers with auth status from credentials file
 */
async function enrichWithAuthStatus(
  servers: MCPServerConfig[],
  homePath: string
): Promise<MCPServerConfig[]> {
  const credentialsPath = path.join(homePath, ".claude", ".credentials.json");

  let credentials: RawCredentials | null = null;
  try {
    const content = await fs.readFile(credentialsPath, "utf-8");
    credentials = JSON.parse(content) as RawCredentials;
  } catch {
    // Credentials file doesn't exist or is invalid
  }

  const now = Date.now();

  return servers.map((server) => {
    // Determine auth status
    let authStatus: AuthStatus;
    let authExpiresAt: number | undefined;

    // Stdio servers without auth headers don't require auth
    if (server.type === "stdio" && !server.env?.OAUTH_TOKEN && !server.env?.API_KEY) {
      authStatus = "not-required";
    } else if (!credentials?.mcpOAuth) {
      // No credentials file - check if server requires auth
      if (server.type === "http" && server.headers) {
        authStatus = "not-configured";
      } else {
        authStatus = "not-required";
      }
    } else {
      // Look for credentials matching this server
      // Credential keys look like: "plugin:asana:asana|606ad0f6a16e323c"
      // Server names from plugins look like: "asana" or "plugin:asana:asana"
      const cred = findCredentialForServer(server, credentials.mcpOAuth);

      if (!cred) {
        // No credentials found - check if server likely needs auth
        if (server.type === "http" && server.headers) {
          authStatus = "not-configured";
        } else if (server.pluginId) {
          // Plugin servers might need auth but we don't know
          authStatus = "not-configured";
        } else {
          authStatus = "not-required";
        }
      } else {
        authExpiresAt = cred.expiresAt;

        if (!cred.expiresAt || cred.expiresAt > now) {
          // Token is valid
          authStatus = "authenticated";
        } else if (cred.refreshToken) {
          // Token expired but can be refreshed
          authStatus = "expired";
        } else {
          // Token expired and no refresh token
          authStatus = "needs-reauth";
        }
      }
    }

    return {
      ...server,
      authStatus,
      authExpiresAt,
    };
  });
}

/**
 * Find OAuth credentials for a given MCP server
 * Credential keys can be various formats:
 * - "plugin:asana:asana|606ad0f6a16e323c"
 * - "vercel|511b08192b045b3d"
 * Server names can be:
 * - "asana" (simple name)
 * - Plugin ID like "asana@claude-plugins-official"
 */
function findCredentialForServer(
  server: MCPServerConfig,
  mcpOAuth: Record<string, RawOAuthCredential>
): RawOAuthCredential | null {
  const serverName = server.name.toLowerCase();
  const pluginId = server.pluginId?.toLowerCase();

  for (const [key, cred] of Object.entries(mcpOAuth)) {
    const keyLower = key.toLowerCase();
    const credServerName = cred.serverName?.toLowerCase() || "";

    // Try various matching strategies
    // 1. Exact server name match in credential serverName
    if (credServerName.includes(serverName)) {
      return cred;
    }

    // 2. Key contains the server name (e.g., "plugin:asana:asana|..." contains "asana")
    if (keyLower.includes(serverName)) {
      return cred;
    }

    // 3. If we have a plugin ID, try matching the plugin name
    if (pluginId) {
      const pluginName = pluginId.split("@")[0];
      if (keyLower.includes(pluginName) || credServerName.includes(pluginName)) {
        return cred;
      }
    }
  }

  return null;
}
