// Configuration file types
export type ConfigFileType =
  | "memory" // CLAUDE.md, CLAUDE.local.md, rules/*.md
  | "settings" // settings.json, settings.local.json, ~/.claude.json
  | "command" // .claude/commands/*.md
  | "skill" // .claude/skills/*/SKILL.md
  | "agent" // .claude/agents/*.md
  | "hook" // .claude/hooks/*
  | "mcp" // MCP servers (embedded in settings)
  | "env"; // .env files (presence only, not contents)

export type ConfigLayer = "system" | "user" | "project" | "local";

export interface ConfigFile {
  path: string; // Absolute path
  relativePath: string; // Path relative to layer root (for display)
  type: ConfigFileType;
  layer: ConfigLayer;
  exists: boolean;
  size?: number; // bytes
  mtime?: number; // Unix timestamp ms
  name: string; // Display name (filename or skill name)
  description?: string; // From frontmatter if available
}

export interface ConfigFileContent extends ConfigFile {
  content: string | null; // null if binary or sensitive
  parsed?: {
    frontmatter?: Record<string, unknown>;
    body?: string;
  };
  isSensitive?: boolean; // true for .env files
  isEditable: boolean; // false for system layer
}

export interface ClaudeStack {
  projectPath: string;
  homePath: string; // For resolving ~
  layers: {
    system: ConfigFile[];
    user: ConfigFile[];
    project: ConfigFile[];
    local: ConfigFile[];
  };
  mcpServers: MCPServerConfig[]; // All discovered MCP servers
  plugins: PluginConfig[]; // All installed plugins
  summary: {
    memoryFiles: number;
    settingsFiles: number;
    commands: number;
    skills: number;
    agents: number;
    hooks: number;
    mcpServers: number;
    plugins: number;
    envFiles: number;
  };
}

// Parsed config types
export interface CommandConfig {
  name: string; // Derived from filename
  path: string;
  layer: ConfigLayer;
  description?: string;
  argumentHint?: string;
  allowedTools?: string[];
  model?: string;
  body: string;
}

export interface SkillConfig {
  name: string;
  path: string;
  layer: ConfigLayer;
  description?: string;
  allowedTools?: string[];
  references?: string[]; // Additional files in skill directory
}

export interface AgentConfig {
  name: string;
  path: string;
  layer: ConfigLayer;
  description?: string;
  model?: string;
  tools?: string[];
}

export interface HookDefinition {
  type: string;
  command: string;
}

export interface HookMatcher {
  matcher: string;
  hooks: HookDefinition[];
}

export interface HookConfig {
  type: "PreToolUse" | "PostToolUse" | "Stop";
  matcher: string;
  command: string;
  source: string; // Which settings file defines this
}

// MCP Server types
export type MCPServerType = "stdio" | "http";

// Auth status for MCP servers
export type AuthStatus =
  | "authenticated" // Has valid token, not expired
  | "expired" // Token exists but expiresAt < now
  | "needs-reauth" // Token expired AND no refreshToken
  | "not-configured" // No credentials entry for this server
  | "not-required"; // Server doesn't use OAuth (stdio without auth)

export interface MCPServerConfig {
  name: string;
  type: MCPServerType;
  enabled: boolean;
  layer: ConfigLayer;
  source: string; // Which config file defines this (path)

  // Plugin info (if from a plugin)
  pluginId?: string; // e.g., "github@claude-plugins-official"
  pluginMetadata?: PluginMetadata;

  // Stdio servers
  command?: string;
  args?: string[];
  env?: Record<string, string>;

  // HTTP servers
  url?: string;
  headers?: Record<string, string>;

  // Auth status (populated from credentials file)
  authStatus?: AuthStatus;
  authExpiresAt?: number; // Unix timestamp ms
}

export interface PluginMetadata {
  name: string;
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

/**
 * Plugin configuration for display in Stack view
 * Aggregates data from installed_plugins.json, settings.json, and plugin.json
 */
export interface PluginConfig {
  id: string; // e.g., "github@claude-plugins-official"
  name: string; // e.g., "github"
  marketplace: string; // e.g., "claude-plugins-official"
  scope: "user" | "project"; // Scope determines which layer the plugin belongs to
  enabled: boolean;
  version: string;
  installPath: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;

  // From plugin.json metadata
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];

  // Relationships
  mcpServerNames: string[]; // Names of MCP servers this plugin provides
  skillNames: string[]; // Names of skills this plugin provides
  agentNames: string[]; // Names of agents this plugin provides
}

export interface InstalledPlugin {
  id: string; // e.g., "github@claude-plugins-official"
  name: string; // e.g., "github"
  marketplace: string; // e.g., "claude-plugins-official"
  scope: "user" | "project";
  installPath: string;
  version: string;
  installedAt?: string;
  lastUpdated?: string;
  gitCommitSha?: string;
}

export interface PluginRegistry {
  version: number;
  plugins: Record<string, InstalledPlugin[]>;
}

export interface SettingsConfig {
  permissions?: {
    defaultMode?: string;
    allow?: string[];
    deny?: string[];
    additionalDirectories?: string[];
  };
  env?: Record<string, string>;
  hooks?: Record<string, HookMatcher[]>;
  model?: string;
  mcp?: {
    servers?: Record<string, { command: string; args?: string[]; env?: Record<string, string> }>;
  };
}

// API response types
export interface ClaudeStackResponse {
  stack: ClaudeStack;
  error?: string;
}

export interface ConfigFileResponse {
  file: ConfigFileContent;
  error?: string;
}

export interface ConfigFileSaveRequest {
  path: string;
  content: string;
  createDirectories?: boolean;
}

export interface ConfigFileSaveResponse {
  success: boolean;
  mtime?: number;
  error?: string;
}
