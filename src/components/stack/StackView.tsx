"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import { useClaudeStack } from "@/hooks/useClaudeStack";
import { StackFileTree, type StackFilterType } from "./StackFileTree";
import { StackContentPane } from "./StackContentPane";
import { StackSummary } from "./StackSummary";
import { MCPServerDetail } from "./MCPServerDetail";
import { PluginDetail } from "./PluginDetail";
import type { ConfigLayer, ConfigFile, MCPServerConfig, PluginConfig } from "@/lib/claude-config/types";

// Sidebar width constraints
const MIN_SIDEBAR_WIDTH = 200;
const MAX_SIDEBAR_WIDTH = 600;
const DEFAULT_SIDEBAR_WIDTH = 360;
const STORAGE_KEY = "stack-sidebar-width";

interface StackViewProps {
  scopePath: string;
  searchQuery?: string;
}

export function StackView({ scopePath, searchQuery = "" }: StackViewProps) {
  const { stack, isLoading, isError, mutate } = useClaudeStack(scopePath);
  const [selectedFile, setSelectedFile] = useState<{ file: ConfigFile; layer: ConfigLayer } | null>(null);
  const [selectedMCPServer, setSelectedMCPServer] = useState<MCPServerConfig | null>(null);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginConfig | null>(null);
  const [creatingFile, setCreatingFile] = useState<{ file: ConfigFile; layer: ConfigLayer } | null>(null);
  const [typeFilter, setTypeFilter] = useState<StackFilterType | null>(null);

  // Sidebar resize state
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SIDEBAR_WIDTH;
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (!isNaN(parsed) && parsed >= MIN_SIDEBAR_WIDTH && parsed <= MAX_SIDEBAR_WIDTH) {
        return parsed;
      }
    }
    return DEFAULT_SIDEBAR_WIDTH;
  });
  const [isResizing, setIsResizing] = useState(false);
  const resizeRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  // Resize handlers
  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
    resizeRef.current = { startX: e.clientX, startWidth: sidebarWidth };
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = e.clientX - resizeRef.current.startX;
      const newWidth = Math.min(
        MAX_SIDEBAR_WIDTH,
        Math.max(MIN_SIDEBAR_WIDTH, resizeRef.current.startWidth + delta)
      );
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
    return () => {
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isResizing]);

  const handleFileUpdated = useCallback(() => {
    mutate();
  }, [mutate]);

  const handleCreateFile = useCallback((file: ConfigFile, layer: ConfigLayer) => {
    setCreatingFile({ file, layer });
    setSelectedFile(null);
  }, []);

  const handleCreateComplete = useCallback(() => {
    setCreatingFile(null);
    mutate();
  }, [mutate]);

  const handleCancelCreate = useCallback(() => {
    setCreatingFile(null);
  }, []);

  const handleSelectFile = useCallback((file: ConfigFile, layer: ConfigLayer) => {
    setSelectedFile({ file, layer });
    setSelectedMCPServer(null);
    setSelectedPlugin(null);
    setCreatingFile(null);
  }, []);

  const handleSelectMCPServer = useCallback((server: MCPServerConfig) => {
    setSelectedMCPServer(server);
    setSelectedFile(null);
    setSelectedPlugin(null);
    setCreatingFile(null);
  }, []);

  const handleSelectPlugin = useCallback((plugin: PluginConfig) => {
    setSelectedPlugin(plugin);
    setSelectedFile(null);
    setSelectedMCPServer(null);
    setCreatingFile(null);
  }, []);

  const handleToggleMCPServer = useCallback(async (server: MCPServerConfig, enabled: boolean) => {
    if (!server.pluginId) {
      // User-defined servers can't be toggled via this mechanism
      return;
    }

    try {
      const response = await fetch("/api/claude-stack/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: server.pluginId, enabled }),
      });

      if (response.ok) {
        // Update local state
        setSelectedMCPServer((prev) =>
          prev && prev.name === server.name && prev.source === server.source
            ? { ...prev, enabled }
            : prev
        );
        // Refresh the stack
        mutate();
      }
    } catch (error) {
      console.error("Failed to toggle MCP server:", error);
    }
  }, [mutate]);

  const handleTogglePlugin = useCallback(async (plugin: PluginConfig, enabled: boolean) => {
    try {
      const response = await fetch("/api/claude-stack/mcp", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pluginId: plugin.id, enabled }),
      });

      if (response.ok) {
        // Update local state
        setSelectedPlugin((prev) =>
          prev && prev.id === plugin.id
            ? { ...prev, enabled }
            : prev
        );
        // Refresh the stack
        mutate();
      }
    } catch (error) {
      console.error("Failed to toggle plugin:", error);
    }
  }, [mutate]);

  // Navigate from plugin detail to MCP server detail
  const handlePluginMCPServerClick = useCallback((serverName: string) => {
    const server = stack?.mcpServers.find((s) => s.name === serverName);
    if (server) {
      handleSelectMCPServer(server);
    }
  }, [stack?.mcpServers, handleSelectMCPServer]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Loading configuration stack...</div>
      </div>
    );
  }

  // No scope selected - show helpful message
  if (!scopePath) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-tertiary)]">Select a project folder to view configuration</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-500">Failed to load configuration</div>
      </div>
    );
  }

  // Stack loaded but might be empty (e.g., system level with no managed settings)
  if (!stack) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-tertiary)]">No configuration available</div>
      </div>
    );
  }

  return (
    <div className={`flex h-full ${isResizing ? "select-none" : ""}`}>
      {/* Sidebar - All layers with dividers */}
      <div className="flex-shrink-0 flex flex-col relative border-r border-[var(--border-default)]" style={{ width: sidebarWidth }}>
        {/* Unified file tree for all layers */}
        <div className="flex-1 overflow-y-auto pt-1.5 pb-1">
          <StackFileTree
            layers={stack.layers}
            mcpServers={stack.mcpServers}
            plugins={stack.plugins}
            selectedFile={selectedFile?.file || null}
            selectedMCPServer={selectedMCPServer}
            selectedPlugin={selectedPlugin}
            onSelectFile={handleSelectFile}
            onSelectMCPServer={handleSelectMCPServer}
            onSelectPlugin={handleSelectPlugin}
            onCreateFile={handleCreateFile}
            typeFilter={typeFilter}
            searchQuery={searchQuery}
          />
        </div>

        {/* Summary with filter */}
        <div className="border-t border-[var(--border-default)] flex-shrink-0">
          <StackSummary
            summary={stack.summary}
            activeFilter={typeFilter}
            onFilterChange={setTypeFilter}
          />
        </div>

        {/* Resize handle */}
        <div
          className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--accent-primary)] transition-colors ${
            isResizing ? "bg-[var(--accent-primary)]" : "bg-transparent"
          }`}
          onMouseDown={handleResizeStart}
        />
      </div>

      {/* Content pane */}
      <div className="flex-1 overflow-hidden">
        {selectedPlugin ? (
          <PluginDetail
            plugin={selectedPlugin}
            onToggleEnabled={handleTogglePlugin}
            onMCPServerClick={handlePluginMCPServerClick}
          />
        ) : selectedMCPServer ? (
          <MCPServerDetail
            server={selectedMCPServer}
            onToggleEnabled={selectedMCPServer.pluginId ? handleToggleMCPServer : undefined}
            onServerUpdated={handleFileUpdated}
          />
        ) : (
          <StackContentPane
            file={creatingFile?.file || selectedFile?.file || null}
            layer={creatingFile?.layer || selectedFile?.layer || "project"}
            scopePath={scopePath}
            onFileUpdated={handleFileUpdated}
            isCreating={!!creatingFile}
            onCreateComplete={handleCreateComplete}
            onCancelCreate={handleCancelCreate}
          />
        )}
      </div>
    </div>
  );
}
