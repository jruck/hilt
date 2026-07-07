"use client";

import { useState, useCallback, useMemo, useRef, useEffect, type ReactNode } from "react";
import {
  AlertTriangle,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  Copy,
  FolderOpen,
  ListTodo,
  Loader2,
  Lock,
  MoreVertical,
  NotebookPen,
  ScrollText,
  Sparkles,
  Trash2,
} from "lucide-react";
import dynamic from "next/dynamic";
import type { PersonCalendarCandidate, PersonMeeting } from "@/lib/types";
import type { Verdict } from "@/lib/loops/types";
import { LoadingState } from "@/components/ui/LoadingState";
import { TranscriptView } from "./TranscriptView";
import { TaskCard } from "@/components/tasks/TaskCard";
import { PROPOSAL_LOOP, formatRelativeDate } from "@/components/tasks/ProposalsSection";
import { useEscalations } from "@/components/briefings/EscalationsPanel";
import { useHaptics } from "@/hooks/useHaptics";
import { useDismissed, useTasksList } from "@/hooks/useTaskFile";
import { useScope } from "@/contexts/ScopeContext";
import { useEventSocketContext } from "@/contexts/EventSocketContext";
import { withBasePath } from "@/lib/base-path";
import { formatHiltMonthDay } from "@/lib/display-date";
import { buildReference } from "@/lib/references/build";
import { copyToClipboard } from "@/lib/references/clipboard";
import {
  askToTaskFile,
  joinMeetingNextSteps,
  meetingVaultRelPath,
  mergeDismissed,
} from "@/lib/tasks/meeting-next-steps";
import { requestTaskOpen } from "@/lib/tasks/deeplink";

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
  onSaved?: () => void;
  onSelectCalendarCandidate?: (candidate: PersonCalendarCandidate) => Promise<void>;
}

