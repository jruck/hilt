"use client";

import { useState } from "react";
import {
  FileText,
  Settings,
  Terminal,
  Sparkles,
  Bot,
  Webhook,
  Server,
  Key,
  Plus,
  Lock,
  User,
  Folder,
  FileEdit,
  ChevronRight,
  ChevronDown,
  Puzzle,
} from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { ConfigFile, ConfigFileType, ConfigLayer, ClaudeStack, MCPServerConfig, PluginConfig, AuthStatus } from "@/lib/claude-config/types";

// Extended filter type that includes plugins
export type StackFilterType = ConfigFileType | "plugins";

// Selection can be a file, MCP server, or plugin
export type StackSelection =
  | { type: "file"; file: ConfigFile; layer: ConfigLayer }
  | { type: "mcp"; server: MCPServerConfig }
  | { type: "plugin"; plugin: PluginConfig };

interface StackFileTreeProps {
  layers: ClaudeStack["layers"];
  mcpServers: MCPServerConfig[];
  plugins: PluginConfig[];
  selectedFile: ConfigFile | null;
  selectedMCPServer?: MCPServerConfig | null;
  selectedPlugin?: PluginConfig | null;
  onSelectFile: (file: ConfigFile, layer: ConfigLayer) => void;
  onSelectMCPServer?: (server: MCPServerConfig) => void;
  onSelectPlugin?: (plugin: PluginConfig) => void;
  onCreateFile?: (file: ConfigFile, layer: ConfigLayer) => void;
  typeFilter?: StackFilterType | null;
  searchQuery?: string;
}

const LAYER_CONFIG: Record<ConfigLayer, { label: string; icon: typeof Lock; description: string }> = {
  system: { label: "System", icon: Lock, description: "Enterprise managed" },
  user: { label: "User", icon: User, description: "~/.claude/" },
  project: { label: "Project", icon: Folder, description: ".claude/" },
  local: { label: "Local", icon: FileEdit, description: "Personal overrides" },
};

// Colors spread across spectrum: blue → indigo → violet → rose → orange → amber → cyan → gray
const TYPE_CONFIG: Record<ConfigFileType, { icon: typeof FileText; label: string; color: string }> = {
  memory: { icon: FileText, label: "Memory", color: "text-blue-500" },
  settings: { icon: Settings, label: "Settings", color: "text-indigo-500" },
  command: { icon: Terminal, label: "Commands", color: "text-violet-500" },
  skill: { icon: Sparkles, label: "Skills", color: "text-rose-500" },
  agent: { icon: Bot, label: "Agents", color: "text-orange-500" },
  hook: { icon: Webhook, label: "Hooks", color: "text-amber-500" },
  mcp: { icon: Server, label: "MCP", color: "text-cyan-500" },
  env: { icon: Key, label: "Environment", color: "text-gray-500" },
};

// Plugin color (emerald - distinct from other types)
const PLUGIN_COLOR = "text-emerald-500";

const LAYER_ORDER: ConfigLayer[] = ["local", "project", "user", "system"];

/**
 * Get visual indicator configuration for MCP server auth status
 */
function getAuthIndicator(authStatus?: AuthStatus): { color: string; title: string } | null {
  switch (authStatus) {
    case "authenticated":
      return { color: "bg-blue-500", title: "Authenticated" };
    case "expired":
      return { color: "bg-yellow-500", title: "Token expired (will auto-refresh)" };
    case "needs-reauth":
      return { color: "bg-red-500", title: "Needs re-authentication" };
    case "not-configured":
      return { color: "bg-gray-400", title: "Not configured" };
    case "not-required":
    default:
      return null; // Don't show indicator for servers that don't need auth
  }
}

