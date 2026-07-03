"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useScope } from "@/contexts/ScopeContext";
import { withBasePath } from "@/lib/base-path";

interface DocResponse {
  content: string;
  updated_at: string;
  doc_path: string;
}

/**
 * The ⓘ view: renders docs/HOW-IT-WORKS.md — the canonical reference for how the loops and the
 * briefing pipeline work. `open://<absolute path>` links open the target file or folder in the
 * Docs view for direct inspection.
 */
export function HowItWorksDoc({ onNavigated = () => {} }: { onNavigated?: () => void }) {
  const { navigateTo } = useScope();
  const [doc, setDoc] = useState<DocResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(withBasePath("/api/system/how-it-works"), { cache: "no-store" })
      .then((response) => {
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response.json() as Promise<DocResponse>;
      })
      .then((data) => { if (!cancelled) setDoc(data); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load"); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="flex-1 p-8 text-sm text-[var(--text-tertiary)]">Couldn't load the reference: {error}</div>;
  }
  if (!doc) {
    return <div className="flex-1 p-8 text-sm text-[var(--text-tertiary)]">Loading…</div>;
  }

  return (
    <div className="flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="mx-auto max-w-3xl px-6 pb-16 pt-8">
        <div className="mb-6 flex items-baseline justify-between gap-3 border-b border-[var(--border-default)] pb-3">
          <span className="text-xs text-[var(--text-tertiary)]">
            Canonical reference · updated {new Date(doc.updated_at).toLocaleString()}
          </span>
          <span className="text-xs text-[var(--text-tertiary)]">docs/HOW-IT-WORKS.md</span>
        </div>
        <div className="prose max-w-none
          prose-headings:text-[var(--text-primary)] prose-headings:font-semibold
          prose-h1:text-xl prose-h2:text-lg prose-h3:text-base
          prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed
          prose-li:text-[var(--text-secondary)] prose-li:leading-relaxed
          prose-strong:text-[var(--text-primary)]
          prose-a:text-[var(--interactive-default)] hover:prose-a:text-[var(--interactive-hover)]
          prose-a:no-underline hover:prose-a:underline prose-a:underline-offset-2
          prose-blockquote:text-[var(--text-secondary)] prose-blockquote:border-[var(--border-default)]
          prose-code:text-[var(--text-secondary)] prose-code:bg-[var(--bg-tertiary)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded
          prose-table:text-sm prose-th:text-[var(--text-primary)] prose-td:text-[var(--text-secondary)]
          prose-hr:border-[var(--border-default)]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            // Default sanitizer strips the custom open:// scheme to "" (clicks then reload the
            // app). Content here is our own repo doc — pass hrefs through untouched.
            urlTransform={(url) => url}
            components={{
              a: ({ href, children }) => {
                if (href?.startsWith("open://")) {
                  const target = href.slice("open://".length);
                  return (
                    <a
                      href="#"
                      title={target}
                      onClick={(event) => {
                        event.preventDefault();
                        navigateTo("docs", target);
                        onNavigated(); // close the reference overlay so the Docs view is visible
                      }}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {children}
                  </a>
                );
              },
            }}
          >
            {doc.content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
