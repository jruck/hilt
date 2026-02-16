"use client";

import { useEffect, useRef, useState } from "react";

interface MermaidBlockProps {
  code: string;
}

export function MermaidBlock({ code }: MermaidBlockProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2, 10)}`);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "dark",
          themeVariables: {
            darkMode: true,
            background: "transparent",
            primaryColor: "#3b82f6",
            primaryTextColor: "#e5e7eb",
            primaryBorderColor: "#4b5563",
            lineColor: "#6b7280",
            secondaryColor: "#1e3a5f",
            tertiaryColor: "#1f2937",
            fontFamily: "ui-sans-serif, system-ui, sans-serif",
            fontSize: "14px",
          },
        });

        const { svg } = await mermaid.render(idRef.current, code.trim());
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
  }, [code]);

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
