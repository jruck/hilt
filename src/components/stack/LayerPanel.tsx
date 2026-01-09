"use client";

import { Lock, User, Folder, FileEdit } from "lucide-react";
import type { ConfigLayer, ClaudeStack } from "@/lib/claude-config/types";

interface LayerPanelProps {
  layers: ClaudeStack["layers"];
  selectedLayer: ConfigLayer;
  onSelectLayer: (layer: ConfigLayer) => void;
}

const LAYER_CONFIG = {
  system: { label: "System", icon: Lock, description: "Enterprise managed" },
  user: { label: "User", icon: User, description: "~/.claude/" },
  project: { label: "Project", icon: Folder, description: ".claude/" },
  local: { label: "Local", icon: FileEdit, description: "Personal overrides" },
} as const;

export function LayerPanel({ layers, selectedLayer, onSelectLayer }: LayerPanelProps) {
  return (
    <div className="p-3">
      <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-3">
        Stack Layers
      </div>
      <div className="space-y-1">
        {(Object.keys(LAYER_CONFIG) as ConfigLayer[]).map((layer) => {
          const config = LAYER_CONFIG[layer];
          const Icon = config.icon;
          const existingCount = layers[layer].filter((f) => f.exists).length;

          return (
            <button
              key={layer}
              onClick={() => onSelectLayer(layer)}
              className={`
                w-full flex items-center gap-2 px-2 py-2 rounded-md text-sm
                transition-colors text-left
                ${
                  selectedLayer === layer
                    ? "bg-[var(--bg-elevated)] text-[var(--text-primary)]"
                    : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                }
              `}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="font-medium">{config.label}</div>
                <div className="text-xs text-[var(--text-tertiary)] truncate">
                  {config.description}
                </div>
              </div>
              {existingCount > 0 && (
                <span className="text-xs bg-[var(--bg-tertiary)] px-1.5 py-0.5 rounded">
                  {existingCount}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
