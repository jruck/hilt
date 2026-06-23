"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import { useTheme } from "@/hooks/useTheme";
import { SHARED_PROSE_TUNING } from "@/lib/prose";
import { getXEmbedPostId, getYouTubeVideoId, isXEmbedUrl } from "@/lib/library/media";
import { YouTubeEmbed, type YouTubeSeekRequest } from "./YouTubeEmbed";
import { XPostEmbed } from "./XPostEmbed";

interface LibraryMarkdownProps {
  markdown: string;
  className?: string;
  youTubeSeekRequest?: YouTubeSeekRequest | null;
  onYouTubeTimeChange?: (seconds: number) => void;
  onWikilinkNavigate?: (target: string) => void | Promise<void>;
}

function rewriteWikilinks(markdown: string): string {
  return markdown
    .replace(/!\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
      const src = target.trim();
      const alt = (label || src).trim().replace(/]/g, "\\]");
      return `![${alt}](${src})`;
    })
    .replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, label?: string) => {
      const display = (label || target).trim().replace(/]/g, "\\]");
      return `[${display}](#wikilink:${encodeURIComponent(target.trim())})`;
    });
}

function LibraryMarkdownComponent({
  markdown,
  className = "",
  youTubeSeekRequest,
  onYouTubeTimeChange,
  onWikilinkNavigate,
}: LibraryMarkdownProps) {
  const { resolvedTheme } = useTheme();
  const rewrittenMarkdown = useMemo(() => rewriteWikilinks(markdown), [markdown]);
  const proseInvert = resolvedTheme === "dark" ? "prose-invert" : "";
  // Shared prose treatment is the single source of truth (see src/lib/prose.ts). Library's deltas:
  //  - NO `leading-normal`: inherit prose's calibrated rhythm so body line-height and heading gaps stay
  //    proportional, matching Docs read-mode (the gold master, DESIGN-PHILOSOPHY §314).
  //  - app-token body colors; document-style links live in the `.library-markdown a` CSS (§523).
  const proseClass = `prose ${proseInvert} ${SHARED_PROSE_TUNING}
    prose-headings:text-[var(--text-primary)]
    prose-p:text-[var(--text-secondary)] prose-li:text-[var(--text-secondary)]
    prose-strong:text-[var(--text-primary)]
    prose-img:rounded-lg prose-img:border prose-img:border-[var(--border-default)]
    prose-hr:border-[var(--border-default)]`;

  const components = useMemo<Components>(() => ({
    a({ href, children, ...props }) {
      if (href?.startsWith("#wikilink:")) {
        const target = decodeURIComponent(href.replace("#wikilink:", ""));
        return (
          <a
            href={href}
            onClick={(event) => {
              if (!onWikilinkNavigate) return;
              event.preventDefault();
              void onWikilinkNavigate(target);
            }}
            title={`Open ${target}`}
            {...props}
          >
            {children}
          </a>
        );
      }
      return <a href={href} target={href?.startsWith("http") ? "_blank" : undefined} rel={href?.startsWith("http") ? "noreferrer" : undefined} {...props}>{children}</a>;
    },
    iframe({ src, title, ...props }) {
      const videoId = typeof src === "string" ? getYouTubeVideoId(src) : null;
      if (videoId) {
        return (
          <div className="mx-auto my-4 w-full">
            <YouTubeEmbed
              videoId={videoId}
              title={typeof title === "string" ? title : "YouTube video"}
              seekRequest={youTubeSeekRequest}
              onTimeChange={onYouTubeTimeChange}
            />
          </div>
        );
      }
      if (typeof src === "string" && isXEmbedUrl(src)) {
        const postId = getXEmbedPostId(src);
        if (postId) {
          return <XPostEmbed postId={postId} embedUrl={src} title={typeof title === "string" ? title : "X post"} />;
        }
      }
      return (
        <div className="mx-auto my-4 aspect-video w-full overflow-hidden rounded-lg border border-[var(--border-default)] bg-black">
          <iframe
            src={src}
            title={title || "Embedded media"}
            className="h-full w-full"
            loading="lazy"
            allowFullScreen
            {...props}
          />
        </div>
      );
    },
    img({ src, alt, ...props }) {
      return <img {...props} src={src} alt={alt || ""} className="mx-auto max-w-full" />;
    },
    details({ children, ...props }) {
      return <details className="rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] px-4 py-3" {...props}>{children}</details>;
    },
    summary({ children, ...props }) {
      return <summary className="cursor-pointer text-sm font-medium text-[var(--text-primary)]" {...props}>{children}</summary>;
    },
  }), [onWikilinkNavigate, onYouTubeTimeChange, youTubeSeekRequest]);

  return (
    <div className={`library-markdown ${proseClass} ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeRaw]} components={components}>
        {rewrittenMarkdown}
      </ReactMarkdown>
    </div>
  );
}

export const LibraryMarkdown = memo(LibraryMarkdownComponent);
LibraryMarkdown.displayName = "LibraryMarkdown";
