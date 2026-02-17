"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback, useMemo, useState, Component, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTheme } from "@/hooks/useTheme";
import {
  MDXEditor,
  headingsPlugin,
  listsPlugin,
  quotePlugin,
  thematicBreakPlugin,
  markdownShortcutPlugin,
  linkPlugin,
  linkDialogPlugin,
  tablePlugin,
  codeBlockPlugin,
  codeMirrorPlugin,
  imagePlugin,
  toolbarPlugin,
  UndoRedo,
  BoldItalicUnderlineToggles,
  BlockTypeSelect,
  CreateLink,
  InsertTable,
  ListsToggle,
  CodeToggle,
  InsertCodeBlock,
  Separator,
  type MDXEditorMethods,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import { MermaidBlock } from "./MermaidBlock";
import type { FileNode } from "@/lib/types";
import { resolveWikilink, parseWikilinks, parseImageWikilinks } from "@/lib/docs/wikilink-resolver";
import * as path from "path";

/**
 * Sanitise markdown so MDXEditor's MDX parser doesn't choke on JSX-like
 * syntax.  Applied only in read-only mode.
 *
 * 1. Inside fenced code blocks — escape <, >, {, } as HTML entities.
 * 2. Outside code blocks — replace <br> with newlines, and escape remaining
 *    angle-bracket patterns that look like JSX/HTML tags (e.g. `<640px>`).
 */
/** Extract YAML frontmatter key-value pairs from markdown. Returns null if no frontmatter. */
function parseFrontmatter(markdown: string): Record<string, string> | null {
  const match = markdown.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const pairs: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const sep = line.indexOf(":");
    if (sep > 0) {
      const key = line.slice(0, sep).trim();
      const value = line.slice(sep + 1).trim();
      if (key) pairs[key] = value;
    }
  }
  return Object.keys(pairs).length > 0 ? pairs : null;
}

/** Strip YAML frontmatter (---\n...\n---) from the beginning of markdown. */
function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

/** Compact frontmatter display rendered above the editor content (read mode). */
function FrontmatterDisplay({ fields }: { fields: Record<string, string> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-6 py-2 text-[13px] font-mono border-b border-[var(--border-default)] flex-shrink-0">
      {Object.entries(fields).map(([key, value]) => (
        <span key={key} className="text-[var(--text-tertiary)]">
          <span className="font-medium">{key}:</span>{" "}
          <span className="text-[var(--text-secondary)]">{value}</span>
        </span>
      ))}
    </div>
  );
}

/** Editable frontmatter displayed below the toolbar in edit mode. */
function EditableFrontmatter({ fields, onChange }: { fields: Record<string, string>; onChange: (key: string, value: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 sm:px-6 py-2 text-[13px] font-mono border-b border-[var(--border-default)] flex-shrink-0">
      {Object.entries(fields).map(([key, value]) => (
        <label key={key} className="flex items-center gap-1 text-[var(--text-tertiary)]">
          <span className="font-medium">{key}:</span>
          <input
            type="text"
            defaultValue={value}
            onBlur={(e) => onChange(key, e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="bg-transparent text-[var(--text-secondary)] border-b border-transparent hover:border-[var(--border-default)] focus:border-[var(--text-tertiary)] focus:outline-none px-1 min-w-[4rem]"
          />
        </label>
      ))}
    </div>
  );
}

function sanitiseForMdx(markdown: string): string {
  // Split on fenced code blocks (captured groups are odd indices)
  const parts = markdown.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Mermaid blocks are rendered by a custom component — don't escape
        if (part.startsWith("```mermaid")) return part;
        // Other code blocks — escape angle brackets (MDX treats them as JSX)
        // Note: { } are safe inside fenced code blocks per MDX spec
        return part.replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }
      // Outside code blocks:
      // a) Replace <br> tags with newlines
      let text = part.replace(/<br\s*\/?>/gi, "\n");
      // b) Escape ALL remaining < that are not part of URL autolinks.
      //    MDXEditor's MDX parser treats any < as potential JSX, even
      //    unmatched ones like (<640px).
      text = text.replace(/<(?!https?:\/\/|mailto:)/g, "&lt;");
      return text;
    })
    .join("");
}

/** Error boundary — falls back to a plain <pre> rendering of the markdown. */
class EditorErrorBoundary extends Component<
  { children: ReactNode; fallbackContent: string; className?: string },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <pre className={`whitespace-pre-wrap text-sm p-6 overflow-auto ${this.props.className ?? ""}`}>
          {this.props.fallbackContent}
        </pre>
      );
    }
    return this.props.children;
  }
}

