"use client";

import { useState } from "react";
import { useConfigFile } from "@/hooks/useClaudeStack";
import { Edit2, Save, X, Copy, Check, AlertTriangle } from "lucide-react";
import type { ConfigFile } from "@/lib/claude-config/types";

interface ConfigPreviewProps {
  file: ConfigFile;
  scopePath: string;
  onFileUpdated?: () => void;
}

export function ConfigPreview({ file, scopePath, onFileUpdated }: ConfigPreviewProps) {
  const { file: fileContent, isLoading, saveFile } = useConfigFile(file.path, scopePath);
  const [isEditing, setIsEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleEdit = () => {
    setEditContent(fileContent?.content || "");
    setIsEditing(true);
    setSaveError(null);
  };

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError(null);
    const result = await saveFile(editContent);
    setIsSaving(false);
    if (result.success) {
      setIsEditing(false);
      onFileUpdated?.();
    } else {
      setSaveError(result.error || "Failed to save");
    }
  };

  const handleCopy = async () => {
    if (fileContent?.content) {
      await navigator.clipboard.writeText(fileContent.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Loading...</div>
      </div>
    );
  }

  if (!fileContent) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-[var(--text-secondary)]">Failed to load file</div>
      </div>
    );
  }

  if (fileContent.isSensitive) {
    return (
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
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-primary)]">
        <div>
          <div className="font-medium text-sm">{file.name}</div>
          <div className="text-xs text-[var(--text-secondary)]">{file.relativePath}</div>
        </div>
        <div className="flex items-center gap-2">
          {!isEditing && (
            <>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
                title="Copy content"
                disabled={!fileContent.content}
              >
                {copied ? (
                  <Check className="w-4 h-4 text-green-500" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              {fileContent.isEditable && (
                <button
                  onClick={handleEdit}
                  className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--bg-secondary)] hover:bg-[var(--bg-tertiary)] text-sm"
                >
                  <Edit2 className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </>
          )}
          {isEditing && (
            <>
              <button
                onClick={() => {
                  setIsEditing(false);
                  setSaveError(null);
                }}
                className="p-1.5 rounded hover:bg-[var(--bg-secondary)] text-[var(--text-secondary)]"
              >
                <X className="w-4 h-4" />
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-1.5 px-2 py-1 rounded bg-[var(--accent-primary)] text-white text-sm disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                {isSaving ? "Saving..." : "Save"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Save error */}
      {saveError && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/20 text-red-500 text-sm">
          {saveError}
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {isEditing ? (
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-full font-mono text-sm bg-[var(--bg-secondary)] rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)]"
            spellCheck={false}
          />
        ) : fileContent.content ? (
          <pre className="font-mono text-sm whitespace-pre-wrap break-words">
            {fileContent.content}
          </pre>
        ) : (
          <div className="text-[var(--text-secondary)] text-sm">No content</div>
        )}
      </div>

      {/* Parsed frontmatter info (for commands/skills) */}
      {fileContent.parsed?.frontmatter &&
        Object.keys(fileContent.parsed.frontmatter).length > 0 &&
        !isEditing && (
          <div className="border-t border-[var(--border-primary)] p-4">
            <div className="text-xs font-semibold text-[var(--text-secondary)] uppercase mb-2">
              Parsed Metadata
            </div>
            <div className="text-sm font-mono bg-[var(--bg-secondary)] rounded p-2 overflow-auto max-h-40">
              <pre>{JSON.stringify(fileContent.parsed.frontmatter, null, 2)}</pre>
            </div>
          </div>
        )}
    </div>
  );
}
