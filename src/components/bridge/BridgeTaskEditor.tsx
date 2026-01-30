"use client";

import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Placeholder from "@tiptap/extension-placeholder";
import Typography from "@tiptap/extension-typography";
import { Markdown } from "tiptap-markdown";

// Client-safe path utilities (no Node.js path module)
function dirname(p: string): string {
  const i = p.lastIndexOf("/");
  return i <= 0 ? "/" : p.slice(0, i);
}

function resolvePath(base: string, rel: string): string {
  if (rel.startsWith("/")) return rel;
  const parts = base.split("/").filter(Boolean);
  for (const seg of rel.split("/")) {
    if (seg === "..") parts.pop();
    else if (seg !== ".") parts.push(seg);
  }
  return "/" + parts.join("/");
}

function relativePath(from: string, to: string): string {
  const fromParts = from.split("/").filter(Boolean);
  const toParts = to.split("/").filter(Boolean);
  let i = 0;
  while (i < fromParts.length && i < toParts.length && fromParts[i] === toParts[i]) i++;
  const ups = fromParts.length - i;
  const rest = toParts.slice(i);
  if (ups === 0) return rest.join("/") || ".";
  return [...Array(ups).fill(".."), ...rest].join("/");
}

/** Undo tiptap-markdown's bracket escaping for wikilinks: !\[\[x\]\] → ![[x]] */
function unescapeWikilinks(md: string): string {
  return md.replace(/!\\\[\\?\[([^\]]+)\\?\]\\\]/g, "![[$1]]");
}

/**
 * Convert wikilink image embeds and relative image paths to API URLs for display.
 * - `![[file.ext]]` → `![file.ext](/api/docs/raw?path=...&scope=...)`
 * - `![alt](relative/path)` → `![alt](/api/docs/raw?path=...&scope=...)`
 * - Absolute URLs (https://) are left untouched.
 */
function preprocessMarkdown(
  md: string,
  vaultPath?: string,
  filePath?: string
): string {
  if (!vaultPath || !filePath) return md;

  const fileDir = dirname(filePath);

  // 1. Convert wikilink image embeds: ![[file.ext]] or !\[\[file.ext\]\]
  let result = md.replace(
    /!\\?\[\\?\[([^\]|]+)(?:\|([^\]]+))?\\?\]\]/g,
    (_match, target: string, alt?: string) => {
      const trimmed = target.trim();
      const altText = alt?.trim() || trimmed;
      const absPath = trimmed.includes("/")
        ? resolvePath(fileDir, trimmed)
        : resolvePath(fileDir, "media/" + trimmed);
      const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(vaultPath)}`;
      return `![${altText}](${url})`;
    }
  );

  // 2. Convert relative image paths: ![alt](relative/path) but NOT absolute URLs
  // Also handles escaped brackets from tiptap-markdown: !\[alt\](url)
  result = result.replace(
    /!\\?\[([^\]]*?)\\?\]\(([^)]+)\)/g,
    (match, alt: string, src: string) => {
      const trimmedSrc = src.trim();
      // Skip absolute URLs and already-converted API URLs
      if (trimmedSrc.startsWith("http://") || trimmedSrc.startsWith("https://") || trimmedSrc.startsWith("/api/")) {
        return match;
      }
      const absPath = resolvePath(fileDir, trimmedSrc);
      const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(vaultPath)}`;
      return `![${alt}](${url})`;
    }
  );

  return result;
}

/**
 * Convert API URLs back to relative paths for saving as standard markdown.
 * `/api/docs/raw?path=<abs>&scope=<vault>` → `relative/path`
 */
function postprocessMarkdown(
  md: string,
  vaultPath?: string,
  filePath?: string
): string {
  if (!vaultPath || !filePath) return md;

  const fileDir = dirname(filePath);

  return md.replace(
    /!\\?\[([^\]]*?)\\?\]\(\/api\/docs\/raw\?path=([^&]+)&scope=[^)]+\)/g,
    (_match, alt: string, encodedPath: string) => {
      const absPath = decodeURIComponent(encodedPath);
      const relPath = relativePath(fileDir, absPath);
      return `![${alt}](${relPath})`;
    }
  );
}

