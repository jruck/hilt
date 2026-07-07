"use client";

import { useState, type FormEvent } from "react";
import { useBriefings } from "@/hooks/useBriefings";
import { BriefingHeader } from "./BriefingHeader";
import { BriefingContent } from "./BriefingContent";
import { BriefingFailureCard } from "./BriefingFailureCard";
import { useEscalations } from "./EscalationsPanel";
import { Check, MessageSquare, Newspaper, Send, X } from "lucide-react";
import { LoadingState } from "@/components/ui/LoadingState";
import { BridgeModeToggle, type BridgeMode } from "@/components/bridge/BridgeModeToggle";
import { SecondaryInlineContent } from "@/components/layout/SecondaryToolbar";
import { AppHud, AppHudCollapsedBar } from "@/components/AppHud";
import { useIsMobile } from "@/hooks/useIsMobile";
import { withBasePath } from "@/lib/base-path";
import type { CalendarEventOpenDetail } from "@/lib/calendar/deeplink";

interface BriefingsViewProps {
  onBridgeModeChange?: (mode: BridgeMode) => void;
  hudVisible?: boolean;
  onHudVisibleChange?: (visible: boolean) => void;
  onOpenCalendarEvent?: (detail: CalendarEventOpenDetail) => void;
  onOpenTask?: (taskId: string) => void;
}

async function postBriefingFeedback(date: string, text: string): Promise<void> {
  const response = await fetch(withBasePath("/api/loops/feedback"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      loop: "briefing",
      target: {
        level: "briefing",
        artifact_date: date,
      },
      text,
    }),
  });
  const payload = await response.json().catch(() => null) as { error?: string } | null;
  if (!response.ok) {
    throw new Error(payload?.error || `Request failed: ${response.status}`);
  }
}

function BriefingFeedbackButton({ date }: { date: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitFeedback(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      await postBriefingFeedback(date, trimmed);
      setText("");
      setOpen(false);
      setSaved(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save feedback");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={`inline-flex min-h-7 items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors ${
            saved
              ? "border-emerald-500/25 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300"
              : "border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          {saved ? <Check className="h-3.5 w-3.5" /> : <MessageSquare className="h-3.5 w-3.5" />}
          Feedback
        </button>
        {error && <p className="text-xs text-red-500">{error}</p>}
      </div>
    );
  }

  return (
    <form onSubmit={submitFeedback} className="flex min-w-0 flex-1 items-center justify-end gap-2">
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        className="min-h-8 min-w-0 flex-1 rounded-md border border-[var(--border-default)] bg-[var(--bg-primary)] px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-2 focus:ring-[var(--accent-primary)] sm:max-w-xs"
        placeholder="Feedback"
        aria-label="Feedback"
      />
      <button
        type="submit"
        disabled={!text.trim() || busy}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md border border-[var(--border-default)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] transition-colors hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-50"
        title="Save feedback"
        aria-label="Save feedback"
      >
        <Send className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="inline-flex min-h-8 min-w-8 items-center justify-center rounded-md text-[var(--text-tertiary)] transition-colors hover:bg-[var(--bg-secondary)] hover:text-[var(--text-primary)]"
        title="Close feedback"
        aria-label="Close feedback"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </form>
  );
}

export function BriefingsView({
  onBridgeModeChange,
  hudVisible,
  onHudVisibleChange,
  onOpenCalendarEvent,
  onOpenTask,
}: BriefingsViewProps) {
  const isMobile = useIsMobile();
  const {
    briefings,
    selectedId,
    setSelectedId,
    briefing,
    isLoadingList,
    isLoadingContent,
    retryBriefing,
    retryStatus,
    retryMessage,
  } = useBriefings();
  // Escalations nest inside their owning briefing sections (Justin, 2026-07-02); loops with no
  // matching section fall back to a fold above the content.
  const { items: escalations, mutate: mutateEscalations } = useEscalations();

  const mobileHud = isMobile && onHudVisibleChange ? (
    hudVisible ? (
      <AppHud
        placement="top"
        variant="mobile"
        onCollapse={() => onHudVisibleChange(false)}
        onOpenCalendarEvent={onOpenCalendarEvent}
        onOpenTask={onOpenTask}
      />
    ) : (
      <AppHudCollapsedBar onExpand={() => onHudVisibleChange(true)} />
    )
  ) : null;

  const headerRightSlot = briefing || onBridgeModeChange ? (
    <div className="flex items-center gap-2">
      {briefing ? <BriefingFeedbackButton date={briefing.date} /> : null}
      {onBridgeModeChange ? (
        <BridgeModeToggle mode="briefing" onModeChange={onBridgeModeChange} />
      ) : null}
    </div>
  ) : undefined;

  // Loading state
  if (isLoadingList) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mobileHud}
        <LoadingState />
      </div>
    );
  }

  // Empty state — no briefings exist
  if (briefings.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {mobileHud}
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
          <Newspaper className="w-8 h-8" />
          <p className="text-sm">No briefings yet</p>
          <p className="text-xs max-w-[240px] text-center">
            Briefings will appear here once your agents start generating them.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {mobileHud}
      {/* Scrollable content */}
      <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        {/* overflow-x must stay visible: verdict controls float off the card's right edge onto
            the canvas (lg+). The floats are hidden below lg, so mobile never overflows. */}
        <div className="max-w-3xl mx-auto px-4 pb-0 pt-8 sm:px-6 sm:pb-8 sm:pt-2">
          {/* Header with date selector */}
          {selectedId && (
            <BriefingHeader
              selectedId={selectedId}
              title={briefing?.title || ""}
              availableBriefings={briefings.map((b) => ({
                id: b.id,
                kind: b.kind,
                date: b.date,
                title: b.title,
                dateRange: b.dateRange,
              }))}
              onBriefingChange={setSelectedId}
              rightSlot={headerRightSlot}
            />
          )}

          {/* Content */}
          <SecondaryInlineContent>
            {isLoadingContent ? (
              <LoadingState className="min-h-40 py-12" />
            ) : briefing ? (
              briefing.status === "failed" && briefing.run ? (
                <BriefingFailureCard
                  run={briefing.run}
                  onRetry={retryBriefing}
                  retryStatus={retryStatus}
                  retryMessage={retryMessage}
                />
              ) : (
                <BriefingContent
                  content={briefing.content}
                  date={briefing.date}
                  absPath={briefing.absPath}
                  escalations={escalations}
                  onEscalationsChanged={mutateEscalations}
                />
              )
            ) : (
              <div className="text-sm text-[var(--text-tertiary)] text-center py-12">
                Select a briefing to view
              </div>
            )}
          </SecondaryInlineContent>
        </div>
      </div>
    </div>
  );
}
