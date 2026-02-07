"use client";

import { useState, useCallback } from "react";
import { Server, Terminal, Globe, ExternalLink, User, Tag, Check, X, Pencil, Save, ShieldCheck, ShieldAlert, ShieldOff, ShieldQuestion, Copy, FolderOpen } from "lucide-react";
import { useIsMobile } from "@/hooks/useIsMobile";
import type { MCPServerConfig } from "@/lib/claude-config/types";

interface MCPServerDetailProps {
  server: MCPServerConfig;
  onToggleEnabled?: (server: MCPServerConfig, enabled: boolean) => void;
  onServerUpdated?: () => void;
}

export function MCPServerDetail({ server, onToggleEnabled, onServerUpdated }: MCPServerDetailProps) {
  const isMobile = useIsMobile();
  const isFromPlugin = !!server.pluginId;
  const metadata = server.pluginMetadata;
  const isEditable = !isFromPlugin; // User-defined servers are editable

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCopyPath = useCallback(async () => {
    if (server.source) {
      await navigator.clipboard.writeText(server.source);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [server.source]);

  const handleRevealInFinder = useCallback(async () => {
    if (server.source) {
      await fetch("/api/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: server.source }),
      });
    }
  }, [server.source]);

  const handleEdit = useCallback(() => {
    // Build the config object for editing
    const config: Record<string, unknown> = {};
    if (server.type === "stdio") {
      if (server.command) config.command = server.command;
      if (server.args && server.args.length > 0) config.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) config.env = server.env;
    } else if (server.type === "http") {
      config.type = "http";
      if (server.url) config.url = server.url;
      if (server.headers && Object.keys(server.headers).length > 0) config.headers = server.headers;
    }
    setEditValue(JSON.stringify(config, null, 2));
    setError(null);
    setIsEditing(true);
  }, [server]);

  const handleCancel = useCallback(() => {
    setIsEditing(false);
    setEditValue("");
    setError(null);
  }, []);

  const handleSave = useCallback(async () => {
    setError(null);
    setIsSaving(true);

    try {
      // Validate JSON
      const config = JSON.parse(editValue);

      const response = await fetch("/api/claude-stack/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverName: server.name, config }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || "Failed to save");
      }

      setIsEditing(false);
      setEditValue("");
      onServerUpdated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setIsSaving(false);
    }
  }, [editValue, server.name, onServerUpdated]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-[var(--border-default)]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Server className="w-5 h-5 text-cyan-500" />
            <h2 className="text-lg font-semibold text-[var(--text-primary)]">{server.name}</h2>
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
            {/* Edit button for user-defined servers */}
            {isEditable && !isEditing && (
              <button
                onClick={handleEdit}
                className={`flex items-center gap-1.5 px-3 rounded-md text-sm font-medium
                  bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]
                  transition-colors ${isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"}`}
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>
            )}
            {/* Enable/Disable toggle */}
            {onToggleEnabled && (
              <button
                onClick={() => onToggleEnabled(server, !server.enabled)}
                className={`
                  flex items-center gap-1.5 px-3 rounded-md text-sm font-medium
                  transition-colors
                  ${isMobile ? "py-2.5 min-h-[44px]" : "py-1.5"}
                  ${
                    server.enabled
                      ? "bg-green-500/10 text-green-600 hover:bg-green-500/20"
                      : "bg-gray-500/10 text-gray-500 hover:bg-gray-500/20"
                  }
                `}
              >
                {server.enabled ? (
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
                  ${server.enabled ? "bg-green-500/10 text-green-600" : "bg-gray-500/10 text-gray-500"}
                `}
              >
                {server.enabled ? (
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

      {/* Edit Mode */}
      {isEditing ? (
        <div className="flex-1 flex flex-col p-4 gap-4">
          <div className="text-sm text-[var(--text-secondary)]">
            Edit the JSON configuration for <strong>{server.name}</strong>:
          </div>
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="flex-1 p-3 rounded-md font-mono text-sm
              bg-[var(--bg-secondary)] text-[var(--text-primary)]
              border border-[var(--border-default)] focus:border-[var(--accent-primary)] focus:outline-none
              resize-none"
            spellCheck={false}
          />
          {error && (
            <div className="text-sm text-red-500">{error}</div>
          )}
          <div className="flex justify-end gap-2">
            <button
              onClick={handleCancel}
              disabled={isSaving}
              className="px-4 py-2 rounded-md text-sm font-medium
                bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]
                transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium
                bg-[var(--accent-primary)] text-white hover:bg-[var(--accent-primary-hover)]
                transition-colors disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        /* Content - Read Mode */
        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {/* Description */}
          {metadata?.description && (
            <div>
              <p className="text-[var(--text-secondary)] leading-relaxed">{metadata.description}</p>
            </div>
          )}

          {/* Connection Details */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              Connection
            </h3>

            <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
              {/* Type */}
              <div className="flex items-center gap-2">
                {server.type === "stdio" ? (
                  <Terminal className="w-4 h-4 text-[var(--text-tertiary)]" />
                ) : (
                  <Globe className="w-4 h-4 text-[var(--text-tertiary)]" />
                )}
                <span className="text-sm text-[var(--text-tertiary)]">Type:</span>
                <span className="text-sm text-[var(--text-primary)] font-mono">
                  {server.type === "stdio" ? "Command (stdio)" : "HTTP"}
                </span>
              </div>

              {/* Stdio details */}
              {server.type === "stdio" && server.command && (
                <div className="pl-6 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-[var(--text-tertiary)] w-16">Command:</span>
                    <code className="text-sm text-[var(--text-primary)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                      {server.command}
                    </code>
                  </div>
                  {server.args && server.args.length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-[var(--text-tertiary)] w-16">Args:</span>
                      <code className="text-sm text-[var(--text-primary)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded break-all">
                        {server.args.join(" ")}
                      </code>
                    </div>
                  )}
                </div>
              )}

              {/* HTTP details */}
              {server.type === "http" && server.url && (
                <div className="pl-6 space-y-1">
                  <div className="flex items-start gap-2">
                    <span className="text-sm text-[var(--text-tertiary)] w-16">URL:</span>
                    <code className="text-sm text-[var(--text-primary)] font-mono bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded break-all">
                      {server.url}
                    </code>
                  </div>
                  {server.headers && Object.keys(server.headers).length > 0 && (
                    <div className="flex items-start gap-2">
                      <span className="text-sm text-[var(--text-tertiary)] w-16">Headers:</span>
                      <div className="flex-1">
                        {Object.entries(server.headers).map(([key, value]) => (
                          <div key={key} className="text-sm font-mono">
                            <span className="text-[var(--text-secondary)]">{key}:</span>{" "}
                            <span className="text-[var(--text-tertiary)]">
                              {value.includes("${") ? value : "••••••••"}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Auth Status - only show if server requires auth */}
          {server.authStatus && server.authStatus !== "not-required" && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Authentication
              </h3>

              <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {server.authStatus === "authenticated" && (
                    <>
                      <ShieldCheck className="w-4 h-4 text-blue-500" />
                      <span className="text-sm text-blue-500 font-medium">Authenticated</span>
                    </>
                  )}
                  {server.authStatus === "expired" && (
                    <>
                      <ShieldAlert className="w-4 h-4 text-yellow-500" />
                      <span className="text-sm text-yellow-500 font-medium">Token Expired</span>
                    </>
                  )}
                  {server.authStatus === "needs-reauth" && (
                    <>
                      <ShieldOff className="w-4 h-4 text-red-500" />
                      <span className="text-sm text-red-500 font-medium">Needs Re-authentication</span>
                    </>
                  )}
                  {server.authStatus === "not-configured" && (
                    <>
                      <ShieldQuestion className="w-4 h-4 text-gray-400" />
                      <span className="text-sm text-gray-400 font-medium">Not Configured</span>
                    </>
                  )}
                </div>

                {/* Show expiration time for authenticated tokens */}
                {server.authStatus === "authenticated" && server.authExpiresAt && (
                  <div className="pl-6 text-sm text-[var(--text-secondary)]">
                    Expires: {new Date(server.authExpiresAt).toLocaleString()}
                  </div>
                )}

                {/* Show helpful message based on status */}
                {server.authStatus === "expired" && (
                  <div className="pl-6 text-sm text-[var(--text-secondary)]">
                    Token will auto-refresh on next use
                  </div>
                )}
                {server.authStatus === "needs-reauth" && (
                  <div className="pl-6 text-sm text-[var(--text-secondary)]">
                    Run the server in Claude Code to re-authenticate via OAuth
                  </div>
                )}
                {server.authStatus === "not-configured" && (
                  <div className="pl-6 text-sm text-[var(--text-secondary)]">
                    Server may require authentication - run in Claude Code to configure
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Environment Variables */}
          {server.env && Object.keys(server.env).length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Environment Variables
              </h3>
              <div className="bg-[var(--bg-secondary)] rounded-md p-3">
                {Object.entries(server.env).map(([key, value]) => (
                  <div key={key} className="text-sm font-mono">
                    <span className="text-[var(--text-secondary)]">{key}=</span>
                    <span className="text-[var(--text-tertiary)]">
                      {value.includes("${") ? value : "••••••••"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Source Information */}
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
              Source
            </h3>

            <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">Origin:</span>
                <span className="text-sm text-[var(--text-primary)]">
                  {isFromPlugin ? `Plugin (${server.pluginId})` : "User-defined"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">Layer:</span>
                <span className="text-sm text-[var(--text-primary)] capitalize">{server.layer}</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="text-sm text-[var(--text-tertiary)]">Path:</span>
                <code className="text-xs text-[var(--text-secondary)] font-mono break-all">
                  {server.source}
                </code>
              </div>
            </div>
          </div>

          {/* Plugin Metadata */}
          {metadata && (
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] uppercase tracking-wider">
                Plugin Information
              </h3>

              <div className="bg-[var(--bg-secondary)] rounded-md p-3 space-y-2">
                {metadata.author?.name && (
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="text-sm text-[var(--text-tertiary)]">Author:</span>
                    <span className="text-sm text-[var(--text-primary)]">{metadata.author.name}</span>
                  </div>
                )}

                {metadata.version && (
                  <div className="flex items-center gap-2">
                    <Tag className="w-4 h-4 text-[var(--text-tertiary)]" />
                    <span className="text-sm text-[var(--text-tertiary)]">Version:</span>
                    <span className="text-sm text-[var(--text-primary)] font-mono">{metadata.version}</span>
                  </div>
                )}

                {metadata.license && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-[var(--text-tertiary)]">License:</span>
                    <span className="text-sm text-[var(--text-primary)]">{metadata.license}</span>
                  </div>
                )}

                {/* Links */}
                <div className="flex flex-wrap gap-2 pt-2">
                  {metadata.homepage && (
                    <a
                      href={metadata.homepage}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Homepage
                    </a>
                  )}
                  {metadata.repository && (
                    <a
                      href={metadata.repository}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-[var(--accent-primary)] hover:underline"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Repository
                    </a>
                  )}
                </div>

                {/* Keywords */}
                {metadata.keywords && metadata.keywords.length > 0 && (
                  <div className="pt-2">
                    <div className="flex flex-wrap gap-1">
                      {metadata.keywords.map((keyword) => (
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
          )}
        </div>
      )}
    </div>
  );
}
