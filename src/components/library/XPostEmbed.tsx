"use client";

import { memo, useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";
import { LoadingState } from "@/components/ui/LoadingState";

type TwitterWidgetTheme = "light" | "dark";

interface TwitterWidgets {
  ready?: (callback: () => void) => void;
  widgets?: {
    createTweet?: (
      id: string,
      element: HTMLElement,
      options?: {
        align?: "left" | "center" | "right";
        cards?: "hidden" | "visible";
        conversation?: "all" | "none";
        dnt?: boolean;
        theme?: TwitterWidgetTheme;
      },
    ) => Promise<HTMLElement | null>;
  };
}

declare global {
  interface Window {
    twttr?: TwitterWidgets;
  }
}

interface XPostEmbedProps {
  postId: string;
  embedUrl: string;
  title?: string;
}

let twitterWidgetsPromise: Promise<void> | null = null;

function loadTwitterWidgets(): Promise<void> {
  if (typeof window === "undefined" || typeof document === "undefined") {
    return Promise.reject(new Error("Twitter widgets require a browser"));
  }

  if (window.twttr?.widgets?.createTweet) {
    return Promise.resolve();
  }

  if (twitterWidgetsPromise) return twitterWidgetsPromise;

  twitterWidgetsPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("twitter-widgets-js") as HTMLScriptElement | null;
    const finish = () => {
      if (window.twttr?.ready) {
        window.twttr.ready(() => resolve());
      } else {
        resolve();
      }
    };

    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", () => reject(new Error("Twitter widgets failed to load")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "twitter-widgets-js";
    script.src = "https://platform.twitter.com/widgets.js";
    script.async = true;
    script.charset = "utf-8";
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", () => reject(new Error("Twitter widgets failed to load")), { once: true });
    document.head.appendChild(script);
  });

  return twitterWidgetsPromise;
}

function XPostEmbedComponent({ postId, embedUrl, title = "X post" }: XPostEmbedProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const { resolvedTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container) return;

    container.innerHTML = "";
    setStatus("loading");

    loadTwitterWidgets()
      .then(async () => {
        if (cancelled) return;
        const createTweet = window.twttr?.widgets?.createTweet;
        if (!createTweet) throw new Error("Twitter createTweet is unavailable");

        const result = await createTweet(postId, container, {
          align: "center",
          cards: "visible",
          conversation: "none",
          dnt: true,
          theme: resolvedTheme === "dark" ? "dark" : "light",
        });
        if (!cancelled) setStatus(result ? "ready" : "fallback");
      })
      .catch(() => {
        if (!cancelled) setStatus("fallback");
      });

    return () => {
      cancelled = true;
      if (container) container.innerHTML = "";
    };
  }, [postId, resolvedTheme]);

  return (
    <div className="not-prose clear-both mx-auto my-4 flow-root w-full max-w-[550px]">
      {status !== "fallback" ? (
        <div className="relative flow-root min-h-[420px]">
          <div ref={containerRef} className="flow-root" />
          {status === "loading" ? (
            <LoadingState label="Loading X media" className="pointer-events-none absolute inset-0 min-h-[420px]" />
          ) : null}
        </div>
      ) : null}
      {status === "fallback" ? (
        <iframe
          src={embedUrl}
          title={title}
          className="block h-[960px] min-h-[720px] w-full border-0 bg-transparent"
          loading="lazy"
          allowFullScreen
        />
      ) : null}
    </div>
  );
}

export const XPostEmbed = memo(XPostEmbedComponent);
XPostEmbed.displayName = "XPostEmbed";
