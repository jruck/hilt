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
} from "lucide-react";
import type { ConfigFile, ConfigFileType, ConfigLayer, ClaudeStack } from "@/lib/claude-config/types";

interface StackFileTreeProps {
  layers: ClaudeStack["layers"];
  selectedFile: ConfigFile | null;
  onSelectFile: (file: ConfigFile, layer: ConfigLayer) => void;
  onCreateFile?: (file: ConfigFile, layer: ConfigLayer) => void;
  typeFilter?: ConfigFileType | null;
  searchQuery?: string;
}

const LAYER_CONFIG: Record<ConfigLayer, { label: string; icon: typeof Lock; description: string }> = {
  system: { label: "System", icon: Lock, description: "Enterprise managed" },
  user: { label: "User", icon: User, description: "~/.claude/" },
  project: { label: "Project", icon: Folder, description: ".claude/" },
  local: { label: "Local", icon: FileEdit, description: "Personal overrides" },
};

const TYPE_CONFIG: Record<ConfigFileType, { icon: typeof FileText; label: string; color: string }> = {
  memory: { icon: FileText, label: "Memory", color: "text-blue-500" },
  settings: { icon: Settings, label: "Settings", color: "text-purple-500" },
  command: { icon: Terminal, label: "Commands", color: "text-green-500" },
  skill: { icon: Sparkles, label: "Skills", color: "text-yellow-500" },
  agent: { icon: Bot, label: "Agents", color: "text-orange-500" },
  hook: { icon: Webhook, label: "Hooks", color: "text-red-500" },
  mcp: { icon: Server, label: "MCP", color: "text-cyan-500" },
  env: { icon: Key, label: "Environment", color: "text-gray-500" },
};

const LAYER_ORDER: ConfigLayer[] = ["local", "project", "user", "system"];

export function StackFileTree({
  layers,
  selectedFile,
  onSelectFile,
  onCreateFile,
  typeFilter,
  searchQuery = "",
}: StackFileTreeProps) {
  // Normalize search query for filtering
  const normalizedSearch = searchQuery.trim().toLowerCase();

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

  return (
    <div>
      {LAYER_ORDER.map((layer, layerIndex) => {
        const layerConfig = LAYER_CONFIG[layer];
        const LayerIcon = layerConfig.icon;
        const files = layers[layer];

        // Apply type filter and search filter
        let filteredFiles = files;
        if (typeFilter) {
          filteredFiles = filteredFiles.filter((f) => f.type === typeFilter);
        }
        if (normalizedSearch) {
          filteredFiles = filteredFiles.filter((f) =>
            f.name.toLowerCase().includes(normalizedSearch)
          );
        }

        const existingFiles = filteredFiles.filter((f) => f.exists);
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
              className="w-full flex items-center gap-1 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors uppercase tracking-wider"
            >
              <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center text-[var(--text-tertiary)]">
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3" />
                ) : (
                  <ChevronRight className="w-3 h-3" />
                )}
              </span>
              <LayerIcon className="w-4 h-4 flex-shrink-0" />
              <span className="flex-1 text-left">{layerConfig.label}</span>
              <span className="text-[10px] font-normal normal-case text-[var(--text-tertiary)]">
                {existingFiles.length} file{existingFiles.length !== 1 ? "s" : ""}
              </span>
            </button>

            {/* Files in this layer */}
            {isExpanded && (
              <>
                {existingFiles.length === 0 && (!isLocalLayer || typeFilter || normalizedSearch) ? (
                  <div
                    className="flex items-center gap-1 px-2 py-1 text-sm text-[var(--text-tertiary)] italic"
                    style={{ paddingLeft: "24px" }}
                  >
                    {/* Spacer to align with chevron + icon */}
                    <span className="w-4 flex-shrink-0" />
                    <span className="w-4 flex-shrink-0" />
                    {typeFilter || normalizedSearch ? "No matching files" : "No files"}
                  </div>
                ) : (
                  (Object.keys(TYPE_CONFIG) as ConfigFileType[]).map((type) => {
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
                          const isSelected = selectedFile?.path === file.path;
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
                                w-full flex items-center gap-1 px-2 py-1 text-sm text-left
                                transition-colors
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
                              <span className="w-4 flex-shrink-0" />
                              <Icon className={`w-4 h-4 flex-shrink-0 ${!file.exists ? "opacity-50" : config.color}`} />
                              <span className="truncate flex-1">{file.name}</span>
                              {!file.exists && (
                                <Plus className="w-4 h-4 flex-shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    );
                  })
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
