"use client";

import { File, FileText, FileCode, FileJson, Image, FolderOpen, Copy, Check } from "lucide-react";
import { useState } from "react";
import * as path from "path";

// File icons by extension
const FILE_ICONS: Record<string, typeof File> = {
  md: FileText,
  markdown: FileText,
  txt: FileText,
  json: FileJson,
  yaml: FileCode,
  yml: FileCode,
  ts: FileCode,
  tsx: FileCode,
  js: FileCode,
  jsx: FileCode,
  py: FileCode,
  png: Image,
  jpg: Image,
  jpeg: Image,
  gif: Image,
  svg: Image,
  webp: Image,
};

// Human-readable file types
const FILE_TYPES: Record<string, string> = {
  md: "Markdown",
  markdown: "Markdown",
  txt: "Plain Text",
  json: "JSON",
  yaml: "YAML",
  yml: "YAML",
  ts: "TypeScript",
  tsx: "TypeScript React",
  js: "JavaScript",
  jsx: "JavaScript React",
  py: "Python",
  png: "PNG Image",
  jpg: "JPEG Image",
  jpeg: "JPEG Image",
  gif: "GIF Image",
  svg: "SVG Image",
  webp: "WebP Image",
  pdf: "PDF Document",
};

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface DocsFallbackViewProps {
  filePath: string;
  size: number;
  mimeType: string;
  isLargeFile?: boolean;
}

export function DocsFallbackView({ filePath, size, mimeType, isLargeFile }: DocsFallbackViewProps) {
  const [copied, setCopied] = useState(false);

  const fileName = path.basename(filePath);
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const IconComponent = FILE_ICONS[ext] || File;
  const fileType = FILE_TYPES[ext] || mimeType || "Unknown";

  const handleOpenInFinder = async () => {
    try {
      await fetch("/api/shell/reveal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath }),
      });
    } catch {
      // Fallback: copy path
      await navigator.clipboard.writeText(filePath);
    }
  };

  const handleCopyPath = async () => {
    try {
      await navigator.clipboard.writeText(filePath);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore
    }
  };

  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-8">
      <IconComponent className="w-16 h-16 text-[var(--text-tertiary)]" />

      <div className="text-center">
        <h2 className="text-lg font-medium text-[var(--text-primary)]">{fileName}</h2>
        <p className="text-sm text-[var(--text-tertiary)] mt-1">
          {fileType} — {formatFileSize(size)}
        </p>
        {isLargeFile && (
          <p className="text-xs text-amber-500 mt-2">
            This file is too large to preview
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleOpenInFinder}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors text-sm"
        >
          <FolderOpen className="w-4 h-4" />
          Open in Finder
        </button>

        <button
          onClick={handleCopyPath}
          className="flex items-center gap-2 px-4 py-2 rounded-md bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)] transition-colors text-sm"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4 text-emerald-500" />
              Copied!
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" />
              Copy Path
            </>
          )}
        </button>
      </div>
    </div>
  );
}
