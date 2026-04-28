"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useConfigFile } from "@/hooks/useClaudeStack";
import { Edit2, Save, X, Copy, Check, AlertTriangle, ChevronRight, Loader2, FolderOpen } from "lucide-react";
import { CodeViewer } from "@/components/docs/CodeViewer";
import { DocsEditToggle } from "@/components/docs/DocsEditToggle";
import type { ConfigFile, ConfigLayer, ConfigFileType } from "@/lib/claude-config/types";

// Dynamic import for MDXEditor (no SSR)
const DocsEditor = dynamic(
  () => import("@/components/docs/DocsEditor").then((mod) => mod.DocsEditor),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    ),
  }
);

interface StackContentPaneProps {
  file: ConfigFile | null;
  layer: ConfigLayer;
  scopePath: string;
  onFileUpdated?: () => void;
  isCreating?: boolean;
  onCreateComplete?: () => void;
  onCancelCreate?: () => void;
}

const LAYER_LABELS: Record<ConfigLayer, string> = {
  system: "System",
  user: "User",
  project: "Project",
  local: "Local",
};

const TYPE_LABELS: Record<ConfigFileType, string> = {
  memory: "Memory",
  settings: "Settings",
  command: "Commands",
  skill: "Skills",
  agent: "Agents",
  hook: "Hooks",
  mcp: "MCP",
  env: "Environment",
};

// Templates for new files
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

function StackBreadcrumbs({ layer, file }: { layer: ConfigLayer; file: ConfigFile }) {
  return (
    <div className="flex items-center gap-1.5 text-sm min-w-0">
      <span className="text-[var(--text-tertiary)]">{LAYER_LABELS[layer]}</span>
      <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="text-[var(--text-tertiary)]">{TYPE_LABELS[file.type]}</span>
      <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
      <span className="text-[var(--text-primary)] font-medium truncate">{file.name}</span>
    </div>
  );
}

