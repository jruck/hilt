"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
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

interface PlanEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
}

export interface PlanEditorRef {
  getMarkdown: () => string;
  setMarkdown: (markdown: string) => void;
}

export const PlanEditor = forwardRef<PlanEditorRef, PlanEditorProps>(
  ({ markdown, onChange, readOnly = false }, ref) => {
    const editorRef = useRef<MDXEditorMethods>(null);

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

    // Fix MDXEditor scroll - override their !important CSS with inline !important
    useEffect(() => {
      const container = document.querySelector('.plan-editor-wrapper .mdxeditor-root-contenteditable');
      if (container instanceof HTMLElement) {
        container.style.setProperty('overflow', 'auto', 'important');
        container.style.setProperty('overflow-y', 'auto', 'important');
      }
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

    return (
      <div className="h-full flex flex-col plan-editor-wrapper">
        <MDXEditor
          ref={editorRef}
          markdown={markdown}
          onChange={onChange}
          readOnly={readOnly}
          plugins={plugins}
          contentEditableClassName="prose prose-sm prose-invert max-w-none
            prose-headings:text-zinc-100 prose-headings:font-semibold
            prose-h1:text-lg prose-h1:mt-4 prose-h1:mb-2
            prose-h2:text-base prose-h2:mt-3 prose-h2:mb-1.5
            prose-h3:text-sm prose-h3:mt-2 prose-h3:mb-1
            prose-p:text-zinc-300 prose-p:text-sm prose-p:leading-relaxed prose-p:my-1
            prose-li:text-zinc-300 prose-li:text-sm prose-li:my-0.5
            prose-strong:text-zinc-100 prose-strong:font-semibold
            prose-code:text-amber-400 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs
            prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-700 prose-pre:rounded-lg prose-pre:p-3 prose-pre:my-2
            prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
            prose-ul:my-1 prose-ol:my-1
            prose-table:border-collapse prose-th:border prose-th:border-zinc-700 prose-th:p-2 prose-th:bg-zinc-800
            prose-td:border prose-td:border-zinc-700 prose-td:p-2
            outline-none p-4"
          className="dark-theme dark-editor h-full flex-1"
        />
      </div>
    );
  }
);

PlanEditor.displayName = "PlanEditor";
