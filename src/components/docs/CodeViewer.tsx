"use client";

import { useMemo } from "react";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { rust } from "@codemirror/lang-rust";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { cpp } from "@codemirror/lang-cpp";
import { sql } from "@codemirror/lang-sql";
import { php } from "@codemirror/lang-php";
import { useTheme } from "@/hooks/useTheme";

interface CodeViewerProps {
  filePath: string;
  content: string;
  readOnly?: boolean;
  onChange?: (content: string) => void;
}

// Map file extensions to CodeMirror language extensions
function getLanguageExtension(extension: string) {
  switch (extension) {
    case "js":
    case "mjs":
    case "cjs":
      return javascript();
    case "jsx":
      return javascript({ jsx: true });
    case "ts":
    case "mts":
    case "cts":
      return javascript({ typescript: true });
    case "tsx":
      return javascript({ jsx: true, typescript: true });
    case "py":
    case "pyw":
    case "pyi":
      return python();
    case "html":
    case "htm":
      return html();
    case "css":
    case "scss":
    case "less":
    case "sass":
      return css();
    case "json":
    case "jsonc":
      return json();
    case "xml":
    case "xsl":
    case "xslt":
    case "svg":
      return xml();
    case "yaml":
    case "yml":
      return yaml();
    case "rs":
      return rust();
    case "go":
      return go();
    case "java":
      return java();
    case "c":
    case "h":
      return cpp();
    case "cpp":
    case "cc":
    case "cxx":
    case "hpp":
    case "hxx":
      return cpp();
    case "sql":
      return sql();
    case "php":
      return php();
    default:
      return null;
  }
}

// Dark theme matching the app
const darkTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-primary)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-tertiary)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-tertiary)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(255, 255, 255, 0.03)",
  },
  ".cm-line": {
    paddingLeft: "4px",
  },
}, { dark: true });

// Light theme
const lightTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px",
    lineHeight: "1.6",
  },
  ".cm-cursor": {
    borderLeftColor: "var(--text-primary)",
  },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(0, 0, 0, 0.1)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-tertiary)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLineGutter": {
    backgroundColor: "var(--bg-tertiary)",
  },
  ".cm-activeLine": {
    backgroundColor: "rgba(0, 0, 0, 0.03)",
  },
  ".cm-line": {
    paddingLeft: "4px",
  },
}, { dark: false });

export function CodeViewer({ filePath, content, readOnly = true, onChange }: CodeViewerProps) {
  const extension = filePath.split(".").pop()?.toLowerCase() || "";
  const { resolvedTheme } = useTheme();
  const lineCount = content.split("\n").length;

  const extensions = useMemo(() => {
    const exts = [
      EditorView.lineWrapping,
      resolvedTheme === "dark" ? darkTheme : lightTheme,
    ];

    const langExt = getLanguageExtension(extension);
    if (langExt) {
      exts.push(langExt);
    }

    return exts;
  }, [extension, resolvedTheme]);

  return (
    <div className="flex-1 flex flex-col overflow-auto px-4 pb-4">
      {/* Stats centered at top */}
      <div className="text-center text-xs text-[var(--text-tertiary)] py-3">
        {lineCount} line{lineCount !== 1 ? "s" : ""}
      </div>

      {/* Editor */}
      <CodeMirror
        key={resolvedTheme} // Force remount on theme change
        value={content}
        theme={resolvedTheme === "dark" ? "dark" : "light"}
        extensions={extensions}
        readOnly={readOnly}
        editable={!readOnly}
        onChange={onChange}
        basicSetup={{
          lineNumbers: true,
          highlightActiveLineGutter: true,
          highlightActiveLine: true,
          foldGutter: true,
          dropCursor: true,
          allowMultipleSelections: true,
          indentOnInput: true,
          bracketMatching: true,
          closeBrackets: true,
          autocompletion: !readOnly,
          rectangularSelection: true,
          crosshairCursor: false,
          highlightSelectionMatches: true,
          searchKeymap: true,
        }}
        className="flex-1"
      />
    </div>
  );
}
