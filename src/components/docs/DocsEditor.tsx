"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback, useMemo, Component, type ReactNode } from "react";
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
  frontmatterPlugin,
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
function sanitiseForMdx(markdown: string): string {
  // Split on fenced code blocks (captured groups are odd indices)
  const parts = markdown.split(/(```[\s\S]*?```)/g);

  return parts
    .map((part, i) => {
      if (i % 2 === 1) {
        // Code block — escape all JSX-like chars
        return part.replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/{/g, "&#123;").replace(/}/g, "&#125;");
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

    useImperativeHandle(ref, () => ({
      getMarkdown: () => editorRef.current?.getMarkdown() || "",
      setMarkdown: (md: string) => editorRef.current?.setMarkdown(md),
    }));

    // Process markdown to convert wikilinks to standard markdown links for display
    // Only process in read mode - in edit mode, show raw [[wikilink]] syntax
    // (processing in edit mode causes MDXEditor to save expanded URLs back to files)
    const processedMarkdown = useMemo(() => {
      if (readOnly === false) {
        return markdown;
      }

      if (!currentFilePath || !scopePath) {
        return sanitiseForMdx(markdown);
      }

      let result = markdown;

      // Collect all replacements with their positions
      const replacements: { start: number; end: number; replacement: string }[] = [];

      // Process image wikilinks (![[path]])
      const imageWikilinks = parseImageWikilinks(markdown);
      for (const img of imageWikilinks) {
        // Use the same resolver as regular wikilinks to support Obsidian-style filename search
        const resolved = resolveWikilink(img.target, currentFilePath, scopePath, fileTree || null);
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

      const wikilinks = parseWikilinks(markdown);
      for (const link of wikilinks) {
        const resolved = resolveWikilink(link.target, currentFilePath, scopePath, fileTree || null);

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

      return sanitiseForMdx(result);
    }, [markdown, currentFilePath, scopePath, fileTree, readOnly]);

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

    const plugins = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
      imagePlugin(),
      codeBlockPlugin({ defaultCodeBlockLanguage: "typescript" }),
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
          "": "Plain Text",
          text: "Plain Text",
        },
      }),
      frontmatterPlugin(),
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

    return (
      <div ref={containerRef} className={`flex flex-col ${wrapperClassName ? wrapperClassName : "h-full docs-editor-wrapper"}`}>
        <EditorErrorBoundary fallbackContent={markdown} className="flex-1">
          <MDXEditor
            key={readOnly ? "read" : "edit"}
            ref={editorRef}
            markdown={processedMarkdown}
            onChange={onChange}
            readOnly={readOnly}
            plugins={plugins}
            contentEditableClassName={`prose ${proseInvert} max-w-none leading-normal font-[family-name:var(--font-geist-sans)]
              prose-headings:font-semibold
              prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none
              prose-pre:rounded-lg prose-pre:bg-[var(--bg-tertiary)]
              prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
              prose-table:border-collapse
              prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2
              prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2
              outline-none ${contentPadding ?? "px-12 py-6"}`}
            className={`${themeClass} h-full flex-1`}
          />
        </EditorErrorBoundary>
      </div>
    );
  }
);

DocsEditor.displayName = "DocsEditor";