export function StackFileTree({
  layers,
  mcpServers,
  plugins,
  selectedFile,
  selectedMCPServer,
  selectedPlugin,
  onSelectFile,
  onSelectMCPServer,
  onSelectPlugin,
  onCreateFile,
  typeFilter,
  searchQuery = "",
}: StackFileTreeProps) {
  const isMobile = useIsMobile();
  // Normalize search query for filtering
  const normalizedSearch = searchQuery.trim().toLowerCase();

  // Get MCP servers for a specific layer (excluding those that belong to plugins)
  const getMCPServersForLayer = (layer: ConfigLayer): MCPServerConfig[] => {
    return mcpServers.filter((server) => server.layer === layer && !server.pluginId);
  };

  // Get MCP servers that belong to a specific plugin
  const getMCPServersForPlugin = (pluginId: string): MCPServerConfig[] => {
    return mcpServers.filter((server) => server.pluginId === pluginId);
  };

  // Get plugins for a specific layer (scope maps to layer: "user" -> "user", "project" -> "project")
  const getPluginsForLayer = (layer: ConfigLayer): PluginConfig[] => {
    return plugins.filter((plugin) => plugin.scope === layer);
  };

  // Track expanded layers
  const [expandedLayers, setExpandedLayers] = useState<Set<ConfigLayer>>(() => {
    // Start with layers that have existing files expanded
    const expanded = new Set<ConfigLayer>();
    LAYER_ORDER.forEach((layer) => {
      const hasFiles = layers[layer].some((f) => f.exists);
      if (hasFiles || layer === "local" || layer === "project") {
        expanded.add(layer);
      }
    });
    return expanded;
  });

  // Track expanded plugins (all expanded by default)
  const [expandedPlugins, setExpandedPlugins] = useState<Set<string>>(() => {
    return new Set(plugins.map((p) => p.id));
  });

  const toggleLayer = (layer: ConfigLayer) => {
    setExpandedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(layer)) {
        next.delete(layer);
      } else {
        next.add(layer);
      }
      return next;
    });
  };

  const togglePlugin = (pluginId: string) => {
    setExpandedPlugins((prev) => {
      const next = new Set(prev);
      if (next.has(pluginId)) {
        next.delete(pluginId);
      } else {
        next.add(pluginId);
      }
      return next;
    });
  };

  return (
    <div>
      {LAYER_ORDER.map((layer, layerIndex) => {
        const layerConfig = LAYER_CONFIG[layer];
        const LayerIcon = layerConfig.icon;
        const files = layers[layer];

        // Get MCP servers for this layer
        let layerMCPServers = getMCPServersForLayer(layer);

        // Get plugins for this layer
        let layerPlugins = getPluginsForLayer(layer);

        // Apply type filter and search filter to files
        let filteredFiles = files;
        if (typeFilter && typeFilter !== "mcp" && typeFilter !== "plugins") {
          filteredFiles = filteredFiles.filter((f) => f.type === typeFilter);
        } else if (typeFilter === "mcp" || typeFilter === "plugins") {
          // When filtering by MCP or plugins, hide all non-MCP/plugin files
          filteredFiles = [];
        }
        if (normalizedSearch) {
          filteredFiles = filteredFiles.filter((f) =>
            f.name.toLowerCase().includes(normalizedSearch)
          );
        }

        // Apply filters to MCP servers
        if (typeFilter && typeFilter !== "mcp") {
          // When filtering by non-MCP type, hide MCP servers (unless filtering by plugins, which shows related MCP servers)
          if (typeFilter !== "plugins") {
            layerMCPServers = [];
          }
        }
        if (normalizedSearch) {
          layerMCPServers = layerMCPServers.filter((s) =>
            s.name.toLowerCase().includes(normalizedSearch)
          );
        }

        // Apply filters to plugins
        if (typeFilter && typeFilter !== "plugins") {
          // When filtering by non-plugin type, hide plugins
          layerPlugins = [];
        }
        if (normalizedSearch) {
          layerPlugins = layerPlugins.filter((p) =>
            p.name.toLowerCase().includes(normalizedSearch)
          );
        }

        const existingFiles = filteredFiles.filter((f) => f.exists);
        const totalItems = existingFiles.length + layerMCPServers.length + layerPlugins.length;
        const isExpanded = expandedLayers.has(layer);
        const isLocalLayer = layer === "local";

        // Group files by type
        const grouped = filteredFiles.reduce(
          (acc, file) => {
            if (!acc[file.type]) acc[file.type] = [];
            acc[file.type].push(file);
            return acc;
          },
          {} as Record<ConfigFileType, ConfigFile[]>
        );

        // Always show all layers, even if empty

        return (
          <div key={layer}>
            {/* Layer divider - skip for first layer */}
            {layerIndex > 0 && (
              <div className="h-px bg-[var(--border-default)] mx-2 my-1" />
            )}

            {/* Layer header */}
            <button
              onClick={() => toggleLayer(layer)}
              className={`w-full flex items-center gap-1 px-2 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors uppercase tracking-wider ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}`}
            >
              <span className={`flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] ${isMobile ? "w-5 h-5" : "w-4 h-4"}`}>
                {isExpanded ? (
                  <ChevronDown className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
                ) : (
                  <ChevronRight className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
                )}
              </span>
              <LayerIcon className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"}`} />
              <span className="flex-1 text-left">{layerConfig.label}</span>
              <span className="text-[10px] font-normal normal-case text-[var(--text-tertiary)]">
                {totalItems} item{totalItems !== 1 ? "s" : ""}
              </span>
            </button>

            {/* Files and MCP servers in this layer */}
            {isExpanded && (
              <>
                {totalItems === 0 && (!isLocalLayer || typeFilter || normalizedSearch) ? (
                  <div
                    className="flex items-center gap-1 px-2 py-1 text-sm text-[var(--text-tertiary)] italic"
                    style={{ paddingLeft: "24px" }}
                  >
                    {/* Spacer to align with chevron + icon */}
                    <span className="w-4 flex-shrink-0" />
                    <span className="w-4 flex-shrink-0" />
                    {typeFilter || normalizedSearch ? "No matching items" : "No items"}
                  </div>
                ) : (
                  <>
                    {/* Render files grouped by type */}
                    {(Object.keys(TYPE_CONFIG) as ConfigFileType[]).map((type) => {
                      // Skip MCP type for files - we render MCP servers separately
                      if (type === "mcp") return null;

                      const typeFiles = grouped[type] || [];
                      const existingTypeFiles = typeFiles.filter((f) => f.exists);
                      const config = TYPE_CONFIG[type];
                      const Icon = config.icon;

                      // For local layer, show even non-existent files
                      const showPlaceholders = isLocalLayer && typeFiles.some((f) => !f.exists);

                      if (existingTypeFiles.length === 0 && !showPlaceholders) return null;

                      return (
                        <div key={type}>
                          {typeFiles.map((file) => {
                            const isSelected = selectedFile?.path === file.path && !selectedMCPServer;
                            const canCreate = !file.exists && onCreateFile;

                            return (
                              <button
                                key={file.path}
                                onClick={() => {
                                  if (file.exists) {
                                    onSelectFile(file, layer);
                                  } else if (canCreate) {
                                    onCreateFile(file, layer);
                                  }
                                }}
                                className={`
                                  w-full flex items-center gap-1 px-2 text-sm text-left
                                  transition-colors
                                  ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}
                                  ${
                                    !file.exists
                                      ? "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                                      : isSelected
                                        ? "bg-[var(--bg-tertiary)]"
                                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                                  }
                                `}
                                style={{ paddingLeft: "24px" }}
                              >
                                {/* Spacer to align with chevron */}
                                <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                                <Icon className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"} ${!file.exists ? "opacity-50" : config.color}`} />
                                <span className="truncate flex-1">{file.name}</span>
                                {!file.exists && (
                                  <Plus className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"}`} />
                                )}
                              </button>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Render MCP servers */}
                    {layerMCPServers.length > 0 && (
                      <div>
                        {layerMCPServers.map((server) => {
                          const isSelected = selectedMCPServer?.name === server.name && selectedMCPServer?.source === server.source;
                          const mcpConfig = TYPE_CONFIG.mcp;
                          const MCPIcon = mcpConfig.icon;

                          // Auth status indicator configuration
                          const authIndicator = getAuthIndicator(server.authStatus);

                          return (
                            <button
                              key={`${server.name}-${server.source}`}
                              onClick={() => onSelectMCPServer?.(server)}
                              className={`
                                w-full flex items-center gap-1 px-2 text-sm text-left
                                transition-colors
                                ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}
                                ${
                                  isSelected
                                    ? "bg-[var(--bg-tertiary)]"
                                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                                }
                              `}
                              style={{ paddingLeft: "24px" }}
                            >
                              {/* Spacer to align with chevron */}
                              <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                              <MCPIcon className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"} ${mcpConfig.color}`} />
                              <span className="truncate flex-1">{server.name}</span>
                              {/* Auth status indicator (only show if not "not-required") */}
                              {authIndicator && (
                                <span
                                  className={`w-2 h-2 rounded-full flex-shrink-0 ${authIndicator.color}`}
                                  title={authIndicator.title}
                                />
                              )}
                              {/* Enabled/disabled indicator */}
                              <span
                                className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  server.enabled ? "bg-green-500" : "bg-gray-400"
                                }`}
                                title={server.enabled ? "Enabled" : "Disabled"}
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}

                    {/* Render plugins in this layer */}
                    {layerPlugins.length > 0 && (
                      <div>
                        {layerPlugins.map((plugin) => {
                          const isSelected = selectedPlugin?.id === plugin.id;
                          const isPluginExpanded = expandedPlugins.has(plugin.id);
                          const pluginMCPServers = getMCPServersForPlugin(plugin.id);
                          const childCount = pluginMCPServers.length + (plugin.skillNames?.length || 0) + (plugin.agentNames?.length || 0);

                          return (
                            <div key={plugin.id}>
                              {/* Plugin header row */}
                              <div
                                className={`
                                  w-full flex items-center gap-1 px-2 text-sm text-left
                                  transition-colors
                                  ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}
                                  ${
                                    isSelected
                                      ? "bg-[var(--bg-tertiary)]"
                                      : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                                  }
                                `}
                                style={{ paddingLeft: "24px" }}
                              >
                                {/* Expand/collapse chevron */}
                                {childCount > 0 ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      togglePlugin(plugin.id);
                                    }}
                                    className={`flex-shrink-0 flex items-center justify-center text-[var(--text-tertiary)] hover:text-[var(--text-primary)] ${isMobile ? "w-5 h-5" : "w-4 h-4"}`}
                                  >
                                    {isPluginExpanded ? (
                                      <ChevronDown className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
                                    ) : (
                                      <ChevronRight className={isMobile ? "w-4 h-4" : "w-3 h-3"} />
                                    )}
                                  </button>
                                ) : (
                                  <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                                )}
                                {/* Plugin content (clickable) */}
                                <button
                                  onClick={() => onSelectPlugin?.(plugin)}
                                  className="flex items-center gap-1 flex-1 min-w-0"
                                >
                                  <Puzzle className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"} ${PLUGIN_COLOR}`} />
                                  <span className="truncate flex-1 text-left">{plugin.name}</span>
                                </button>
                                {/* Enabled/disabled indicator */}
                                <span
                                  className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                    plugin.enabled ? "bg-green-500" : "bg-gray-400"
                                  }`}
                                  title={plugin.enabled ? "Enabled" : "Disabled"}
                                />
                              </div>

                              {/* Plugin children (MCP servers, skills, agents) */}
                              {isPluginExpanded && childCount > 0 && (
                                <div>
                                  {/* Nested MCP servers */}
                                  {pluginMCPServers.map((server) => {
                                    const isMCPSelected = selectedMCPServer?.name === server.name && selectedMCPServer?.source === server.source;
                                    const authIndicator = getAuthIndicator(server.authStatus);
                                    const mcpConfig = TYPE_CONFIG.mcp;

                                    return (
                                      <button
                                        key={`${server.name}-${server.source}`}
                                        onClick={() => onSelectMCPServer?.(server)}
                                        className={`
                                          w-full flex items-center gap-1 px-2 text-sm text-left
                                          transition-colors
                                          ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}
                                          ${
                                            isMCPSelected
                                              ? "bg-[var(--bg-tertiary)]"
                                              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)]"
                                          }
                                        `}
                                        style={{ paddingLeft: "48px" }}
                                      >
                                        <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                                        <Server className={`flex-shrink-0 ${isMobile ? "w-5 h-5" : "w-4 h-4"} ${mcpConfig.color}`} />
                                        <span className="truncate flex-1">{server.name}</span>
                                        {authIndicator && (
                                          <span
                                            className={`w-2 h-2 rounded-full flex-shrink-0 ${authIndicator.color}`}
                                            title={authIndicator.title}
                                          />
                                        )}
                                        <span
                                          className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                            server.enabled ? "bg-green-500" : "bg-gray-400"
                                          }`}
                                          title={server.enabled ? "Enabled" : "Disabled"}
                                        />
                                      </button>
                                    );
                                  })}

                                  {/* Nested skills */}
                                  {plugin.skillNames?.map((skillName) => (
                                    <div
                                      key={`skill-${skillName}`}
                                      className={`flex items-center gap-1 px-2 text-sm text-[var(--text-secondary)] ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}`}
                                      style={{ paddingLeft: "48px" }}
                                    >
                                      <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                                      <Sparkles className={`flex-shrink-0 text-rose-500 ${isMobile ? "w-5 h-5" : "w-4 h-4"}`} />
                                      <span className="truncate flex-1">{skillName}</span>
                                    </div>
                                  ))}

                                  {/* Nested agents */}
                                  {plugin.agentNames?.map((agentName) => (
                                    <div
                                      key={`agent-${agentName}`}
                                      className={`flex items-center gap-1 px-2 text-sm text-[var(--text-secondary)] ${isMobile ? "py-2.5 min-h-[48px]" : "py-1"}`}
                                      style={{ paddingLeft: "48px" }}
                                    >
                                      <span className={`flex-shrink-0 ${isMobile ? "w-5" : "w-4"}`} />
                                      <Bot className={`flex-shrink-0 text-orange-500 ${isMobile ? "w-5 h-5" : "w-4 h-4"}`} />
                                      <span className="truncate flex-1">{agentName}</span>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
