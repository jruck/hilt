"use client";

import { useEffect, useRef } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Markdown } from "tiptap-markdown";

/** Undo tiptap-markdown's bracket escaping for wikilinks: !\[\[x\]\] → ![[x]] */
function unescapeWikilinks(md: string): string {
  return md.replace(/!\\\[\\?\[([^\]]+)\\?\]\\\]/g, "![[$1]]");
}

/** Clean serialized markdown: unescape wikilinks, strip empty trailing list items, trim */
function cleanOutput(raw: string): string {
  let md = unescapeWikilinks(raw);
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

interface BridgeTaskEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  className?: string;
}

export function BridgeTaskEditor({
  markdown,
  onChange,
  readOnly = false,
  className,
}: BridgeTaskEditorProps) {
  const lastEmittedNorm = useRef(normalizeMd(markdown));
  const programmatic = useRef(0);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: false }),
      Link.configure({ openOnClick: false }),
      Markdown,
    ],
    content: markdown,
    editable: !readOnly,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      // Skip updates caused by programmatic setContent
      if (programmatic.current > 0) {
        programmatic.current--;
        return;
      }
      const md = cleanOutput(
        (editor.storage as Record<string, any>).markdown.getMarkdown()
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

  // Sync external markdown changes (without triggering onChange)
  useEffect(() => {
    if (!editor) return;
    const norm = normalizeMd(markdown);
    if (norm === lastEmittedNorm.current) return;
    lastEmittedNorm.current = norm;
    // setContent fires onUpdate — flag it so we skip
    programmatic.current++;
    editor.commands.setContent(markdown);
  }, [editor, markdown]);

  return (
    <div className={`bridge-task-editor ${className ?? ""}`}>
      <EditorContent editor={editor} />
    </div>
  );
}
