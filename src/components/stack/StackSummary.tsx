"use client";

import { FileText, Terminal, Sparkles, Bot, Webhook, Server } from "lucide-react";
import type { ClaudeStack } from "@/lib/claude-config/types";

interface StackSummaryProps {
  summary: ClaudeStack["summary"];
}

export function StackSummary({ summary }: StackSummaryProps) {
  const items = [
    { icon: FileText, label: "Memory", count: summary.memoryFiles, color: "text-blue-500" },
    { icon: Terminal, label: "Commands", count: summary.commands, color: "text-green-500" },
    { icon: Sparkles, label: "Skills", count: summary.skills, color: "text-yellow-500" },
    { icon: Bot, label: "Agents", count: summary.agents, color: "text-orange-500" },
    { icon: Webhook, label: "Hooks", count: summary.hooks, color: "text-red-500" },
    { icon: Server, label: "MCP", count: summary.mcpServers, color: "text-cyan-500" },
  ];

  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-2">
        Summary
      </div>
      <div className="space-y-1">
        {items.map(({ icon: Icon, label, count, color }) => (
          <div key={label} className="flex items-center justify-between text-sm">
            <div className="flex items-center gap-2">
              <Icon className={`w-3.5 h-3.5 ${color}`} />
              <span className="text-[var(--text-secondary)]">{label}</span>
            </div>
            <span className="font-mono">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
