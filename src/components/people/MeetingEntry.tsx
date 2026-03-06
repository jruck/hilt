"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { NotebookPen, FileText, ScrollText, Loader2, MoreVertical, Trash2, Calendar, CalendarClock, Lock, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import type { PersonMeeting } from "@/lib/types";
import { TranscriptView } from "./TranscriptView";
import { useHaptics } from "@/hooks/useHaptics";

const BridgeTaskEditor = dynamic(
  () => import("../bridge/BridgeTaskEditor").then((mod) => mod.BridgeTaskEditor),
  { ssr: false }
);

interface MeetingEntryProps {
  meeting: PersonMeeting;
  slug: string;
  vaultPath?: string;
  autoFocus?: boolean;
  onDelete?: () => void;
}

function formatDate(isoDate: string): string {
  const date = new Date(isoDate + "T00:00:00");
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

type Tab = "notes" | "summary" | "transcript";

/**
 * Split Granola summary into Private Notes and Enhanced Notes sections
 * when both are present. Returns null if the pattern isn't found.
 */
function splitSummarySections(summary: string): { privateNotes: string; enhancedNotes: string } | null {
  const privateIdx = summary.indexOf("## Private Notes");
  const enhancedIdx = summary.indexOf("## Enhanced Notes");
  if (privateIdx === -1 || enhancedIdx === -1) return null;

  const privateContent = summary.slice(privateIdx + "## Private Notes".length, enhancedIdx).trim();
  const enhancedContent = summary.slice(enhancedIdx + "## Enhanced Notes".length).trim();
  return { privateNotes: privateContent, enhancedNotes: enhancedContent };
}

export function MeetingEntry({ meeting, slug, vaultPath, autoFocus, onDelete }: MeetingEntryProps) {
  const haptics = useHaptics();
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const isNext = meeting.source === "next";
  const hasNotes = !!meeting.notes;
  const hasSummary = !!meeting.summary;
  const hasTranscript = !!meeting.transcriptPath;

  // Show menu for inline and next (never granola-only)
  const canDelete = meeting.source === "inline" || meeting.source === "next";
  const canChangeDate = meeting.source === "inline";

  // Three-dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const changeDateRef = useRef<HTMLInputElement>(null);

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showMenu]);

  // Reset menu state when meeting changes
  useEffect(() => {
    setShowMenu(false);
    setConfirmDelete(false);
  }, [meeting.date, meeting.source]);

  // Available tabs (not for "next" mode)
  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [];
  if (!isNext) {
    if (hasNotes) tabs.push({ key: "notes", label: "Written Notes", icon: NotebookPen });
    if (hasSummary) tabs.push({ key: "summary", label: "Summary", icon: FileText });
    if (hasTranscript) tabs.push({ key: "transcript", label: "Transcript", icon: ScrollText });
  }

  // Default: written notes if available, else summary
  const defaultTab: Tab = hasNotes ? "notes" : hasSummary ? "summary" : "transcript";
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);

  // Reset tab when meeting changes
  useEffect(() => {
    setActiveTab(hasNotes ? "notes" : hasSummary ? "summary" : "transcript");
  }, [meeting.date, meeting.source]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-focus editor when this is the topmost editable entry
  useEffect(() => {
    if (!autoFocus) return;
    // BridgeTaskEditor is dynamically imported — poll until contenteditable appears
    let attempts = 0;
    const interval = setInterval(() => {
      const el = editorAreaRef.current?.querySelector("[contenteditable]") as HTMLElement;
      if (el) {
        el.focus();
        clearInterval(interval);
      } else if (++attempts > 20) {
        clearInterval(interval);
      }
    }, 50);
    return () => clearInterval(interval);
  }, [autoFocus, slug, meeting.date, meeting.source]);

  // Editing state for notes
  const lastSavedNotes = useRef(meeting.notes || "");

  const handleNotesChange = useCallback(
    (markdown: string) => {
      if (markdown !== lastSavedNotes.current) {
        lastSavedNotes.current = markdown;
        if (isNext) {
          fetch(`/api/bridge/people/${slug}/next`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ content: markdown }),
          });
        } else {
          fetch(`/api/bridge/people/${slug}/notes`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ date: meeting.date, notes: markdown }),
          });
        }
      }
    },
    [slug, meeting.date, isNext]
  );

  // Date picker commits Next content as a dated meeting entry
  const handleDateCommit = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const date = e.target.value;
      if (!date) return;
      fetch(`/api/bridge/people/${slug}/next`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ commit: date }),
      }).then(() => onDelete?.());
    },
    [slug, onDelete]
  );

  // Change date for inline notes
  const handleChangeDate = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = e.target.value;
      if (!newDate || newDate === meeting.date) return;
      fetch(`/api/bridge/people/${slug}/notes`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldDate: meeting.date, newDate }),
      }).then(() => onDelete?.());
    },
    [slug, meeting.date, onDelete]
  );

  // Delete handler
  const handleDelete = useCallback(() => {
    if (isNext) {
      fetch(`/api/bridge/people/${slug}/next`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", date: null }),
      }).then(() => onDelete?.());
    } else if (meeting.source === "inline") {
      fetch(`/api/bridge/people/${slug}/notes`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: meeting.date }),
      }).then(() => onDelete?.());
    }
  }, [slug, meeting.source, meeting.date, isNext, onDelete]);

  // Lazy-load transcript content when tab is selected
  const [transcriptContent, setTranscriptContent] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const transcriptFetched = useRef(false);

  useEffect(() => {
    if (activeTab === "transcript" && hasTranscript && !transcriptFetched.current) {
      transcriptFetched.current = true;
      setTranscriptLoading(true);
      const scope = vaultPath || "/";
      fetch(`/api/docs/file?path=${encodeURIComponent(meeting.transcriptPath!)}&scope=${encodeURIComponent(scope)}`)
        .then((res) => res.json())
        .then((data) => {
          if (data.content) setTranscriptContent(data.content);
        })
        .catch(() => {})
        .finally(() => setTranscriptLoading(false));
    }
  }, [activeTab, hasTranscript, meeting.transcriptPath, vaultPath]);

  // Menu button
  const menuButton = (canDelete || canChangeDate) ? (
    <div className="flex-shrink-0 relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {showMenu && (
        <div className="absolute right-0 top-full mt-1 w-44 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
          {canChangeDate && (
            <button
              onClick={() => {
                setShowMenu(false);
                changeDateRef.current?.showPicker();
              }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <CalendarClock className="w-4 h-4 text-[var(--text-tertiary)]" />
              Change date
            </button>
          )}
          {canDelete && (
            <>
              {canChangeDate && <div className="my-1 border-t border-[var(--border-default)]" />}
              <button
                onClick={() => {
                  setShowMenu(false);
                  setConfirmDelete(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-500 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
                {isNext ? "Clear next" : "Delete notes"}
              </button>
            </>
          )}
        </div>
      )}
      {/* Hidden date input for change-date */}
      {canChangeDate && (
        <input
          ref={changeDateRef}
          type="date"
          value={meeting.date}
          onChange={handleChangeDate}
          className="absolute opacity-0 pointer-events-none w-0 h-0"
          style={{ colorScheme: "dark" }}
        />
      )}
    </div>
  ) : null;

  // Delete confirmation bar
  const deleteBar = confirmDelete ? (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-3 bg-red-500/10 border-b border-red-500/20">
      <span className="text-sm text-red-500 flex-1">
        {isNext ? "Clear all Next content?" : "Delete this meeting\u2019s notes?"}
      </span>
      <button
        onClick={handleDelete}
        className="px-3 py-1 text-xs font-medium rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
      >
        Delete
      </button>
      <button
        onClick={() => setConfirmDelete(false)}
        className="px-3 py-1 text-xs font-medium rounded text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
      >
        Cancel
      </button>
    </div>
  ) : null;

  // "Next" mode — editor only, no tabs
  if (isNext) {
    return (
      <div className="bg-[var(--bg-primary)]">
        <div className="h-16 px-4 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-base font-medium text-[var(--text-primary)]">Next</span>
            <button
              onClick={() => dateInputRef.current?.showPicker()}
              className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded"
              title="Set date and commit"
            >
              <Calendar className="w-4 h-4" />
            </button>
            <input
              ref={dateInputRef}
              type="date"
              value=""
              onChange={handleDateCommit}
              className="absolute opacity-0 pointer-events-none w-0 h-0"
              style={{ colorScheme: "dark" }}
            />
          </div>
          {menuButton}
        </div>
        {deleteBar}
        <div ref={editorAreaRef} className="px-4 py-3">
          <div className="prose-compact">
            <BridgeTaskEditor
              markdown={meeting.notes || ""}
              onChange={handleNotesChange}
              readOnly={false}
              vaultPath={vaultPath}
            />
          </div>
        </div>
      </div>
    );
  }

  // Title: Granola title or null for inline
  const title = meeting.source === "granola" && meeting.title ? meeting.title : null;

  return (
    <div className="bg-[var(--bg-primary)]">
      {/* Card header — date is primary, title is subtext */}
      <div className="h-16 px-4 border-b border-[var(--border-default)] flex items-center justify-between">
        <div>
          <span className="text-base font-medium text-[var(--text-primary)]">
            {formatDate(meeting.date)}
          </span>
          {title && (
            <div className="text-xs text-[var(--text-secondary)] mt-1">
              {title}
            </div>
          )}
        </div>
        {menuButton}
      </div>

      {/* Delete confirmation */}
      {deleteBar}

      {/* Tabs — only show if more than one tab available */}
      {tabs.length > 1 && (
        <div className="flex h-10 items-center border-b border-[var(--border-default)]">
          {tabs.map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => { haptics.medium(); setActiveTab(key); }}
              className={`flex items-center gap-1.5 px-4 py-2 text-xs font-medium transition-colors ${
                activeTab === key
                  ? "text-[var(--text-primary)] border-b-2 border-amber-500 -mb-px"
                  : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Tab content */}
      <div ref={editorAreaRef} className="px-4 py-3">
        {activeTab === "notes" && hasNotes && (
          <div className="prose-compact">
            <BridgeTaskEditor
              markdown={meeting.notes!}
              onChange={handleNotesChange}
              readOnly={false}
              vaultPath={vaultPath}
            />
          </div>
        )}

        {activeTab === "summary" && hasSummary && (() => {
          const sections = splitSummarySections(meeting.summary!);
          if (sections) {
            return (
              <div className="space-y-4">
                {sections.privateNotes && (
                  <div className="border-l-2 border-amber-500/40 pl-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Lock className="w-3 h-3 text-amber-500/60" />
                      <span className="text-[10px] font-medium uppercase tracking-wider text-amber-500/60">Private Notes</span>
                    </div>
                    <div className="prose-compact">
                      <BridgeTaskEditor
                        markdown={sections.privateNotes}
                        readOnly={true}
                        vaultPath={vaultPath}
                      />
                    </div>
                  </div>
                )}
                {sections.enhancedNotes && (
                  <div className="border-l-2 border-[var(--border-default)] pl-3">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Sparkles className="w-3 h-3 text-[var(--text-tertiary)]" />
                      <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-tertiary)]">Enhanced Notes</span>
                    </div>
                    <div className="prose-compact">
                      <BridgeTaskEditor
                        markdown={sections.enhancedNotes}
                        readOnly={true}
                        vaultPath={vaultPath}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          }
          return (
            <div className="prose-compact">
              <BridgeTaskEditor
                markdown={meeting.summary!}
                readOnly={true}
                vaultPath={vaultPath}
              />
            </div>
          );
        })()}

        {activeTab === "transcript" && hasTranscript && (
          transcriptLoading ? (
            <div className="flex items-center gap-2 text-xs text-[var(--text-tertiary)] py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading transcript...
            </div>
          ) : transcriptContent ? (
            <TranscriptView content={transcriptContent} />
          ) : (
            <div className="text-xs text-[var(--text-tertiary)] py-2">
              Transcript not available
            </div>
          )
        )}
      </div>
    </div>
  );
}
