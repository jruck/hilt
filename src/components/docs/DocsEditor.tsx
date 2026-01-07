"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useCallback } from "react";
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
import { resolveWikilink } from "@/lib/docs/wikilink-resolver";

interface DocsEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
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
  ({ markdown, onChange, readOnly = false, currentFilePath, scopePath, fileTree, onNavigateToFile }, ref) => {
    const editorRef = useRef<MDXEditorMethods>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const { resolvedTheme } = useTheme();

    useImperativeHandle(ref, () => ({
      getMarkdown: () => editorRef.current?.getMarkdown() || "",
      setMarkdown: (md: string) => editorRef.current?.setMarkdown(md),
    }));

    // Update editor when markdown prop changes
    useEffect(() => {
      if (editorRef.current) {
        const currentContent = editorRef.current.getMarkdown();
        if (currentContent !== markdown) {
          editorRef.current.setMarkdown(markdown);
        }
      }
    }, [markdown]);

    // Fix MDXEditor scroll
    useEffect(() => {
      const container = document.querySelector('.docs-editor-wrapper .mdxeditor-root-contenteditable');
      if (container instanceof HTMLElement) {
        container.style.setProperty('overflow', 'auto', 'important');
        container.style.setProperty('overflow-y', 'auto', 'important');
      }
    }, []);

    // Handle wikilink clicks
    const handleClick = useCallback((e: MouseEvent) => {
      const target = e.target as HTMLElement;

      // Check if clicked on a wikilink
      if (target.classList.contains('wikilink') || target.closest('.wikilink')) {
        e.preventDefault();
        e.stopPropagation();

        const linkEl = target.classList.contains('wikilink') ? target : target.closest('.wikilink');
        const linkTarget = linkEl?.getAttribute('data-target');

        if (linkTarget && currentFilePath && scopePath && onNavigateToFile) {
          const resolved = resolveWikilink(linkTarget, currentFilePath, scopePath, fileTree || null);
          if (resolved.exists && resolved.absolutePath) {
            onNavigateToFile(resolved.absolutePath);
          }
        }
      }
    }, [currentFilePath, scopePath, fileTree, onNavigateToFile]);

    useEffect(() => {
      const container = containerRef.current;
      if (container) {
        container.addEventListener('click', handleClick);
        return () => container.removeEventListener('click', handleClick);
      }
    }, [handleClick]);

    // Process markdown to convert wikilinks to styled spans for display
    // This is a simple approach - for better integration we'd create a proper MDXEditor plugin
    const processedMarkdown = useCallback((md: string) => {
      // For now, just return as-is - the wikilinks will show as [[text]]
      // A full MDXEditor plugin would be needed for proper rendering
      return md;
    }, []);

    const plugins = [
      headingsPlugin(),
      listsPlugin(),
      quotePlugin(),
      thematicBreakPlugin(),
      markdownShortcutPlugin(),
      linkPlugin(),
      linkDialogPlugin(),
      tablePlugin(),
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

    // Add toolbar for editing mode
    if (!readOnly) {
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
      <div ref={containerRef} className="h-full flex flex-col docs-editor-wrapper">
        <MDXEditor
          ref={editorRef}
          markdown={processedMarkdown(markdown)}
          onChange={onChange}
          readOnly={readOnly}
          plugins={plugins}
          contentEditableClassName={`prose prose-sm ${proseInvert} max-w-none
            prose-headings:font-semibold
            prose-h1:text-lg prose-h1:mt-4 prose-h1:mb-2
            prose-h2:text-base prose-h2:mt-3 prose-h2:mb-1.5
            prose-h3:text-sm prose-h3:mt-2 prose-h3:mb-1
            prose-p:text-sm prose-p:leading-relaxed prose-p:my-1
            prose-li:text-sm prose-li:my-0.5
            prose-strong:font-semibold
            prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
            prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-2
            prose-a:no-underline hover:prose-a:underline
            prose-ul:my-1 prose-ol:my-1
            prose-table:border-collapse
            outline-none p-4`}
          className={`${themeClass} h-full flex-1`}
        />
      </div>
    );
  }
);

DocsEditor.displayName = "DocsEditor";
