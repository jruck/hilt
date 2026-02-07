"use client";

import { useState, useCallback } from "react";
import { Puzzle, User, Tag, ExternalLink, Server, Calendar, Check, X, Copy, FolderOpen, Sparkles, Bot } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { PluginConfig } from "@/lib/claude-config/types";
import { openExternal } from "@/lib/openExternal";

interface PluginDetailProps {
  plugin: PluginConfig;
  onToggleEnabled?: (plugin: PluginConfig, enabled: boolean) => void;
  onMCPServerClick?: (serverName: string) => void;
}

export function PluginDetail({ plugin, onToggleEnabled, onMCPServerClick }: PluginDetailProps) {
  const isMobile = useIsMobile();
  const [copied, setCopied] = useState(false);

  const handleCopyPath = useCallback(async () => {
    if (plugin.installPath) {
      await navigator.clipboard.writeText(plugin.installPath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [plugin.installPath]);

  const handleRevealInFinder = useCallback(async () => {
    if (plugin.installPath) {
      await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: plugin.installPath }),
      });
    }
  }, [plugin.installPath]);

  // Format date for display
  const formatDate = (dateStr?: string) => {
    if (!dateStr) return null;
    try {
      return new Date(dateStr).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
    } catch {
      return null;
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Puzzle className="w-5 h-5 text-emerald-500" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{plugin.name}</h2>
          </div>
          <div className="flex items-center gap-2">
            {/* Copy path button */}
            <button
              onClick={handleCopyPath}
              title="Copy path"
              className={`rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors ${isMobile ? "p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center" : "p-1.5"}`}
            >
              {copied ? <Check className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4" />}
            </button>
            {/* Reveal in Finder button */}
            <button
              onClick={handleRevealInFinder}
              title="Reveal in Finder"
              className={`rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors ${isMobile ? "p-2.5 min-w-[44px] min-h-[44px] flex items-center justify-center" : "p-1.5"}`}
            >
              <FolderOpen className="w-4 h-4" />
            </button>
            {/* Enable/Disable toggle */}
            {onToggleEnabled && (
              <button
                onClick={() => onToggleEnabled(plugin, !plugin.enabled)}
                className={`
                  flex items-center gap-1.5 px-3 rounded-md text-sm font-medium
                  transition-colors
                  ${isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"}
                  ${
                    plugin.enabled
                      ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                      : "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20"
                  }
                `}
              >
                {plugin.enabled ? (
                  <>
                    <Check className="w-4 h-4" />
                    Enabled
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4" />
                    Disabled
                  </>
                )}
              </button>
            )}
            {!onToggleEnabled && (
              <span
                className={`
                  flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm
                  ${plugin.enabled ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-500"}
                `}
              >
                {plugin.enabled ? (
                  <>
                    <Check className="w-4 h-4" />
                    Enabled
                  </>
                ) : (
                  <>
                    <X className="w-4 h-4" />
                    Disabled
                  </>
                )}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Description */}
        {plugin.description && (
          <div>
            <p className="text-[var(--text-secondary)] leading-relaxed">{plugin.description}</p>
          </div>
        )}

        {/* MCP Servers provided by this plugin */}
        {plugin.mcpServerNames.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              MCP Servers
            </h3>

            <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
              {plugin.mcpServerNames.map((serverName) => (
                <button
                  key={serverName}
                  onClick={() => onMCPServerClick?.(serverName)}
                  className={`flex items-center gap-2 w-full text-left px-2 rounded
                    hover:bg-[var(--bg-tertiary)] transition-colors group ${isMobile ? "py-3 min-h-[48px]" : "py-1.5"}`}
                >
                  <Server className="w-4 h-4 text-cyan-500" />
                  <span className="text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-primary)]">
                    {serverName}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Skills provided by this plugin */}
        {plugin.skillNames && plugin.skillNames.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              Skills
            </h3>

            <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
              {plugin.skillNames.map((skillName) => (
                <div
                  key={skillName}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  <Sparkles className="w-4 h-4 text-rose-500" />
                  <span className="text-sm text-[var(--text-primary)]">
                    {skillName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Agents provided by this plugin */}
        {plugin.agentNames && plugin.agentNames.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              Agents
            </h3>

            <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
              {plugin.agentNames.map((agentName) => (
                <div
                  key={agentName}
                  className="flex items-center gap-2 px-2 py-1.5"
                >
                  <Bot className="w-4 h-4 text-orange-500" />
                  <span className="text-sm text-[var(--text-primary)]">
                    {agentName}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Plugin Details */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            Details
          </h3>

          <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
            {/* Author */}
            {plugin.author?.name && (
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-[var(--text-tertiary)]" />
                <span className="text-sm text-[var(--text-tertiary)]">Author:</span>
                <span className="text-sm text-[var(--text-primary)]">{plugin.author.name}</span>
              </div>
            )}

            {/* Version */}
            <div className="flex items-center gap-2">
              <Tag className="w-4 h-4 text-[var(--text-tertiary)]" />
              <span className="text-sm text-[var(--text-tertiary)]">Version:</span>
              <span className="text-sm text-[var(--text-primary)] font-mono">{plugin.version}</span>
            </div>

            {/* Marketplace */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-[var(--text-tertiary)]">Marketplace:</span>
              <span className="text-sm text-[var(--text-primary)]">{plugin.marketplace}</span>
            </div>

            {/* License */}
            {plugin.license && (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">License:</span>
                <span className="text-sm text-[var(--text-primary)]">{plugin.license}</span>
              </div>
            )}

            {/* Dates */}
            {(plugin.installedAt || plugin.lastUpdated) && (
              <div className="pt-2 space-y-1">
                {plugin.installedAt && formatDate(plugin.installedAt) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="text-sm text-[var(--text-tertiary)]">Installed:</span>
                    <span className="text-sm text-[var(--text-primary)]">
                      {formatDate(plugin.installedAt)}
                    </span>
                  </div>
                )}
                {plugin.lastUpdated && formatDate(plugin.lastUpdated) && (
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="text-sm text-[var(--text-tertiary)]">Updated:</span>
                    <span className="text-sm text-[var(--text-primary)]">
                      {formatDate(plugin.lastUpdated)}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Links */}
            {(plugin.homepage || plugin.repository) && (
              <div className="flex flex-wrap gap-2 pt-2">
                {plugin.homepage && (
                  <button
                    onClick={() => openExternal(plugin.homepage!)}
                    className="inline-flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Homepage
                  </button>
                )}
                {plugin.repository && (
                  <button
                    onClick={() => openExternal(plugin.repository!)}
                    className="inline-flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline"
                  >
                    <ExternalLink className="w-3 h-3" />
                    Repository
                  </button>
                )}
              </div>
            )}

            {/* Keywords */}
            {plugin.keywords && plugin.keywords.length > 0 && (
              <div className="pt-2">
                <div className="flex flex-wrap gap-1">
                  {plugin.keywords.map((keyword) => (
                    <span
                      key={keyword}
                      className="px-2 py-0.5 text-xs bg-[var(--bg-tertiary)] text-[var(--text-secondary)] rounded"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Install Path (collapsible/technical detail) */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            Install Location
          </h3>

          <div className="bg-[var(--bg-secondary)] rounded-md p-3">
            <code className="text-xs text-[var(--text-secondary)] font-mono break-all">
              {plugin.installPath}
            </code>
            {plugin.gitCommitSha && (
              <div className="mt-2 text-xs text-[var(--text-tertiary)]">
                Git SHA: <span className="font-mono">{plugin.gitCommitSha.slice(0, 12)}</span>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
