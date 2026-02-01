"use client";

import { useEffect, useRef } from "react";
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
import { FileHandler } from "@tiptap/extension-file-handler";
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

  // 3. Convert relative regular link paths: [text](relative/path) for local files
  result = result.replace(
    /(?<!!)\[([^\]]*?)\]\(([^)]+)\)/g,
    (match, text: string, href: string) => {
      const trimmedHref = href.trim();
      if (trimmedHref.startsWith("http://") || trimmedHref.startsWith("https://") || trimmedHref.startsWith("/api/") || trimmedHref.startsWith("#")) {
        return match;
      }
      // Only convert paths that look like local file references (have an extension)
      if (!/\.\w+$/.test(trimmedHref)) return match;
      const absPath = resolvePath(fileDir, trimmedHref);
      const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(vaultPath)}`;
      return `[${text}](${url})`;
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

  // Convert image embeds: ![alt](/api/docs/raw?...) → ![alt](relative/path)
  let result = md.replace(
    /!\\?\[([^\]]*?)\\?\]\(\/api\/docs\/raw\?path=([^&]+)&scope=[^)]+\)/g,
    (_match, alt: string, encodedPath: string) => {
      const absPath = decodeURIComponent(encodedPath);
      const relPath = relativePath(fileDir, absPath);
      return `![${alt}](${relPath})`;
    }
  );

  // Convert regular links: [text](/api/docs/raw?...) → [text](relative/path)
  result = result.replace(
    /(?<!!)\[([^\]]*?)\]\(\/api\/docs\/raw\?path=([^&]+)&scope=[^)]+\)/g,
    (_match, text: string, encodedPath: string) => {
      const absPath = decodeURIComponent(encodedPath);
      const relPath = relativePath(fileDir, absPath);
      return `[${text}](${relPath})`;
    }
  );

  return result;
}

/** Clean serialized markdown: unescape wikilinks, convert API URLs, trim */
function cleanOutput(raw: string, vaultPath?: string, filePath?: string): string {
  let md = unescapeWikilinks(raw);
  md = postprocessMarkdown(md, vaultPath, filePath);
  return md.trimEnd();
}

/**
 * Normalize markdown for comparison only: collapse blank-line runs
 * and trim. Prevents tiptap-markdown's paragraph spacing from being
 * treated as a meaningful change.
 */
function normalizeMd(md: string): string {
  return md
    .replace(/\n{2,}/g, "\n")
    .trim();
}

const VIDEO_SRC_RE = /\.(mp4|webm|mov|ogg)([?&]|$)/i;
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|svg)$/i;
const VIDEO_EMBED_EXTENSIONS = /\.(mp4|webm|mov|ogg)$/i;

/** Image extension with atom selection and auto video rendering via NodeView */
const MediaImage = Image.extend({
  atom: true,
  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const src = HTMLAttributes.src || node.attrs.src || "";
      let dom: HTMLElement;
      if (VIDEO_SRC_RE.test(src)) {
        const video = document.createElement("video");
        video.src = src;
        video.controls = true;
        video.style.maxWidth = "100%";
        video.style.borderRadius = "8px";
        video.style.margin = "0.5em 0";
        video.draggable = true;
        dom = video;
      } else {
        const img = document.createElement("img");
        img.src = src;
        if (HTMLAttributes.alt) img.alt = HTMLAttributes.alt;
        if (HTMLAttributes.title) img.title = HTMLAttributes.title;
        dom = img;
      }
      return {
        dom,
        selectNode: () => dom.classList.add("ProseMirror-selectednode"),
        deselectNode: () => dom.classList.remove("ProseMirror-selectednode"),
      };
    };
  },
});

function isEmbeddable(file: File): "image" | "video" | false {
  if (file.type.startsWith("image/") || IMAGE_EXTENSIONS.test(file.name)) return "image";
  if (file.type.startsWith("video/") || VIDEO_EMBED_EXTENSIONS.test(file.name)) return "video";
  return false;
}

async function uploadFile(
  file: File,
  vaultPath: string,
  filePath: string
): Promise<{ url: string; relPath: string } | null> {
  const fileDir = dirname(filePath);
  const form = new FormData();
  form.append("file", file);
  form.append("scope", vaultPath);
  form.append("fileDir", fileDir);

  const res = await fetch("/api/bridge/upload", { method: "POST", body: form });
  if (!res.ok) return null;
  const { relativePath: relPath } = await res.json();

  const absPath = resolvePath(fileDir, relPath);
  const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(vaultPath)}`;
  return { url, relPath };
}

