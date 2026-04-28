"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import CodeMirror from "@uiw/react-codemirror";
import { EditorView } from "@codemirror/view";
import { markdown as cmMarkdown, markdownLanguage } from "@codemirror/lang-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { MermaidBlock } from "./MermaidBlock";
import type { FileNode } from "@/lib/types";
import { resolveWikilink, parseWikilinks, parseImageWikilinks } from "@/lib/docs/wikilink-resolver";
import * as path from "path";

/** Extract YAML frontmatter key-value pairs from markdown. Returns null if no frontmatter. */
function parseFrontmatter(md: string): Record<string, string> | null {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
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

function stripFrontmatter(md: string): string {
  return md.replace(/^---\n[\s\S]*?\n---\n?/, "");
}

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

const cmDarkTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px",
    lineHeight: "1.6",
    paddingTop: "12px",
    paddingBottom: "12px",
  },
  ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(255, 255, 255, 0.1)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-tertiary)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLine": { backgroundColor: "rgba(255, 255, 255, 0.03)" },
  ".cm-line": { paddingLeft: "4px" },
  ".cm-scroller": { fontFamily: "inherit" },
}, { dark: true });

const cmLightTheme = EditorView.theme({
  "&": {
    backgroundColor: "var(--bg-primary)",
    color: "var(--text-primary)",
    height: "100%",
  },
  ".cm-content": {
    caretColor: "var(--text-primary)",
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
    fontSize: "13px",
    lineHeight: "1.6",
    paddingTop: "12px",
    paddingBottom: "12px",
  },
  ".cm-cursor": { borderLeftColor: "var(--text-primary)" },
  "&.cm-focused .cm-selectionBackground, .cm-selectionBackground": {
    backgroundColor: "rgba(0, 0, 0, 0.1)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--bg-secondary)",
    color: "var(--text-tertiary)",
    border: "none",
    paddingRight: "8px",
  },
  ".cm-activeLine": { backgroundColor: "rgba(0, 0, 0, 0.03)" },
  ".cm-line": { paddingLeft: "4px" },
  ".cm-scroller": { fontFamily: "inherit" },
}, { dark: false });

interface DocsEditorProps {
  markdown: string;
  onChange?: (markdown: string) => void;
  readOnly?: boolean;
  /** Kept for backward compatibility — toolbar no longer rendered. */
  hideToolbar?: boolean;
  contentPadding?: string;
  wrapperClassName?: string;
  currentFilePath?: string;
  scopePath?: string;
  fileTree?: FileNode | null;
  onNavigateToFile?: (path: string) => void;
}

