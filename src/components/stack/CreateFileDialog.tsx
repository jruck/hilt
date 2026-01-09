"use client";

import { useState } from "react";
import { X, Save } from "lucide-react";
import type { ConfigFile } from "@/lib/claude-config/types";

interface CreateFileDialogProps {
  file: ConfigFile;
  onClose: () => void;
  onCreated: () => void;
}

const TEMPLATES: Record<string, string> = {
  "CLAUDE.local.md": `# Personal Notes

Add your personal instructions for this project here.
This file is gitignored and won't be shared with the team.

## My Preferences

-
`,
  "settings.local.json": `{
  "permissions": {
    "defaultMode": "default"
  }
}
`,
};

function getDefaultContent(file: ConfigFile): string {
  // Check for template
  if (TEMPLATES[file.name]) {
    return TEMPLATES[file.name];
  }

  // Generate based on type
  switch (file.type) {
    case "memory":
      return `# ${file.name.replace(".md", "")}\n\nAdd your instructions here.\n`;
    case "settings":
      return "{\n  \n}\n";
    case "command":
      return `---
description: "Description of what this command does"
argument-hint: "{{arg1}}"
---

# Command Instructions

Describe what Claude should do when this command is invoked.
`;
    case "skill":
      return `---
name: skill-name
description: "What this skill teaches Claude"
---

# Skill Content

Add your skill instructions here.
`;
    case "agent":
      return `---
name: "Agent Name"
description: "What this agent specializes in"
model: "claude-sonnet-4-5"
tools:
  - Read
  - Edit
  - Bash
---

# Agent Instructions

Describe the specialized behavior for this agent.
`;
    default:
      return "";
  }
}

export function CreateFileDialog({ file, onClose, onCreated }: CreateFileDialogProps) {
  const [content, setContent] = useState(() => getDefaultContent(file));
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setIsSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/claude-stack/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          content,
          createDirectories: true,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onCreated();
      } else {
        setError(result.error || "Failed to create file");
      }
    } catch {
      setError("Failed to create file");
    }

    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-[var(--bg-primary)] rounded-lg shadow-xl w-[600px] max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
          <div>
            <div className="font-medium">Create {file.name}</div>
            <div className="text-xs text-[var(--text-secondary)]">{file.relativePath}</div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Error */}
        {error && (
          <div className="px-4 py-2 bg-red-500/10 text-red-500 text-sm">{error}</div>
        )}

        {/* Editor */}
        <div className="flex-1 p-4 overflow-auto">
          <textarea
            value={content}
            onChange={(e) => setContent(e.target.value)}
            className="w-full h-64 font-mono text-sm bg-[var(--bg-secondary)] rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            spellCheck={false}
            autoFocus
          />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border-primary)]">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm hover:bg-[var(--bg-secondary)]"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={isSaving}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-[var(--accent-primary)] text-white text-sm disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5" />
            {isSaving ? "Creating..." : "Create File"}
          </button>
        </div>
      </div>
    </div>
  );
}