/** Insert an uploaded file into the editor at the given position. */
function insertFile(
  editor: ReturnType<typeof useEditor>,
  file: File,
  result: { url: string; relPath: string },
  pos?: number,
) {
  if (!editor) return;
  const embedType = isEmbeddable(file);
  const chain = editor.chain().focus();

  if (embedType) {
    // Images and videos both use the image node (videos get swapped in read-only mode)
    const node = { type: "image" as const, attrs: { src: result.url, alt: file.name } };
    if (pos != null) {
      chain.insertContentAt(pos, node).run();
    } else {
      chain.insertContent(node).run();
    }
  } else {
    // Non-embeddable files: insert as a linked filename
    const content = {
      type: "paragraph" as const,
      content: [{
        type: "text" as const,
        marks: [{ type: "link" as const, attrs: { href: result.url } }],
        text: file.name,
      }],
    };
    if (pos != null) {
      chain.insertContentAt(pos, content).run();
    } else {
      chain.insertContent(content).run();
    }
  }
}

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
  const focusedRef = useRef(false);

  // Keep refs for values used in onUpdate closure (avoids stale closures)
  const vaultPathRef = useRef(vaultPath);
  const filePathRef = useRef(filePath);
  vaultPathRef.current = vaultPath;
  filePathRef.current = filePath;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false }),
      MediaImage.configure({ inline: false, allowBase64: false }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      Placeholder.configure({ placeholder: "Add details..." }),
      Typography,
      FileHandler.configure({
        onDrop: (editor, files, pos) => {
          for (const file of files) {
            const vault = vaultPathRef.current;
            const fp = filePathRef.current;
            if (!vault || !fp) continue;
            uploadFile(file, vault, fp).then((result) => {
              if (!result) return;
              insertFile(editor, file, result, pos);
            });
          }
        },
        onPaste: (editor, files, htmlContent) => {
          if (htmlContent) return;
          for (const file of files) {
            const vault = vaultPathRef.current;
            const fp = filePathRef.current;
            if (!vault || !fp) continue;
            uploadFile(file, vault, fp).then((result) => {
              if (!result) return;
              insertFile(editor, file, result);
            });
          }
        },
      }),
      Markdown,
    ],
    content: "",
    editable: !readOnly,
    immediatelyRender: false,
    onFocus: () => { focusedRef.current = true; },
    onBlur: () => { focusedRef.current = false; },
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
    // Don't overwrite the editor while the user is actively editing
    if (!needsInit && focusedRef.current) return;
    contentInitialized.current = true;
    if (vaultPath) lastProcessedWithPaths.current = true;
    lastEmittedNorm.current = norm;
    // setContent fires onUpdate — flag it so we skip
    programmatic.current++;
    editor.commands.setContent(processed);
  }, [editor, markdown, vaultPath, filePath]);

  // Fallback drop handler: ProseMirror's plugin handleDrop only fires for
  // drops between blocks. Drops that land on text get swallowed by
  // ProseMirror's internal drag-move logic. This DOM handler catches those
  // using the capture phase so it runs before ProseMirror, but only acts
  // on file drops (not text/node drags).
  useEffect(() => {
    if (readOnly) return;
    const el = containerRef.current;
    if (!el || !editor) return;

    function handleDrop(e: DragEvent) {
      // Only intercept external file drops, not ProseMirror node drags
      if (!e.dataTransfer?.types.includes("Files")) return;
      const files = e.dataTransfer.files;
      if (!files.length) return;

      e.preventDefault();
      e.stopPropagation();

      const vault = vaultPathRef.current;
      const fp = filePathRef.current;
      if (!vault || !fp) return;

      const pos = editor!.view.posAtCoords({
        left: e.clientX,
        top: e.clientY,
      })?.pos ?? editor!.state.selection.head;

      for (const file of Array.from(files)) {
        uploadFile(file, vault, fp).then((result) => {
          if (!result) return;
          insertFile(editor!, file, result, pos);
        });
      }
    }

    // Capture phase so we intercept before ProseMirror's view handler
    el.addEventListener("drop", handleDrop, true);
    return () => {
      el.removeEventListener("drop", handleDrop, true);
    };
  }, [editor, readOnly]);

  return (
    <div ref={containerRef} className={`bridge-task-editor ${className ?? ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