function formatDate(isoDate: string, isoTime?: string): string {
  const date = new Date(isoDate + "T00:00:00");
  const datePart = formatHiltMonthDay(date, { includeYear: true });
  if (isoTime) {
    const time = new Date(isoTime);
    const timePart = time.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${datePart} · ${timePart}`;
  }
  return datePart;
}

type Tab = "notes" | "transcript";
type NotesSectionKey = "myNotes" | "aiNotes" | "nextSteps";
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const SAVE_DEBOUNCE_MS = 700;
const LIVE_TRANSCRIPT_REFRESH_MS = 2_000;
const LIVE_TRANSCRIPT_RECENT_MS = 8 * 60 * 60_000;

function SaveIndicator({ state, error }: { state: SaveState; error: string | null }) {
  if (state === "idle") return null;

  const common = "flex items-center gap-1.5 text-[11px]";
  if (state === "dirty") {
    return <span className={`${common} text-[var(--text-tertiary)]`}>Unsaved</span>;
  }
  if (state === "saving") {
    return (
      <span className={`${common} text-[var(--text-tertiary)]`}>
        <Loader2 className="w-3 h-3 animate-spin" />
        Saving...
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className={`${common} text-red-500`} title={error ?? undefined}>
        <AlertTriangle className="w-3 h-3" />
        Save failed
      </span>
    );
  }
  return (
    <span className={`${common} text-[var(--text-tertiary)]`}>
      <CheckCircle2 className="w-3 h-3" />
      Saved
    </span>
  );
}

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

function SummaryContent({ summary, vaultPath }: { summary: string; vaultPath?: string }) {
  const sections = splitSummarySections(summary);
  if (sections) {
    return (
      <div className="space-y-5">
        {sections.privateNotes && (
          <div className="space-y-2">
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
          <div className="space-y-2">
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
        markdown={summary}
        readOnly={true}
        vaultPath={vaultPath}
      />
    </div>
  );
}

function NotesAccordionSection({
  title,
  icon: Icon,
  count,
  open,
  onToggle,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  count?: number;
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  const Chevron = open ? ChevronDown : ChevronRight;

  return (
    <section>
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex h-9 w-full items-center gap-2 border-b border-[var(--border-default)] text-left text-xs font-medium text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)]"
      >
        <Chevron className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <Icon className="w-3.5 h-3.5 text-[var(--text-tertiary)]" />
        <span className="flex-1">
          {title}
          {typeof count === "number" && (
            <span className="ml-1.5 font-normal text-[var(--text-tertiary)]">{count}</span>
          )}
        </span>
      </button>
      {open && (
        <div className="pb-5 pt-3">
          {children}
        </div>
      )}
    </section>
  );
}

function NextCalendarCandidateMenu({
  candidates,
  selectedSeriesKey,
  onSelect,
}: {
  candidates: PersonCalendarCandidate[];
  selectedSeriesKey: string | null;
  onSelect: (candidate: PersonCalendarCandidate) => void;
}) {
  return (
    <div className="border-b border-[var(--border-default)] bg-[var(--bg-secondary)] px-4 py-2">
      <div className="space-y-1">
        {candidates.map((candidate) => {
          const selected = candidate.seriesKey === selectedSeriesKey;
          return (
            <button
              key={candidate.seriesKey}
              type="button"
              onClick={() => onSelect(candidate)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]"
              title={candidate.title}
            >
              <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                {selected ? <Check className="h-3.5 w-3.5 text-amber-500" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-[var(--text-primary)]">{candidate.title}</span>
                <span className="block truncate text-[11px] text-[var(--text-tertiary)]">
                  {formatNextCandidateDate(candidate)} · {candidate.historicalCount} recording{candidate.historicalCount === 1 ? "" : "s"}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatNextCandidateShortDate(candidate: PersonCalendarCandidate): string {
  const date = new Date(candidate.start);
  if (Number.isNaN(date.getTime())) return "Calendar";
  return formatHiltMonthDay(date);
}

function formatNextCandidateDate(candidate: PersonCalendarCandidate): string {
  const date = new Date(candidate.start);
  if (Number.isNaN(date.getTime())) return candidate.start;
  const datePart = formatHiltMonthDay(date);
  const timePart = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
  return `${datePart}, ${timePart}`;
}

function shouldLiveRefreshTranscript(meeting: PersonMeeting): boolean {
  if (meeting.source !== "granola") return false;
  const timestamp = Date.parse(meeting.time || (meeting.date ? `${meeting.date}T00:00:00` : ""));
  return Number.isFinite(timestamp) && Date.now() - timestamp <= LIVE_TRANSCRIPT_RECENT_MS;
}

export function MeetingEntry({ meeting, slug, vaultPath, autoFocus, onDelete, onSaved, onSelectCalendarCandidate }: MeetingEntryProps) {
  const haptics = useHaptics();
  const { navigateTo } = useScope();
  const { connected: eventSocketConnected, on: onSocketEvent } = useEventSocketContext();
  const editorAreaRef = useRef<HTMLDivElement>(null);
  const isNext = meeting.source === "next";
  const selectedCalendarCandidate = meeting.calendarCandidates?.find((candidate) =>
    candidate.seriesKey === meeting.calendarSeriesKey || candidate.eventId === meeting.hiltCalendarEventId
  ) ?? meeting.calendarCandidates?.[0] ?? null;

  // Calendar link evidence — only Granola meetings carry a matched Hilt calendar event.
  const calendarEventId = meeting.hiltCalendarEventId;
  const calendarMatchConfidence = meeting.hiltCalendarMatchConfidence ?? null;
  const isFuzzyCalendarMatch = calendarMatchConfidence != null && calendarMatchConfidence < 0.9;
  const calendarChipTitle = calendarEventId
    ? `Linked to calendar event${meeting.hiltCalendarMatchMethod ? ` · ${meeting.hiltCalendarMatchMethod}` : ""}${calendarMatchConfidence != null ? ` · ${Math.round(calendarMatchConfidence * 100)}%` : ""}`
    : undefined;
  const handleOpenCalendarEvent = useCallback(() => {
    if (!calendarEventId) return;
    haptics.light();
    navigateTo("calendar", `/event/${encodeURIComponent(calendarEventId)}/${meeting.date}`);
  }, [calendarEventId, haptics, meeting.date, navigateTo]);
  const hasNotes = !!meeting.notes;
  const hasSummary = !!meeting.summary;
  const hasNotesTab = hasNotes || hasSummary;
  const hasTranscript = !!meeting.transcriptPath;
  const noteTitle =
    meeting.source === "granola" || (meeting.source === "inline" && meeting.title !== "Notes")
      ? meeting.title
      : undefined;

  // Show menu for inline and next (never granola-only)
  const canDelete = meeting.source === "inline" || meeting.source === "next";
  const canChangeDate = meeting.source === "inline";
  const primaryFilePath = meeting.filePath ?? meeting.transcriptPath ?? null;
  const canCopyPath = Boolean(primaryFilePath);
  const canRevealInFinder = Boolean(primaryFilePath);

  // Three-dot menu state
  const [showMenu, setShowMenu] = useState(false);
  const [showNextCalendarMenu, setShowNextCalendarMenu] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const changeDateRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNotes = useRef(meeting.notes || "");
  const lastSavedNotes = useRef(meeting.notes || "");

  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const clearSaveTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearSaveTimer();
    pendingNotes.current = meeting.notes || "";
    lastSavedNotes.current = meeting.notes || "";
    setSaveState("idle");
    setSaveError(null);
    return clearSaveTimer;
  }, [clearSaveTimer, slug, meeting.date, meeting.source, meeting.time, meeting.title]); // eslint-disable-line react-hooks/exhaustive-deps

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
    setShowNextCalendarMenu(false);
  }, [meeting.date, meeting.source, meeting.time, meeting.title]);

  // Available tabs (not for "next" mode)
  const tabs: { key: Tab; label: string; icon: React.ComponentType<{ className?: string }> }[] = [];
  if (!isNext) {
    if (hasNotesTab) tabs.push({ key: "notes", label: "Notes", icon: NotebookPen });
    if (hasTranscript) tabs.push({ key: "transcript", label: "Transcript", icon: ScrollText });
  }

  // Default to the combined notes view whenever notes or a summary exists.
  const defaultTab: Tab = hasNotesTab ? "notes" : "transcript";
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  // All three note sections open by default — nextSteps included (gate-B: "at the very top …
  // and expanded by default"). Still collapsible; reset per meeting below.
  const [openNoteSections, setOpenNoteSections] = useState<Record<NotesSectionKey, boolean>>({
    myNotes: true,
    aiNotes: true,
    nextSteps: true,
  });

  // ── "Next steps" (v3 unit B2): this meeting's task proposals + accepted tasks (join on
  // origin.meeting == vault-relative meeting path) + escalated-but-unminted ledger asks
  // (pre-Phase-A history; deduped by loop+item_id against both task stores). useTasksList
  // revalidates on the tasks-changed WS event; escalations refresh on their own SWR interval.
  const { tasks: allTasks, proposals: allProposals, mutate: mutateTasks } = useTasksList();
  const { items: escalations, mutate: mutateEscalations } = useEscalations();
  const meetingRel = meetingVaultRelPath(meeting.filePath, vaultPath);
  const nextSteps = useMemo(
    () => joinMeetingNextSteps({
      meetingRelPath: meetingRel,
      tasks: allTasks,
      proposals: allProposals,
      escalations,
    }),
    [meetingRel, allTasks, allProposals, escalations],
  );

  // Dismissed-but-never-gone (gate-B), scoped to THIS meeting: the loop ledger's dismissed
  // records whose `opened_from` IS this meeting's vault-relative path — MERGED with limbo
  // dismissals from the escalations feed (verdict recorded, ledger stamp pending until the
  // loop's next run; deduped by ledger id). Renders as the quiet "Dismissed · N" tail.
  const { dismissed } = useDismissed(PROPOSAL_LOOP);
  const meetingDismissed = useMemo(
    () => mergeDismissed(dismissed, escalations, meetingRel),
    [dismissed, escalations, meetingRel],
  );
  const [dismissedExpanded, setDismissedExpanded] = useState(false);
  const toggleDismissed = useCallback(() => {
    setDismissedExpanded((prev) => {
      const next = !prev;
      next ? haptics.soft() : haptics.rigid();
      return next;
    });
  }, [haptics]);

  // Same POST body as the Priorities Proposals section — the route applies the file effect
  // synchronously; the ledger effect lands at the loop's next run (fine for unminted asks).
  const makeNextStepVerdictHandler = useCallback(
    (loop: string | undefined, itemId: string | undefined) =>
      async (verdict: Verdict, note?: string) => {
        const response = await fetch(withBasePath("/api/loops/verdicts"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ loop, item_id: itemId, verdict, ...(note ? { note } : {}) }),
        });
        if (!response.ok) {
          const payload = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(payload?.error || `Request failed: ${response.status}`);
        }
        mutateTasks();
        mutateEscalations();
      },
    [mutateTasks, mutateEscalations],
  );

  // Reset transcript state when meeting changes
  useEffect(() => {
    transcriptRequestId.current += 1;
    transcriptFetched.current = false;
    setTranscriptContent(null);
    setTranscriptLoading(false);
  }, [meeting.date, meeting.source, meeting.time, meeting.title, meeting.transcriptPath]);

  // Every meeting opens to its best default instead of inheriting the prior tab.
  useEffect(() => {
    setActiveTab(defaultTab);
  }, [defaultTab, meeting.date, meeting.source, meeting.time, meeting.title]);

  useEffect(() => {
    setOpenNoteSections({ myNotes: true, aiNotes: true, nextSteps: true });
    setDismissedExpanded(false);
  }, [meeting.date, meeting.source, meeting.time, meeting.title]);

  const toggleNoteSection = useCallback((section: NotesSectionKey) => {
    haptics.light();
    setOpenNoteSections((current) => ({
      ...current,
      [section]: !current[section],
    }));
  }, [haptics]);

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
  }, [autoFocus, slug, meeting.date, meeting.source, meeting.time, meeting.title]);

  const saveNotesNow = useCallback(
    async (markdown: string) => {
      if (!slug) {
        setSaveState("error");
        setSaveError("Missing person slug. Notes were not saved.");
        return false;
      }

      setSaveState("saving");
      setSaveError(null);

      try {
        const response = await fetch(
          withBasePath(isNext ? `/api/bridge/people/${slug}/next` : `/api/bridge/people/${slug}/notes`),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(
              isNext
                ? {
                  content: markdown,
                  calendarCandidate: selectedCalendarCandidate,
                  keepCalendarOnEmpty: Boolean(selectedCalendarCandidate),
                }
                : { date: meeting.date, notes: markdown, title: noteTitle }
            ),
          }
        );

        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Save failed with HTTP ${response.status}`);
        }

        lastSavedNotes.current = markdown;
        if (pendingNotes.current === markdown) {
          setSaveState("saved");
          setSaveError(null);
        } else {
          setSaveState("dirty");
        }
        onSaved?.();
        return true;
      } catch (err) {
        if (pendingNotes.current === markdown) {
          setSaveState("error");
          setSaveError(err instanceof Error ? err.message : "Save failed");
        } else {
          setSaveState("dirty");
        }
        return false;
      }
    },
    [isNext, meeting.date, noteTitle, onSaved, selectedCalendarCandidate, slug]
  );

  const handleNotesChange = useCallback(
    (markdown: string) => {
      pendingNotes.current = markdown;
      clearSaveTimer();

      if (markdown === lastSavedNotes.current) {
        setSaveState("saved");
        setSaveError(null);
        return;
      }

      setSaveState("dirty");
      setSaveError(null);
      saveTimerRef.current = setTimeout(() => {
        void saveNotesNow(pendingNotes.current);
      }, SAVE_DEBOUNCE_MS);
    },
    [clearSaveTimer, saveNotesNow]
  );

  // Change date for inline notes
  const handleChangeDate = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const newDate = e.target.value;
      if (!newDate || newDate === meeting.date) return;
      setSaveState("saving");
      setSaveError(null);
      fetch(withBasePath(`/api/bridge/people/${slug}/notes`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldDate: meeting.date, newDate, title: noteTitle }),
      }).then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || `Date change failed with HTTP ${response.status}`);
        }
        setSaveState("saved");
        onSaved?.();
        onDelete?.();
      }).catch((err) => {
        setSaveState("error");
        setSaveError(err instanceof Error ? err.message : "Date change failed");
      });
    },
    [slug, meeting.date, noteTitle, onDelete, onSaved]
  );

  // Delete handler
  const handleDelete = useCallback(() => {
    clearSaveTimer();
    setSaveState("saving");
    setSaveError(null);
    const finish = async (response: Response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `Delete failed with HTTP ${response.status}`);
      }
      pendingNotes.current = "";
      lastSavedNotes.current = "";
      setSaveState("saved");
      setSaveError(null);
      onSaved?.();
      onDelete?.();
    };

    if (isNext) {
      fetch(withBasePath(`/api/bridge/people/${slug}/next`), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: "", date: null }),
      }).then(finish).catch((err) => {
        setSaveState("error");
        setSaveError(err instanceof Error ? err.message : "Clear failed");
      });
    } else if (meeting.source === "inline") {
      fetch(withBasePath(`/api/bridge/people/${slug}/notes`), {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ date: meeting.date, title: noteTitle }),
      }).then(finish).catch((err) => {
        setSaveState("error");
        setSaveError(err instanceof Error ? err.message : "Delete failed");
      });
    }
  }, [clearSaveTimer, slug, meeting.source, meeting.date, noteTitle, isNext, onDelete, onSaved]);

  const handleCopyPath = useCallback(() => {
    if (!primaryFilePath) return;
    void copyToClipboard(buildReference({ kind: "meeting", absPath: primaryFilePath, title: noteTitle || undefined }));
    setShowMenu(false);
  }, [primaryFilePath, noteTitle]);

  const handleRevealInFinder = useCallback(() => {
    if (!primaryFilePath) return;
    setShowMenu(false);
    void fetch(withBasePath("/api/reveal"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: primaryFilePath }),
    });
  }, [primaryFilePath]);

  const handleSelectNextCalendarCandidate = useCallback((candidate: PersonCalendarCandidate) => {
    setShowNextCalendarMenu(false);
    void onSelectCalendarCandidate?.(candidate);
  }, [onSelectCalendarCandidate]);

  // Lazy-load transcript content when tab is selected
  const [transcriptContent, setTranscriptContent] = useState<string | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const transcriptFetched = useRef(false);
  const transcriptRequestId = useRef(0);
  const liveRefreshTranscript = shouldLiveRefreshTranscript(meeting);

  const loadTranscript = useCallback(async (showLoading: boolean) => {
    if (!hasTranscript || !meeting.transcriptPath) return;
    const requestId = ++transcriptRequestId.current;
    if (showLoading) setTranscriptLoading(true);
    try {
      const scope = vaultPath || "/";
      const res = await fetch(withBasePath(`/api/docs/file?path=${encodeURIComponent(meeting.transcriptPath)}&scope=${encodeURIComponent(scope)}`), {
        cache: "no-store",
      });
      const data = await res.json().catch(() => null);
      if (requestId !== transcriptRequestId.current) return;
      if (typeof data?.content === "string") setTranscriptContent(data.content);
      else if (data?.content === null) setTranscriptContent(null);
    } catch {
      // Leave the last visible transcript in place during transient refresh failures.
    } finally {
      if (showLoading && requestId === transcriptRequestId.current) setTranscriptLoading(false);
    }
  }, [hasTranscript, meeting.transcriptPath, vaultPath]);

  useEffect(() => {
    if (activeTab === "transcript" && hasTranscript && !transcriptFetched.current) {
      transcriptFetched.current = true;
      void loadTranscript(true);
    }
  }, [activeTab, hasTranscript, loadTranscript]);

  useEffect(() => {
    if (activeTab !== "transcript" || !hasTranscript || !liveRefreshTranscript) return;
    const interval = window.setInterval(() => {
      void loadTranscript(false);
    }, LIVE_TRANSCRIPT_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [activeTab, hasTranscript, liveRefreshTranscript, loadTranscript]);

  useEffect(() => {
    if (!eventSocketConnected) return;
    return onSocketEvent("bridge", "people-changed", () => {
      if (activeTab === "transcript" && hasTranscript) void loadTranscript(false);
    });
  }, [activeTab, eventSocketConnected, hasTranscript, loadTranscript, onSocketEvent]);

  const saveErrorBar = saveState === "error" ? (
    <div className="flex-shrink-0 flex items-center gap-3 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
      <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
      <span className="text-xs text-red-500 flex-1">
        {saveError || "This note was not saved."}
      </span>
      {(isNext || hasNotes) && (
        <button
          onClick={() => saveNotesNow(pendingNotes.current)}
          className="px-2 py-1 text-xs font-medium rounded text-red-500 hover:bg-red-500/10 transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  ) : null;

  const dateTextClassName = `text-base font-medium transition-colors ${
    isFuzzyCalendarMatch
      ? "text-amber-600 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
      : "text-[var(--text-primary)] hover:text-[var(--text-accent)]"
  }`;
  const dateLabel = calendarEventId ? (
    <button
      type="button"
      onClick={handleOpenCalendarEvent}
      title={calendarChipTitle}
      className={`${dateTextClassName} hover:underline underline-offset-2`}
    >
      {formatDate(meeting.date, meeting.time)}
    </button>
  ) : (
    <span className="text-base font-medium text-[var(--text-primary)]">
      {formatDate(meeting.date, meeting.time)}
    </span>
  );
  const nextHeaderLabel = selectedCalendarCandidate
    ? `Next · ${formatNextCandidateShortDate(selectedCalendarCandidate)}`
    : "Next";
  const nextSubtitle = selectedCalendarCandidate?.title ?? null;
  const nextHeaderTitle = selectedCalendarCandidate ? (
    meeting.calendarCandidates && meeting.calendarCandidates.length > 1 ? (
      <button
        type="button"
        onClick={() => setShowNextCalendarMenu((value) => !value)}
        className={`inline-flex min-w-0 items-center gap-1 text-base font-medium transition-colors ${
          showNextCalendarMenu
            ? "text-[var(--text-primary)]"
            : "text-[var(--text-primary)] hover:text-[var(--text-accent)]"
        }`}
        title="Choose calendar series for Next"
      >
        <span className="truncate">{nextHeaderLabel}</span>
        <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-[var(--text-tertiary)]" />
      </button>
    ) : calendarEventId ? (
      <button
        type="button"
        onClick={handleOpenCalendarEvent}
        title={calendarChipTitle ?? "Open calendar event"}
        className="truncate text-base font-medium text-[var(--text-primary)] transition-colors hover:text-[var(--text-accent)] hover:underline underline-offset-2"
      >
        {nextHeaderLabel}
      </button>
    ) : (
      <span className="truncate text-base font-medium text-[var(--text-primary)]">
        {nextHeaderLabel}
      </span>
    )
  ) : (
    <span className="text-base font-medium text-[var(--text-primary)]">Next</span>
  );

  // Menu button
  const menuButton = (canDelete || canChangeDate || canCopyPath || canRevealInFinder) ? (
    <div className="flex-shrink-0 relative" ref={menuRef}>
      <button
        onClick={() => setShowMenu(!showMenu)}
        className="p-1 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors rounded"
        title="More actions"
      >
        <MoreVertical className="w-4 h-4" />
      </button>
      {showMenu && (
        <div className="absolute right-0 top-full mt-1 w-44 z-50 rounded-lg border border-[var(--border-default)] bg-[var(--bg-primary)] shadow-lg overflow-hidden py-1">
          {canCopyPath && (
            <button
              onClick={handleCopyPath}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <Copy className="w-4 h-4 text-[var(--text-tertiary)]" />
              Copy reference
            </button>
          )}
          {canRevealInFinder && (
            <button
              onClick={handleRevealInFinder}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-[var(--text-primary)] hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <FolderOpen className="w-4 h-4 text-[var(--text-tertiary)]" />
              Reveal in Finder
            </button>
          )}
          {(canCopyPath || canRevealInFinder) && (canChangeDate || canDelete) && (
            <div className="my-1 border-t border-[var(--border-default)]" />
          )}
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
        {isNext ? "Clear all Next content?" : "Delete this meeting's notes?"}
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
      <div className="flex min-h-full flex-col bg-[var(--content-surface)]">
        <div className="h-16 px-4 border-b border-[var(--border-default)] flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              {nextHeaderTitle}
              <SaveIndicator state={saveState} error={saveError} />
            </div>
            {nextSubtitle && (
              <div className="mt-1 truncate text-xs text-[var(--text-secondary)]">
                {nextSubtitle}
              </div>
            )}
          </div>
          <div className="ml-3 flex flex-shrink-0 items-center gap-1">
            {menuButton}
          </div>
        </div>
        {showNextCalendarMenu && meeting.calendarCandidates && meeting.calendarCandidates.length > 1 ? (
          <NextCalendarCandidateMenu
            candidates={meeting.calendarCandidates}
            selectedSeriesKey={meeting.calendarSeriesKey ?? selectedCalendarCandidate?.seriesKey ?? null}
            onSelect={handleSelectNextCalendarCandidate}
          />
        ) : null}
        {deleteBar}
        {saveErrorBar}
        <div ref={editorAreaRef} className="min-h-[360px] flex-1 bg-[var(--bg-primary)] px-4 py-3">
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
    <div className="min-h-full bg-[var(--content-surface)]">
      {/* Card header — date is primary, title is subtext */}
      <div className="h-16 px-4 border-b border-[var(--border-default)] flex items-center justify-between">
        <div className="min-w-0">
          {dateLabel}
          {title && (
            <div className="truncate text-xs text-[var(--text-secondary)] mt-1">
              {title}
            </div>
          )}
        </div>
        <div className="ml-3 flex flex-shrink-0 items-center gap-2">
          {hasNotes && <SaveIndicator state={saveState} error={saveError} />}
          {menuButton}
        </div>
      </div>

      {/* Delete confirmation */}
      {deleteBar}
      {saveErrorBar}

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
        {activeTab === "notes" && hasNotesTab && (
          <div>
            {/* Next steps — FIRST, above both note sections (gate-B: "at the very top … and
                expanded by default"). Renders when this meeting produced something OR has
                dismissed history to reveal (no fully-empty shell). */}
            {meetingRel && (nextSteps.total > 0 || meetingDismissed.length > 0) && (
              <NotesAccordionSection
                title="Next steps"
                icon={ListTodo}
                count={nextSteps.total > 0 ? nextSteps.total : undefined}
                open={openNoteSections.nextSteps}
                onToggle={() => toggleNoteSection("nextSteps")}
              >
                {nextSteps.total > 0 && (
                  <div className="space-y-1">
                    {nextSteps.proposals.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        hideMeeting
                        // Only loop-minted proposals carry the verdict join (origin.loop +
                        // item_id); anything else renders read-only (same guard as A6).
                        onVerdict={task.origin?.loop && task.origin?.item_id
                          ? makeNextStepVerdictHandler(task.origin.loop, task.origin.item_id)
                          : undefined}
                        onOpen={() => requestTaskOpen(task.id)}
                      />
                    ))}
                    {nextSteps.unmintedAsks.map((item) => (
                      <TaskCard
                        key={`${item.loop}:${item.id}`}
                        task={askToTaskFile(item, meetingRel)}
                        hideMeeting
                        verdict={item.verdict}
                        // Escalated-undecided asks are decidable here too; decided ones show
                        // their verdict badge read-only.
                        onVerdict={item.verdict ? undefined : makeNextStepVerdictHandler(item.loop, item.id)}
                      />
                    ))}
                    {nextSteps.tasks.map((task) => (
                      <TaskCard key={task.id} task={task} hideMeeting showStatus onOpen={() => requestTaskOpen(task.id)} />
                    ))}
                  </div>
                )}
                {/* Dismissed asks FROM THIS MEETING — the Proposals section's quiet
                    reveal-tail idiom, classes copied exactly. Stands alone when everything
                    from the meeting was decided + dismissed. */}
                {meetingDismissed.length > 0 && (
                  <div className={nextSteps.total > 0 ? "mt-3" : ""}>
                    <div className="flex items-center gap-3">
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                      <button
                        onClick={toggleDismissed}
                        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] hover:bg-[var(--bg-secondary)] transition-colors"
                        title={dismissedExpanded ? "Hide dismissed items" : "View dismissed items"}
                      >
                        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${dismissedExpanded ? "rotate-90" : ""}`} />
                        Dismissed · {meetingDismissed.length}
                      </button>
                      <div className="h-px flex-1 bg-[var(--border-default)]" />
                    </div>
                    {dismissedExpanded && (
                      <div className="mt-3 space-y-0.5">
                        {meetingDismissed.map((item) => (
                          <div key={item.id} className="flex items-baseline gap-2 px-3 py-1">
                            <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-tertiary)]" title={item.action}>
                              {item.action}
                            </span>
                            <span className="flex-shrink-0 text-xs text-[var(--text-quaternary)]">
                              {item.dismissed_at ? formatRelativeDate(item.dismissed_at) : "just now"}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </NotesAccordionSection>
            )}

            {hasNotes && (
              <NotesAccordionSection
                title="My Notes"
                icon={NotebookPen}
                open={openNoteSections.myNotes}
                onToggle={() => toggleNoteSection("myNotes")}
              >
                <div className="prose-compact">
                  <BridgeTaskEditor
                    markdown={meeting.notes!}
                    onChange={handleNotesChange}
                    readOnly={false}
                    vaultPath={vaultPath}
                  />
                </div>
              </NotesAccordionSection>
            )}

            {hasSummary && (
              <NotesAccordionSection
                title="AI Notes"
                icon={Sparkles}
                open={openNoteSections.aiNotes}
                onToggle={() => toggleNoteSection("aiNotes")}
              >
                <SummaryContent
                  summary={meeting.summary!}
                  vaultPath={vaultPath}
                />
              </NotesAccordionSection>
            )}
          </div>
        )}

        {activeTab === "transcript" && hasTranscript && (
          transcriptLoading ? (
            <LoadingState label="Loading transcript" size="sm" className="min-h-16 py-2 text-xs" />
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