interface DocsEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  hideToolbar?: boolean;
  contentPadding?: string;
  wrapperClassName?: string;
  currentFilePath?: string;
  scopePath?: string;
  fileTree?: FileNode | null;
  onNavigateToFile?: (path: string) => void;
}

export interface DocsEditorRef {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
}

export const DocsEditor = forwardRef<DocsEditorRef, DocsEditorProps>(
  ({ markdown, onChange, readOnly = false, hideToolbar = false, contentPadding, wrapperClassName, currentFilePath, scopePath, fileTree, onNavigateToFile }, ref) => {
    const editorRef = useRef<MDXEditorMethods>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();

    // Extract frontmatter once from the raw markdown — displayed separately, stripped from editor
    const frontmatterFields = useMemo(() => parseFrontmatter(markdown), [markdown]);
    // Keep the raw frontmatter block so we can re-prepend it on save
    const rawFrontmatterRef = useRef<string | null>(null);
    useMemo(() => {
      const match = markdown.match(/^(---\n[\s\S]*?\n---\n?)/);
      rawFrontmatterRef.current = match ? match[1] : null;
    }, [markdown]);

    useImperativeHandle(ref, () => ({
      getMarkdown: () => {
        const body = editorRef.current?.getMarkdown() || "";
        return rawFrontmatterRef.current ? rawFrontmatterRef.current + body : body;
      },
      setMarkdown: (md: string) => {
        // Update frontmatter ref and pass only the body to the editor
        const match = md.match(/^(---\n[\s\S]*?\n---\n?)/);
        rawFrontmatterRef.current = match ? match[1] : null;
        editorRef.current?.setMarkdown(stripFrontmatter(md));
      },
    }));

    // Wrap onChange to re-prepend frontmatter before passing to parent
    const handleChange = useCallback((body: string) => {
      if (!onChange) return;
      onChange(rawFrontmatterRef.current ? rawFrontmatterRef.current + body : body);
    }, [onChange]);

    // Handle edits to individual frontmatter fields
    const handleFrontmatterFieldChange = useCallback((key: string, value: string) => {
      if (!rawFrontmatterRef.current) return;
      const lines = rawFrontmatterRef.current.split("\n");
      rawFrontmatterRef.current = lines.map(line => {
        const sep = line.indexOf(":");
        if (sep > 0 && line.slice(0, sep).trim() === key) {
          return `${key}: ${value}`;
        }
        return line;
      }).join("\n");

      if (onChange) {
        const body = editorRef.current?.getMarkdown() || "";
        onChange(rawFrontmatterRef.current + body);
      }
    }, [onChange]);

    // Portal target for rendering editable frontmatter below the toolbar in edit mode
    const portalTargetRef = useRef<HTMLDivElement | null>(null);
    const [portalReady, setPortalReady] = useState(false);

    useEffect(() => {
      if (readOnly || !containerRef.current) {
        if (portalTargetRef.current) {
          portalTargetRef.current.remove();
          portalTargetRef.current = null;
          setPortalReady(false);
        }
        return;
      }

      const raf = requestAnimationFrame(() => {
        const toolbar = containerRef.current?.querySelector(".mdxeditor-toolbar");
        if (toolbar && !portalTargetRef.current) {
          const target = document.createElement("div");
          toolbar.after(target);
          portalTargetRef.current = target;
          setPortalReady(true);
        }
      });

      return () => {
        cancelAnimationFrame(raf);
        if (portalTargetRef.current) {
          portalTargetRef.current.remove();
          portalTargetRef.current = null;
        }
        setPortalReady(false);
      };
    }, [readOnly]);

    // Async resolution for vault-relative wikilinks (paths like "libraries/everpro/..."
    // that can't be resolved client-side without filesystem access)
    const [asyncResolvedLinks, setAsyncResolvedLinks] = useState<Map<string, string>>(new Map());

    useEffect(() => {
      if (!markdown || !currentFilePath || !scopePath || !readOnly) {
        setAsyncResolvedLinks(new Map());
        return;
      }

      const body = stripFrontmatter(markdown);
      const wikilinks = parseWikilinks(body);
      const imageWikilinks = parseImageWikilinks(body);
      const allTargets = [
        ...wikilinks.map(l => l.target),
        ...imageWikilinks.map(l => l.target),
      ];

      // Find targets that the synchronous resolver can't resolve
      const needsResolve: string[] = [];
      for (const target of allTargets) {
        const resolved = resolveWikilink(target, currentFilePath, scopePath, fileTree || null);
        if (!resolved.exists && target.includes("/") && !target.startsWith("/")) {
          needsResolve.push(target);
        }
      }

      if (needsResolve.length === 0) {
        setAsyncResolvedLinks(new Map());
        return;
      }

      let cancelled = false;
      fetch("/api/docs/resolve-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targets: [...new Set(needsResolve)],
          currentFile: currentFilePath,
          scope: scopePath,
        }),
      })
        .then(res => res.json())
        .then(data => {
          if (cancelled) return;
          const map = new Map<string, string>();
          if (data.resolved) {
            for (const [target, resolvedPath] of Object.entries(data.resolved)) {
              if (resolvedPath) map.set(target, resolvedPath as string);
            }
          }
          setAsyncResolvedLinks(map);
        })
        .catch(() => {});

      return () => { cancelled = true; };
    }, [markdown, currentFilePath, scopePath, fileTree, readOnly]);

    // Process markdown to convert wikilinks to standard markdown links for display
    // Only process in read mode - in edit mode, show raw [[wikilink]] syntax
    // (processing in edit mode causes MDXEditor to save expanded URLs back to files)
    const processedMarkdown = useMemo(() => {
      // Strip frontmatter in both modes — it's rendered separately above the editor
      const body = stripFrontmatter(markdown);

      if (readOnly === false) {
        return body;
      }

      if (!currentFilePath || !scopePath) {
        return sanitiseForMdx(body);
      }

      let result = body;

      // Collect all replacements with their positions
      const replacements: { start: number; end: number; replacement: string }[] = [];

      // Process image wikilinks (![[path]])
      const imageWikilinks = parseImageWikilinks(body);
      for (const img of imageWikilinks) {
        // Use the same resolver as regular wikilinks to support Obsidian-style filename search
        const resolved = resolveWikilink(img.target, currentFilePath, scopePath, fileTree || null);
        // Check async resolution for vault-relative paths
        if (!resolved.exists && asyncResolvedLinks.has(img.target)) {
          resolved.absolutePath = asyncResolvedLinks.get(img.target)!;
          resolved.exists = true;
        }
        let imagePath: string;

        if (resolved.exists && resolved.absolutePath) {
          imagePath = resolved.absolutePath;
        } else {
          // Fallback: try media/ subfolder (Obsidian attachmentFolderPath: "./media"),
          // then relative to current file
          const currentDir = path.dirname(currentFilePath);
          if (img.target.startsWith("/")) {
            imagePath = path.join(scopePath, img.target);
          } else if (!img.target.includes("/")) {
            // Bare filename — check media/ subfolder first
            imagePath = path.resolve(currentDir, "media", img.target);
          } else {
            imagePath = path.resolve(currentDir, img.target);
          }
        }

        // Convert to API URL
        const imageUrl = `/api/docs/raw?path=${encodeURIComponent(imagePath)}&scope=${encodeURIComponent(scopePath)}`;
        const markdownImage = `![${img.altText}](${imageUrl})`;

        replacements.push({
          start: img.start,
          end: img.end,
          replacement: markdownImage,
        });
      }

      const wikilinks = parseWikilinks(body);
      for (const link of wikilinks) {
        const resolved = resolveWikilink(link.target, currentFilePath, scopePath, fileTree || null);
        // Check async resolution for vault-relative paths
        if (!resolved.exists && asyncResolvedLinks.has(link.target)) {
          resolved.absolutePath = asyncResolvedLinks.get(link.target)!;
          resolved.exists = true;
        }

        // Convert to markdown link format
        // Use hash links to prevent browser navigation, with data encoded in the hash
        const linkPath = resolved.exists && resolved.absolutePath
          ? `#wikilink:${encodeURIComponent(resolved.absolutePath)}`
          : `#wikilink-broken:${encodeURIComponent(link.target)}`;

        const markdownLink = `[${link.display}](${linkPath})`;

        replacements.push({
          start: link.start,
          end: link.end,
          replacement: markdownLink,
        });
      }

      // Sort by start position descending and apply replacements
      replacements.sort((a, b) => b.start - a.start);
      for (const r of replacements) {
        result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
      }

      // Rewrite standard markdown images with relative paths to use /api/docs/raw
      const currentDir = path.dirname(currentFilePath);
      result = result.replace(
        /!\[([^\]]*)\]\(([^)]+)\)/g,
        (match, alt, src) => {
          // Skip absolute URLs, data URIs, and already-rewritten API paths
          if (/^(https?:\/\/|data:|\/api\/)/.test(src)) return match;
          const absPath = src.startsWith("/")
            ? path.join(scopePath, src)
            : path.resolve(currentDir, src);
          const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(scopePath)}`;
          return `![${alt}](${url})`;
        }
      );

      return sanitiseForMdx(result);
    }, [markdown, currentFilePath, scopePath, fileTree, readOnly, asyncResolvedLinks]);

    // Update editor when processed markdown changes
    useEffect(() => {
      if (editorRef.current) {
        const currentContent = editorRef.current.getMarkdown();
        if (currentContent !== processedMarkdown) {
          editorRef.current.setMarkdown(processedMarkdown);
        }
      }
    }, [processedMarkdown]);

    // Fix MDXEditor scroll
    useEffect(() => {
      const container = document.querySelector('.docs-editor-wrapper .mdxeditor-root-contenteditable');
      if (container instanceof HTMLElement) {
        container.style.setProperty('overflow', 'auto', 'important');
        container.style.setProperty('overflow-y', 'auto', 'important');
      }
    }, []);

    // Convert <img> tags with video extensions to <video> elements after render
    const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|ogg)(\?|$)/i;
    useEffect(() => {
      if (!readOnly) return;
      const el = containerRef.current;
      if (!el) return;

      const observer = new MutationObserver(() => {
        const imgs = el.querySelectorAll('img');
        imgs.forEach((img) => {
          const src = img.getAttribute('src') || '';
          if (VIDEO_EXTENSIONS.test(src)) {
            const video = document.createElement('video');
            video.src = src;
            video.controls = true;
            video.style.maxWidth = '100%';
            video.style.borderRadius = '8px';
            img.replaceWith(video);
          }
        });
      });

      observer.observe(el, { childList: true, subtree: true });

      // Also run once immediately for already-rendered content
      const imgs = el.querySelectorAll('img');
      imgs.forEach((img) => {
        const src = img.getAttribute('src') || '';
        if (VIDEO_EXTENSIONS.test(src)) {
          const video = document.createElement('video');
          video.src = src;
          video.controls = true;
          video.style.maxWidth = '100%';
          video.style.borderRadius = '8px';
          img.replaceWith(video);
        }
      });

      return () => observer.disconnect();
    }, [readOnly, processedMarkdown]);

    // Handle wikilink clicks (intercept our custom hash links)
    const handleWikilinkClick = useCallback((e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if clicked on a link with #wikilink: hash
      const link = target.closest('a');
      if (link) {
        const href = link.getAttribute('href');
        if (href?.startsWith('#wikilink:')) {
          e.preventDefault();
          e.stopPropagation();
          const filePath = decodeURIComponent(href.replace('#wikilink:', ''));
          if (onNavigateToFile) {
            onNavigateToFile(filePath);
          }
        } else if (href?.startsWith('#wikilink-broken:')) {
          e.preventDefault();
          e.stopPropagation();
          // Could show a toast or tooltip for broken links
        }
      }
    }, [onNavigateToFile]);

    useEffect(() => {
      const container = containerRef.current;
      if (container) {
        // Use mousedown with capture to intercept before browser navigation
        container.addEventListener('mousedown', handleWikilinkClick, true);
        container.addEventListener('click', handleWikilinkClick, true);
        return () => {
          container.removeEventListener('mousedown', handleWikilinkClick, true);
          container.removeEventListener('click', handleWikilinkClick, true);
        };
      }
    }, [handleWikilinkClick]);

    // Resolve relative image paths to /api/docs/raw URLs for preview
    const imagePreviewHandler = useCallback(async (src: string) => {
      if (/^(https?:\/\/|data:|\/api\/)/.test(src)) return src;
      if (!currentFilePath || !scopePath) return src;
      const dir = path.dirname(currentFilePath);
      const absPath = src.startsWith("/")
        ? path.join(scopePath, src)
        : path.resolve(dir, src);
      return `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(scopePath)}`;
    }, [currentFilePath, scopePath]);

    const plugins = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      imagePlugin({ imagePreviewHandler }),
      codeBlockPlugin({
        defaultCodeBlockLanguage: "typescript",
        codeBlockEditorDescriptors: [
          {
            priority: 100,
            match: (language) => language === "mermaid",
            Editor: ({ code }) => <MermaidBlock code={code} />,
          },
        ],
      }),
      codeMirrorPlugin({
        codeBlockLanguages: {
          js: "JavaScript",
          javascript: "JavaScript",
          ts: "TypeScript",
          typescript: "TypeScript",
          tsx: "TypeScript (React)",
          jsx: "JavaScript (React)",
          css: "CSS",
          html: "HTML",
          json: "JSON",
          bash: "Bash",
          sh: "Shell",
          shell: "Shell",
          python: "Python",
          py: "Python",
          sql: "SQL",
          yaml: "YAML",
          yml: "YAML",
          md: "Markdown",
          markdown: "Markdown",
          mermaid: "Mermaid",
          "": "Plain Text",
          text: "Plain Text",
        },
      }),
    ];

    // Add toolbar for editing mode (unless explicitly hidden)
    if (!readOnly && !hideToolbar) {
      plugins.push(
        toolbarPlugin({
          toolbarContents: () => (
            <>
              <UndoRedo />
              <Separator />
              <BoldItalicUnderlineToggles />
              <CodeToggle />
              <Separator />
              <BlockTypeSelect />
              <Separator />
              <ListsToggle />
              <Separator />
              <CreateLink />
              <InsertTable />
              <InsertCodeBlock />
            </>
          ),
        })
      );
    }

    const themeClass = resolvedTheme === "dark" ? "dark-theme dark-editor" : "light-theme light-editor";
    const proseInvert = resolvedTheme === "dark" ? "prose-invert" : "";

    // Inject copy buttons into code blocks in read mode.
    // Uses MutationObserver because CodeMirror editors mount asynchronously.
    useEffect(() => {
      if (!readOnly || !containerRef.current) return;

      const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
      const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

      const addCopyButton = (wrapper: Element) => {
        if (wrapper.querySelector('.docs-code-copy-btn')) return;
        const btn = document.createElement('button');
        btn.className = 'docs-code-copy-btn';
        btn.title = 'Copy code';
        btn.type = 'button';
        btn.innerHTML = copyIcon;
        btn.addEventListener('click', () => {
          const lines = wrapper.querySelectorAll('.cm-line');
          const text = Array.from(lines).map(l => l.textContent || '').join('\n');
          navigator.clipboard.writeText(text).then(() => {
            btn.innerHTML = checkIcon;
            setTimeout(() => { btn.innerHTML = copyIcon; }, 1500);
          });
        });
        wrapper.classList.add('docs-code-block-wrapper');
        wrapper.appendChild(btn);
      };

      // Handle already-rendered code blocks
      const container = containerRef.current;
      container.querySelectorAll('[class*="_codeMirrorWrapper"]').forEach(addCopyButton);

      // Watch for new code blocks mounting asynchronously
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          for (const node of mutation.addedNodes) {
            if (!(node instanceof HTMLElement)) continue;
            if (node.className?.includes?.('_codeMirrorWrapper')) {
              addCopyButton(node);
            }
            node.querySelectorAll?.('[class*="_codeMirrorWrapper"]').forEach(addCopyButton);
          }
        }
      });
      observer.observe(container, { childList: true, subtree: true });

      return () => {
        observer.disconnect();
        container.querySelectorAll('.docs-code-copy-btn').forEach(btn => btn.remove());
      };
    }, [readOnly, markdown]);

    return (
      <div ref={containerRef} className={`flex flex-col ${wrapperClassName ? wrapperClassName : "h-full docs-editor-wrapper"} ${readOnly ? "docs-read-mode" : ""}`}>
        {readOnly && frontmatterFields && <FrontmatterDisplay fields={frontmatterFields} />}
        {!readOnly && portalReady && frontmatterFields && portalTargetRef.current &&
          createPortal(
            <EditableFrontmatter key={currentFilePath} fields={frontmatterFields} onChange={handleFrontmatterFieldChange} />,
            portalTargetRef.current
          )}
        <EditorErrorBoundary fallbackContent={markdown} className="flex-1">
          <MDXEditor
            key={readOnly ? "read" : "edit"}
            ref={editorRef}
            markdown={processedMarkdown}
            onChange={handleChange}
            readOnly={readOnly}
            plugins={plugins}
            contentEditableClassName={`prose ${proseInvert} max-w-none leading-normal font-[family-name:var(--font-geist-sans)]
              prose-headings:font-semibold
              prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none
              prose-pre:rounded-lg prose-pre:bg-[var(--bg-tertiary)]
              prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
              prose-table:border-collapse prose-table:bg-[var(--bg-primary)]
              prose-thead:bg-[var(--bg-secondary)]
              prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2
              prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2 prose-td:bg-[var(--bg-primary)]
              outline-none ${contentPadding ?? "px-12 py-6"}`}
            className={`${themeClass} h-full flex-1`}
          />
        </EditorErrorBoundary>
      </div>
    );
  }
);

DocsEditor.displayName = "DocsEditor";