export function StackContentPane({
  file,
  layer,
  scopePath,
  onFileUpdated,
  isCreating,
  onCreateComplete,
  onCancelCreate,
}: StackContentPaneProps) {
  const { file: fileContent, isLoading, saveFile } = useConfigFile(file?.path || "", scopePath);
  const [isEditMode, setIsEditMode] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [createContent, setCreateContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // CodeMirror edits are byte-exact: compare directly against the loaded file content.
  const hasUnsavedChanges = isEditMode && fileContent?.content !== undefined && editContent !== fileContent.content;

  // Initialize create content when entering create mode
  useEffect(() => {
    if (isCreating && file) {
      setCreateContent(getDefaultContent(file));
    }
  }, [isCreating, file]);

  // Handle file creation
  const handleCreate = useCallback(async () => {
    if (!file) return;

    setIsSaving(true);
    setSaveError(null);

    try {
      const response = await fetch("/api/claude-stack/file", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: file.path,
          content: createContent,
          createDirectories: true,
        }),
      });

      const result = await response.json();

      if (result.success) {
        onCreateComplete?.();
      } else {
        setSaveError(result.error || "Failed to create file");
      }
    } catch {
      setSaveError("Failed to create file");
    }

    setIsSaving(false);
  }, [file, createContent, onCreateComplete]);

  // Reset state when file changes
  useEffect(() => {
    setIsEditMode(false);
    setEditContent("");
    setSaveError(null);
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0;
    }
  }, [file?.path]);

  // Update editContent when fileContent loads
  useEffect(() => {
    if (fileContent?.content && isEditMode) {
      setEditContent(fileContent.content);
    }
  }, [fileContent?.content, isEditMode]);

  const handleModeToggle = useCallback((newEditMode: boolean) => {
    if (!newEditMode && hasUnsavedChanges) {
      const confirmed = window.confirm("You have unsaved changes. Discard them?");
      if (!confirmed) return;
    }
    if (newEditMode && fileContent?.content) {
      setEditContent(fileContent.content);
    }
    setIsEditMode(newEditMode);
    setSaveError(null);
  }, [hasUnsavedChanges, fileContent?.content]);

  const handleContentChange = useCallback((newContent: string) => {
    setEditContent(newContent);
  }, []);

  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveFile(editContent);
    setIsSaving(false);
    if (result.success) {
      setIsEditMode(false);
      onFileUpdated?.();
    } else {
      setSaveError(result.error || "Failed to save");
    }
  }, [editContent, saveFile, onFileUpdated]);

  // Keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        if (hasUnsavedChanges) {
          handleSave();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasUnsavedChanges, handleSave]);

  const handleCopy = useCallback(async () => {
    if (fileContent?.content) {
      await navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [fileContent?.content]);

  const handleRevealInFinder = useCallback(async () => {
    if (!file?.path) return;
    await fetch("/api/reveal", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: file.path }),
    });
  }, [file?.path]);

  // No file selected
  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-[var(--text-tertiary)]">
        <div className="text-base mb-2">Select a file to preview</div>
        <div className="text-sm">
          Choose a configuration file from the list to view or edit its contents
        </div>
      </div>
    );
  }

  // Create mode - show editor for new file
  if (isCreating) {
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    const isMarkdown = extension === "md";

    return (
      <div className="h-full flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
          <div className="flex items-center gap-1.5 text-sm min-w-0">
            <span className="text-[var(--text-tertiary)]">{LAYER_LABELS[layer]}</span>
            <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
            <span className="text-[var(--text-tertiary)]">{TYPE_LABELS[file.type]}</span>
            <ChevronRight className="w-3 h-3 text-[var(--text-tertiary)] flex-shrink-0" />
            <span className="text-[var(--text-primary)] font-medium truncate">
              {file.name}
              <span className="text-[var(--text-tertiary)] font-normal ml-2">(new)</span>
            </span>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Save error */}
            {saveError && (
              <span className="text-xs text-red-500">{saveError}</span>
            )}

            {/* Cancel button */}
            <button
              onClick={onCancelCreate}
              className="px-3 py-1 rounded-md text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              Cancel
            </button>

            {/* Create button */}
            <button
              onClick={handleCreate}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-sm font-medium transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Create File
            </button>
          </div>
        </div>

        {/* Content - always in edit mode */}
        <div ref={scrollContainerRef} className="flex-1 overflow-auto">
          {isMarkdown ? (
            <DocsEditor
              markdown={createContent}
              onChange={setCreateContent}
              readOnly={false}
              currentFilePath={file.path}
              scopePath={scopePath}
              fileTree={null}
              onNavigateToFile={() => {}}
            />
          ) : (
            <CodeViewer
              filePath={file.path}
              content={createContent}
              readOnly={false}
              onChange={setCreateContent}
            />
          )}
        </div>
      </div>
    );
  }

  // Loading
  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  // Error loading
  if (!fileContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Failed to load file</div>
      </div>
    );
  }

  // Sensitive file warning
  if (fileContent.isSensitive) {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] min-h-[44px]">
          <StackBreadcrumbs layer={layer} file={file} />
        </div>

        <div className="p-4">
          <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-4">
            <div className="flex items-center gap-2 font-medium text-yellow-600">
              <AlertTriangle className="w-4 h-4" />
              Sensitive File
            </div>
            <div className="text-sm text-[var(--text-secondary)] mt-1">
              This file may contain secrets and is not displayed for security reasons.
            </div>
          </div>
        </div>
      </div>
    );
  }

  const displayContent = isEditMode ? editContent : (fileContent.content || "");
  const extension = file.name.split(".").pop()?.toLowerCase() || "";
  const isMarkdown = extension === "md";

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-default)] gap-4 min-h-[44px]">
        <StackBreadcrumbs layer={layer} file={file} />

        <div className="flex items-center gap-2 flex-shrink-0">
          {/* Copy button */}
          <button
            onClick={handleCopy}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            title="Copy content"
            disabled={!fileContent.content}
          >
            {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
          </button>

          {/* Reveal in Finder */}
          <button
            onClick={handleRevealInFinder}
            className="p-1.5 rounded text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
            title="Reveal in Finder"
          >
            <FolderOpen className="w-4 h-4" />
          </button>

          {/* Save button - shown when there are unsaved changes */}
          {hasUnsavedChanges && (
            <button
              onClick={handleSave}
              disabled={isSaving}
              className="flex items-center gap-1.5 px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50 text-xs font-medium transition-colors"
            >
              {isSaving ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Save
            </button>
          )}

          {/* Save error */}
          {saveError && (
            <span className="text-xs text-red-500">{saveError}</span>
          )}

          {/* Edit toggle */}
          {fileContent.isEditable && (
            <DocsEditToggle
              isEditMode={isEditMode}
              onToggle={handleModeToggle}
            />
          )}
        </div>
      </div>

      {/* Content */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        {isMarkdown ? (
          <DocsEditor
            markdown={displayContent}
            onChange={isEditMode ? handleContentChange : undefined}
            readOnly={!isEditMode}
            currentFilePath={file.path}
            scopePath={scopePath}
            fileTree={null}
            onNavigateToFile={() => {}}
          />
        ) : (
          <CodeViewer
            filePath={file.path}
            content={displayContent}
            readOnly={!isEditMode}
            onChange={isEditMode ? handleContentChange : undefined}
          />
        )}
      </div>
    </div>
  );
}
