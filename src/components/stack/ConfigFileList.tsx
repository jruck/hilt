"use client";

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
  ChevronRight,
} from "lucide-react";
import type { ConfigFile, ConfigFileType, ConfigLayer } from "@/lib/claude-config/types";

interface ConfigFileListProps {
  files: ConfigFile[];
  layer: ConfigLayer;
  selectedFile: ConfigFile | null;
  onSelectFile: (file: ConfigFile) => void;
  onCreateFile?: (file: ConfigFile) => void;
}

const TYPE_CONFIG: Record<ConfigFileType, { icon: typeof FileText; label: string; color: string }> =
  {
    memory: { icon: FileText, label: "Memory", color: "text-blue-500" },
    settings: { icon: Settings, label: "Settings", color: "text-purple-500" },
    command: { icon: Terminal, label: "Commands", color: "text-green-500" },
    skill: { icon: Sparkles, label: "Skills", color: "text-yellow-500" },
    agent: { icon: Bot, label: "Agents", color: "text-orange-500" },
    hook: { icon: Webhook, label: "Hooks", color: "text-red-500" },
    mcp: { icon: Server, label: "MCP", color: "text-cyan-500" },
    env: { icon: Key, label: "Environment", color: "text-gray-500" },
  };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}M`;
}

export function ConfigFileList({
  files,
  layer,
  selectedFile,
  onSelectFile,
  onCreateFile,
}: ConfigFileListProps) {
  // Group files by type
  const grouped = files.reduce(
    (acc, file) => {
      if (!acc[file.type]) acc[file.type] = [];
      acc[file.type].push(file);
      return acc;
    },
    {} as Record<ConfigFileType, ConfigFile[]>
  );

  const existingFiles = files.filter((f) => f.exists);
  const isEmpty = existingFiles.length === 0;

  // For local layer, always show placeholders for missing files
  const isLocalLayer = layer === "local";

  if (isEmpty && !isLocalLayer) {
    return (
      <div className="p-4 text-center text-[var(--text-secondary)] text-sm">
        No configuration files found in this layer
      </div>
    );
  }

  return (
    <div className="p-2">
      {(Object.keys(TYPE_CONFIG) as ConfigFileType[]).map((type) => {
        const typeFiles = grouped[type] || [];
        const existingTypeFiles = typeFiles.filter((f) => f.exists);
        const config = TYPE_CONFIG[type];
        const Icon = config.icon;

        // For local layer, show even non-existent files
        const showPlaceholders = isLocalLayer && typeFiles.some((f) => !f.exists);

        if (existingTypeFiles.length === 0 && !showPlaceholders) return null;

        return (
          <div key={type} className="mb-3">
            <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-semibold text-[var(--text-secondary)] uppercase">
              <Icon className={`w-3.5 h-3.5 ${config.color}`} />
              {config.label}
            </div>
            <div className="space-y-0.5">
              {typeFiles.map((file) => (
                <button
                  key={file.path}
                  onClick={() => {
                    if (file.exists) {
                      onSelectFile(file);
                    } else if (onCreateFile) {
                      onCreateFile(file);
                    }
                  }}
                  className={`
                    w-full flex items-center gap-2 px-2 py-1.5 rounded text-sm text-left
                    transition-colors
                    ${
                      !file.exists
                        ? "opacity-50 hover:opacity-75"
                        : selectedFile?.path === file.path
                          ? "bg-[var(--accent-primary)] text-white"
                          : "hover:bg-[var(--bg-secondary)]"
                    }
                  `}
                >
                  <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-50" />
                  <span className="truncate flex-1">{file.name}</span>
                  {!file.exists && <Plus className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />}
                  {file.exists && file.size !== undefined && (
                    <span className="text-xs text-[var(--text-tertiary)]">
                      {formatSize(file.size)}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
