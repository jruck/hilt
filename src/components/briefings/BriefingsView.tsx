"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useBriefingsList, useBriefing } from "@/hooks/useBriefings";
import { MDXRemote, type MDXRemoteSerializeResult } from "next-mdx-remote";
import { serialize } from "next-mdx-remote/serialize";
import { briefingComponents } from "./BriefingComponents";
import { ChevronDown, FileText, Loader2 } from "lucide-react";

interface BriefingsViewProps {
  searchQuery?: string;
}

export function BriefingsView({ searchQuery }: BriefingsViewProps) {
  const { briefings, latest, isLoading: listLoading, mutate: mutateList } = useBriefingsList();
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [mdxSource, setMdxSource] = useState<MDXRemoteSerializeResult | null>(null);
  const [mdxError, setMdxError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const markReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-select latest on load
  useEffect(() => {
    if (!selectedDate && latest) {
      setSelectedDate(latest.date);
    }
  }, [latest, selectedDate]);

  const activeDate = selectedDate ?? latest?.date ?? null;
  const { briefing, isLoading: briefingLoading, markRead } = useBriefing(activeDate);

  // Serialize MDX when briefing content changes
  useEffect(() => {
    if (!briefing?.content) {
      setMdxSource(null);
      return;
    }
    let cancelled = false;
    setMdxError(null);

    serialize(briefing.content, {
      parseFrontmatter: false,
    })
      .then((result) => {
        if (!cancelled) setMdxSource(result);
      })
      .catch((err) => {
        if (!cancelled) setMdxError(err?.message ?? "Failed to render briefing");
      });

    return () => { cancelled = true; };
  }, [briefing?.content]);

  // Mark as read after 2s dwell on latest
  useEffect(() => {
    if (markReadTimer.current) clearTimeout(markReadTimer.current);
    if (briefing && !briefing.readAt && activeDate === latest?.date) {
      markReadTimer.current = setTimeout(() => {
        markRead().then(() => mutateList());
      }, 2000);
    }
    return () => {
      if (markReadTimer.current) clearTimeout(markReadTimer.current);
    };
  }, [briefing, activeDate, latest?.date, markRead, mutateList]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!showDropdown) return;
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showDropdown]);

  // Filter briefings by search
  const filteredBriefings = useMemo(() => {
    if (!searchQuery) return briefings;
    const q = searchQuery.toLowerCase();
    return briefings.filter(b =>
      b.title.toLowerCase().includes(q) ||
      b.date.includes(q) ||
      b.author.toLowerCase().includes(q)
    );
  }, [briefings, searchQuery]);

  const activeBriefing = briefings.find(b => b.date === activeDate);

  const formatDate = (date: string) => {
    return new Date(date + "T12:00:00").toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
  };

  if (listLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (briefings.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)] px-8">
        <FileText className="w-12 h-12 opacity-40" />
        <p className="text-sm text-center">No briefings yet.</p>
        <p className="text-xs text-center opacity-60">
          Briefings appear here when agents publish daily reports to bridge/briefings/
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with date selector */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b border-[var(--border-default)] flex-shrink-0">
        <div ref={dropdownRef} className="relative">
          <button
            onClick={() => setShowDropdown(!showDropdown)}
            className="flex items-center gap-2 text-sm font-medium text-[var(--text-primary)] hover:text-[var(--text-secondary)] transition-colors"
          >
            <span>{activeBriefing ? formatDate(activeBriefing.date) : "Select briefing"}</span>
            {activeBriefing?.title && activeBriefing.title !== "Daily Briefing" && (
              <span className="text-[var(--text-tertiary)] font-normal">— {activeBriefing.title}</span>
            )}
            <ChevronDown className="w-4 h-4 text-[var(--text-tertiary)]" />
          </button>

          {showDropdown && (
            <div className="absolute left-0 top-full mt-1 z-50 min-w-[280px] max-h-[400px] overflow-y-auto rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg py-1">
              {filteredBriefings.map((b) => (
                <button
                  key={b.date}
                  onClick={() => {
                    setSelectedDate(b.date);
                    setShowDropdown(false);
                  }}
                  className={`flex items-center gap-3 w-full px-4 py-2.5 text-sm transition-colors ${
                    b.date === activeDate
                      ? "bg-[var(--bg-secondary)] text-[var(--text-primary)]"
                      : "text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)]"
                  }`}
                >
                  <span className="font-medium">{formatDate(b.date)}</span>
                  <span className="text-xs text-[var(--text-tertiary)] truncate flex-1">{b.title}</span>
                  {!b.readAt && b.date === latest?.date && (
                    <span className="w-2 h-2 rounded-full bg-blue-400 flex-shrink-0" />
                  )}
                </button>
              ))}
              {briefings.length > 30 && (
                <div className="px-4 py-2 text-xs text-[var(--text-tertiary)] border-t border-[var(--border-default)]">
                  View older briefings in the Docs tab → briefings/
                </div>
              )}
            </div>
          )}
        </div>

        {activeBriefing && (
          <span className="text-xs text-[var(--text-tertiary)]">
            by {activeBriefing.author}
          </span>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 sm:px-8 py-6">
          {briefingLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
            </div>
          ) : mdxError ? (
            <div className="p-4 rounded-lg border border-red-500/30 bg-red-500/10">
              <p className="text-sm text-red-400 font-medium mb-1">Failed to render briefing</p>
              <pre className="text-xs text-red-300 whitespace-pre-wrap">{mdxError}</pre>
              {briefing?.content && (
                <details className="mt-3">
                  <summary className="text-xs text-[var(--text-tertiary)] cursor-pointer">Raw content</summary>
                  <pre className="mt-2 text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{briefing.content}</pre>
                </details>
              )}
            </div>
          ) : mdxSource ? (
            <div className="briefing-content prose prose-invert max-w-none prose-headings:font-semibold prose-p:text-[var(--text-secondary)] prose-p:leading-relaxed prose-a:text-blue-400 prose-a:no-underline hover:prose-a:underline prose-strong:text-[var(--text-primary)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:bg-[var(--bg-tertiary)] prose-code:text-[var(--text-secondary)] prose-code:before:content-none prose-code:after:content-none prose-li:text-[var(--text-secondary)]">
              <MDXRemote {...mdxSource} components={briefingComponents} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
