"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: isDark ? "dark" : "default",
          themeVariables: isDark
            ? {
                darkMode: true,
                background: "transparent",
                primaryColor: "#1e3a5f",
                primaryTextColor: "#e5e7eb",
                primaryBorderColor: "#4b5563",
                lineColor: "#6b7280",
                secondaryColor: "#1e3a5f",
                tertiaryColor: "#1f2937",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                fontSize: "14px",
              }
            : {
                darkMode: false,
                background: "transparent",
                primaryColor: "#e0ecff",
                primaryTextColor: "#1f2937",
                primaryBorderColor: "#93b4e0",
                lineColor: "#9ca3af",
                secondaryColor: "#dbeafe",
                tertiaryColor: "#f3f4f6",
                fontFamily: "ui-sans-serif, system-ui, sans-serif",
                fontSize: "14px",
              },
        });

        // Mermaid caches rendered IDs — use a fresh one each render
        const renderId = `mermaid-${Math.random().toString(36).slice(2, 10)}`;
        const { svg } = await mermaid.render(renderId, code.trim());
        if (!cancelled && containerRef.current) {
          containerRef.current.innerHTML = svg;
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
        }
      }
    }

    render();
    return () => { cancelled = true; };
  }, [code, isDark]);

  if (error) {
    return (
      <div className="my-4 p-4 rounded-lg border border-red-500/30 bg-red-500/10">
        <div className="text-xs text-red-400 mb-2">Mermaid rendering error</div>
        <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{code}</pre>
        <pre className="text-xs text-red-300 mt-2">{error}</pre>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="my-4 flex justify-center overflow-x-auto [&_svg]:max-w-full"
    />
  );
}