/** Clean serialized markdown: unescape wikilinks, convert API URLs, strip empty trailing list items, trim */
function cleanOutput(raw: string, vaultPath?: string, filePath?: string): string {
  let md = unescapeWikilinks(raw);
  md = postprocessMarkdown(md, vaultPath, filePath);
  // Remove empty trailing list items (e.g. "- \n" or "* \n" at end)
  md = md.replace(/\n[-*]\s*$/g, "");
  return md.trimEnd();
}

/**
 * Normalize markdown for comparison only: collapse blank-line runs,
 * strip empty list items, trim. Prevents tiptap-markdown's paragraph
 * spacing from being treated as a meaningful change.
 */
function normalizeMd(md: string): string {
  return md
    .replace(/\n[-*]\s*$/g, "")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|ogg)([?&]|$)/i;

interface BridgeTaskEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  className?: string;
  vaultPath?: string;
  filePath?: string;
}

export function BridgeTaskEditor({
  markdown,
  onChange,
  readOnly = false,
  className,
  vaultPath,
  filePath,
}: BridgeTaskEditorProps) {
  const lastEmittedNorm = useRef(normalizeMd(markdown));
  // Start at 1 to skip the onUpdate fired by useEditor's initial empty content
  const programmatic = useRef(1);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);

  // Keep refs for values used in onUpdate closure (avoids stale closures)
  const vaultPathRef = useRef(vaultPath);
  const filePathRef = useRef(filePath);
  vaultPathRef.current = vaultPath;
  filePathRef.current = filePath;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false }),
      Image.configure({ inline: true, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Add details..." }),
      Typography,
      Markdown,
    ],
    content: "",
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // Skip updates caused by programmatic setContent
      if (programmatic.current > 0) {
        programmatic.current--;
        return;
      }
      const md = cleanOutput(
        (editor.storage as Record<string, any>).markdown.getMarkdown(),
        vaultPathRef.current,
        filePathRef.current
      );
      const norm = normalizeMd(md);
      if (norm === lastEmittedNorm.current) return;
      lastEmittedNorm.current = norm;
      onChange?.(md);
    },
    onFocus: () => setIsFocused(true),
    onBlur: () => setIsFocused(false),
  });

  // Sync readOnly without re-mounting
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // Sync external markdown changes or path props (without triggering onChange)
  const lastProcessedWithPaths = useRef(false);
  const contentInitialized = useRef(false);
  useEffect(() => {
    if (!editor) return;
    const processed = preprocessMarkdown(markdown, vaultPath, filePath);
    const norm = normalizeMd(markdown);
    const pathsJustArrived = vaultPath && !lastProcessedWithPaths.current;
    const needsInit = !contentInitialized.current;
    if (!needsInit && norm === lastEmittedNorm.current && !pathsJustArrived) return;
    contentInitialized.current = true;
    if (vaultPath) lastProcessedWithPaths.current = true;
    lastEmittedNorm.current = norm;
    // setContent fires onUpdate — flag it so we skip
    programmatic.current++;
    editor.commands.setContent(processed);
  }, [editor, markdown, vaultPath, filePath]);

  // Convert <img> tags with video extensions to <video> elements.
  // Only in read-only mode — mutating ProseMirror's DOM while editable
  // causes it to interpret the replacement as content deletion.
  useEffect(() => {
    if (!readOnly) return;
    const el = containerRef.current;
    if (!el) return;

    function replaceVideoImgs(container: HTMLElement) {
      container.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (VIDEO_EXTENSIONS.test(src)) {
          const video = document.createElement("video");
          video.src = src;
          video.controls = true;
          video.style.maxWidth = "100%";
          video.style.borderRadius = "8px";
          img.replaceWith(video);
        }
      });
    }

    const observer = new MutationObserver(() => replaceVideoImgs(el));
    observer.observe(el, { childList: true, subtree: true });
    replaceVideoImgs(el);

    return () => observer.disconnect();
  }, [markdown, readOnly]);

  return (
    <div ref={containerRef} className={`bridge-task-editor ${className ?? ""}`}>
      {editor && !readOnly && isFocused && (
        <div className="bridge-editor-toolbar">
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
            }}
          >
            Table
          </button>
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              editor.chain().focus().toggleTaskList().run();
            }}
          >
            Checklist
          </button>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