export function DocsEditor({
  markdown: markdownProp,
  onChange,
  readOnly = false,
  contentPadding,
  wrapperClassName,
  currentFilePath,
  scopePath,
  fileTree,
  onNavigateToFile,
}: DocsEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { resolvedTheme } = useTheme();

  const frontmatterFields = useMemo(() => parseFrontmatter(markdownProp), [markdownProp]);
  const rawFrontmatterRef = useRef<string | null>(null);
  useMemo(() => {
    const match = markdownProp.match(/^(---\n[\s\S]*?\n---\n?)/);
    rawFrontmatterRef.current = match ? match[1] : null;
  }, [markdownProp]);

  const body = useMemo(() => stripFrontmatter(markdownProp), [markdownProp]);

  const handleBodyChange = useCallback((newBody: string) => {
    if (!onChange) return;
    onChange(rawFrontmatterRef.current ? rawFrontmatterRef.current + newBody : newBody);
  }, [onChange]);

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
      onChange(rawFrontmatterRef.current + body);
    }
  }, [onChange, body]);

  // Async resolution for vault-relative wikilinks (paths the synchronous resolver
  // can't handle without filesystem access)
  const [asyncResolvedLinks, setAsyncResolvedLinks] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    if (!body || !currentFilePath || !scopePath || !readOnly) {
      setAsyncResolvedLinks(new Map());
      return;
    }

    const wikilinks = parseWikilinks(body);
    const imageWikilinks = parseImageWikilinks(body);
    const allTargets = [
      ...wikilinks.map(l => l.target),
      ...imageWikilinks.map(l => l.target),
    ];

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
  }, [body, currentFilePath, scopePath, fileTree, readOnly]);

  // Read-mode body: rewrite [[wikilinks]] and ![[image wikilinks]] into standard
  // markdown so ReactMarkdown can render them. Also rewrites relative image paths
  // to /api/docs/raw URLs.
  const renderedBody = useMemo(() => {
    if (!readOnly) return body;
    if (!currentFilePath || !scopePath) return body;

    let result = body;
    const replacements: { start: number; end: number; replacement: string }[] = [];

    const imageWikilinks = parseImageWikilinks(body);
    for (const img of imageWikilinks) {
      const resolved = resolveWikilink(img.target, currentFilePath, scopePath, fileTree || null);
      if (!resolved.exists && asyncResolvedLinks.has(img.target)) {
        resolved.absolutePath = asyncResolvedLinks.get(img.target)!;
        resolved.exists = true;
      }
      let imagePath: string;

      if (resolved.exists && resolved.absolutePath) {
        imagePath = resolved.absolutePath;
      } else {
        const currentDir = path.dirname(currentFilePath);
        if (img.target.startsWith("/")) {
          imagePath = path.join(scopePath, img.target);
        } else if (!img.target.includes("/")) {
          imagePath = path.resolve(currentDir, "media", img.target);
        } else {
          imagePath = path.resolve(currentDir, img.target);
        }
      }

      const imageUrl = `/api/docs/raw?path=${encodeURIComponent(imagePath)}&scope=${encodeURIComponent(scopePath)}`;
      replacements.push({
        start: img.start,
        end: img.end,
        replacement: `![${img.altText}](${imageUrl})`,
      });
    }

    const wikilinks = parseWikilinks(body);
    for (const link of wikilinks) {
      const resolved = resolveWikilink(link.target, currentFilePath, scopePath, fileTree || null);
      if (!resolved.exists && asyncResolvedLinks.has(link.target)) {
        resolved.absolutePath = asyncResolvedLinks.get(link.target)!;
        resolved.exists = true;
      }

      const linkPath = resolved.exists && resolved.absolutePath
        ? `#wikilink:${encodeURIComponent(resolved.absolutePath)}`
        : `#wikilink-broken:${encodeURIComponent(link.target)}`;

      replacements.push({
        start: link.start,
        end: link.end,
        replacement: `[${link.display}](${linkPath})`,
      });
    }

    replacements.sort((a, b) => b.start - a.start);
    for (const r of replacements) {
      result = result.slice(0, r.start) + r.replacement + result.slice(r.end);
    }

    // Rewrite standard markdown images with relative paths to use /api/docs/raw
    const currentDir = path.dirname(currentFilePath);
    result = result.replace(
      /!\[([^\]]*)\]\(([^)]+)\)/g,
      (match, alt, src) => {
        if (/^(https?:\/\/|data:|\/api\/)/.test(src)) return match;
        const absPath = src.startsWith("/")
          ? path.join(scopePath, src)
          : path.resolve(currentDir, src);
        const url = `/api/docs/raw?path=${encodeURIComponent(absPath)}&scope=${encodeURIComponent(scopePath)}`;
        return `![${alt}](${url})`;
      }
    );

    return result;
  }, [body, readOnly, currentFilePath, scopePath, fileTree, asyncResolvedLinks]);

  // Intercept clicks on wikilink hash anchors and dispatch to onNavigateToFile
  const handleWikilinkClick = useCallback((e: MouseEvent) => {
    const target = e.target as HTMLElement;
    const link = target.closest('a');
    if (!link) return;
    const href = link.getAttribute('href');
    if (href?.startsWith('#wikilink:')) {
      e.preventDefault();
      e.stopPropagation();
      const filePath = decodeURIComponent(href.replace('#wikilink:', ''));
      if (onNavigateToFile) onNavigateToFile(filePath);
    } else if (href?.startsWith('#wikilink-broken:')) {
      e.preventDefault();
      e.stopPropagation();
    }
  }, [onNavigateToFile]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('mousedown', handleWikilinkClick, true);
    container.addEventListener('click', handleWikilinkClick, true);
    return () => {
      container.removeEventListener('mousedown', handleWikilinkClick, true);
      container.removeEventListener('click', handleWikilinkClick, true);
    };
  }, [handleWikilinkClick]);

  // Convert <img> tags with video extensions to <video> elements after render
  const VIDEO_EXTENSIONS = /\.(mp4|webm|mov|ogg)(\?|$)/i;
  useEffect(() => {
    if (!readOnly) return;
    const el = containerRef.current;
    if (!el) return;

    const promote = (img: HTMLImageElement) => {
      const src = img.getAttribute('src') || '';
      if (!VIDEO_EXTENSIONS.test(src)) return;
      const video = document.createElement('video');
      video.src = src;
      video.controls = true;
      video.style.maxWidth = '100%';
      video.style.borderRadius = '8px';
      img.replaceWith(video);
    };

    const observer = new MutationObserver(() => {
      el.querySelectorAll('img').forEach(promote);
    });
    observer.observe(el, { childList: true, subtree: true });
    el.querySelectorAll('img').forEach(promote);

    return () => observer.disconnect();
  }, [readOnly, renderedBody]);

  // Inject copy buttons on <pre> code blocks in read mode
  useEffect(() => {
    if (!readOnly || !containerRef.current) return;

    const copyIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2" ry="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>`;
    const checkIcon = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;

    const addCopyButton = (pre: HTMLElement) => {
      if (pre.querySelector('.docs-code-copy-btn')) return;
      const code = pre.querySelector('code');
      if (!code) return;
      const btn = document.createElement('button');
      btn.className = 'docs-code-copy-btn';
      btn.title = 'Copy code';
      btn.type = 'button';
      btn.innerHTML = copyIcon;
      btn.addEventListener('click', () => {
        const text = code.textContent || '';
        navigator.clipboard.writeText(text).then(() => {
          btn.innerHTML = checkIcon;
          setTimeout(() => { btn.innerHTML = copyIcon; }, 1500);
        });
      });
      pre.classList.add('docs-code-block-wrapper');
      pre.appendChild(btn);
    };

    const container = containerRef.current;
    container.querySelectorAll('pre').forEach((pre) => addCopyButton(pre as HTMLElement));

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof HTMLElement)) continue;
          if (node.tagName === 'PRE') addCopyButton(node);
          node.querySelectorAll?.('pre').forEach((pre) => addCopyButton(pre as HTMLElement));
        }
      }
    });
    observer.observe(container, { childList: true, subtree: true });

    return () => {
      observer.disconnect();
      container.querySelectorAll('.docs-code-copy-btn').forEach(btn => btn.remove());
    };
  }, [readOnly, renderedBody]);

  const proseInvert = resolvedTheme === "dark" ? "prose-invert" : "";
  const proseClass = `prose ${proseInvert} max-w-none leading-normal font-[family-name:var(--font-geist-sans)]
    prose-headings:font-semibold
    prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none
    prose-pre:rounded-lg prose-pre:bg-[var(--bg-tertiary)]
    prose-a:text-blue-600 dark:prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline
    prose-table:border-collapse prose-table:bg-[var(--bg-primary)]
    prose-thead:bg-[var(--bg-secondary)]
    prose-th:border prose-th:border-[var(--border-default)] prose-th:px-3 prose-th:py-2
    prose-td:border prose-td:border-[var(--border-default)] prose-td:px-3 prose-td:py-2 prose-td:bg-[var(--bg-primary)]`;

  const markdownComponents: import("react-markdown").Components = {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      if (match?.[1] === "mermaid") {
        return <MermaidBlock code={String(children).replace(/\n$/, "")} />;
      }
      return <code className={className} {...props}>{children}</code>;
    },
  };

  return (
    <div ref={containerRef} className={`flex flex-col ${wrapperClassName ? wrapperClassName : "h-full docs-editor-wrapper"} ${readOnly ? "docs-read-mode" : ""}`}>
      {readOnly && frontmatterFields && <FrontmatterDisplay fields={frontmatterFields} />}
      {!readOnly && frontmatterFields && (
        <EditableFrontmatter key={currentFilePath} fields={frontmatterFields} onChange={handleFrontmatterFieldChange} />
      )}

      {readOnly ? (
        <div className={`${proseClass} flex-1 overflow-auto ${contentPadding ?? "px-12 py-6"}`}>
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeRaw]}
            components={markdownComponents}
          >
            {renderedBody}
          </ReactMarkdown>
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-hidden">
          <CodeMirror
            key={resolvedTheme}
            value={body}
            onChange={handleBodyChange}
            theme={resolvedTheme === "dark" ? "dark" : "light"}
            extensions={[
              EditorView.lineWrapping,
              cmMarkdown({ base: markdownLanguage }),
              resolvedTheme === "dark" ? cmDarkTheme : cmLightTheme,
            ]}
            basicSetup={{
              lineNumbers: false,
              foldGutter: false,
              highlightActiveLineGutter: false,
              highlightActiveLine: true,
              dropCursor: true,
              allowMultipleSelections: true,
              indentOnInput: true,
              bracketMatching: true,
              closeBrackets: false,
              autocompletion: false,
              rectangularSelection: true,
              crosshairCursor: false,
              highlightSelectionMatches: false,
              searchKeymap: true,
            }}
            className="h-full"
          />
        </div>
      )}
    </div>
  );
}
