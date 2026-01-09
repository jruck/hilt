"use client";

import { FileText, Terminal, Sparkles, Bot, Webhook, Server, Settings, Key, ExternalLink } from "lucide-react";
import type { ClaudeStack, ConfigFileType } from "@/lib/claude-config/types";

interface StackSummaryProps {
  summary: ClaudeStack["summary"];
  activeFilter: ConfigFileType | null;
  onFilterChange: (type: ConfigFileType | null) => void;
}

const SUMMARY_ITEMS: Array<{
  type: ConfigFileType;
  icon: typeof FileText;
  label: string;
  color: string;
  description: string;
  docsUrl: string;
  summaryKey: keyof ClaudeStack["summary"];
}> = [
  {
    type: "memory",
    icon: FileText,
    label: "Memory",
    color: "text-blue-500",
    description: "CLAUDE.md files that persist context and instructions across sessions. Use for project conventions, preferences, and background knowledge.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/memory",
    summaryKey: "memoryFiles",
  },
  {
    type: "settings",
    icon: Settings,
    label: "Settings",
    color: "text-purple-500",
    description: "JSON configuration for permissions, model preferences, and behavior settings. Controls what Claude can and cannot do.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/settings",
    summaryKey: "memoryFiles",
  },
  {
    type: "command",
    icon: Terminal,
    label: "Commands",
    color: "text-green-500",
    description: "Custom slash commands (e.g., /deploy, /test). Markdown files with YAML frontmatter defining reusable workflows.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/slash-commands",
    summaryKey: "commands",
  },
  {
    type: "skill",
    icon: Sparkles,
    label: "Skills",
    color: "text-yellow-500",
    description: "Teaching files that give Claude specialized knowledge or capabilities. Loaded automatically based on context.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/skills",
    summaryKey: "skills",
  },
  {
    type: "agent",
    icon: Bot,
    label: "Agents",
    color: "text-orange-500",
    description: "Specialized sub-agents with custom prompts and tool restrictions. Spawned via the Task tool for focused work.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/sub-agents",
    summaryKey: "agents",
  },
  {
    type: "hook",
    icon: Webhook,
    label: "Hooks",
    color: "text-red-500",
    description: "Shell commands that run automatically on events (e.g., before commit, after file edit). For validation and automation.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/hooks",
    summaryKey: "hooks",
  },
  {
    type: "mcp",
    icon: Server,
    label: "MCP Servers",
    color: "text-cyan-500",
    description: "Model Context Protocol servers that extend Claude with external tools and data sources. Configured in settings.json.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/mcp",
    summaryKey: "mcpServers",
  },
  {
    type: "env",
    icon: Key,
    label: "Environment",
    color: "text-gray-500",
    description: "Environment variables (.env files) for API keys and secrets. Never committed to git.",
    docsUrl: "https://docs.anthropic.com/en/docs/claude-code/settings#environment-variables",
    summaryKey: "mcpServers",
  },
];

export function StackSummary({ summary, activeFilter, onFilterChange }: StackSummaryProps) {
  return (
    <div className="px-2 py-1">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
          Filter by Type
        </div>
        {activeFilter && (
          <button
            onClick={() => onFilterChange(null)}
            className="text-[10px] text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            Clear
          </button>
        )}
      </div>
      <div>
        {SUMMARY_ITEMS.map(({ type, icon: Icon, label, color, description, docsUrl, summaryKey }) => {
          const count = summary[summaryKey] || 0;
          const isActive = activeFilter === type;

          return (
            <button
              key={type}
              onClick={() => onFilterChange(isActive ? null : type)}
              className={`
                w-full flex items-center justify-between text-sm px-2 py-0.5 rounded
                transition-colors group relative
                ${isActive
                  ? "bg-[var(--accent-primary)] text-white"
                  : "hover:bg-[var(--bg-secondary)]"
                }
              `}
            >
              <div className="flex items-center gap-2">
                <Icon className={`w-3.5 h-3.5 ${isActive ? "text-white" : color}`} />
                <span className={isActive ? "text-white" : "text-[var(--text-secondary)]"}>
                  {label}
                </span>
              </div>
              <span className={`font-mono text-xs ${isActive ? "text-white/80" : "text-[var(--text-tertiary)]"}`}>
                {count}
              </span>

              {/* Tooltip with invisible bridge for hover continuity - anchored at bottom to prevent clipping */}
              <div
                className="absolute left-full bottom-0 z-50 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all pl-2"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="w-72 p-3 rounded-md bg-[var(--bg-elevated)] border border-[var(--border-default)] shadow-lg">
                <div className="font-medium text-[var(--text-primary)] mb-1.5 text-left">{label}</div>
                <p className="text-xs text-[var(--text-secondary)] text-left leading-relaxed mb-2">
                  {description}
                </p>
                <a
                  href={docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-[var(--accent-primary)] hover:underline text-left"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3 h-3 flex-shrink-0" />
                  View documentation
                </a>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
