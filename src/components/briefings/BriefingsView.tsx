"use client";

import { useBriefings } from "@/hooks/useBriefings";
import { BriefingHeader } from "./BriefingHeader";
import { BriefingContent } from "./BriefingContent";
import { BriefingFailureCard } from "./BriefingFailureCard";
import { useEscalations } from "./EscalationsPanel";
import { Newspaper } from "lucide-react";
import { LoadingState } from "@/components/ui/LoadingState";
import { BridgeModeToggle, type BridgeMode } from "@/components/bridge/BridgeModeToggle";
import { SecondaryInlineContent } from "@/components/layout/SecondaryToolbar";
import { AppHud, AppHudCollapsedBar } from "@/components/AppHud";
import { useIsMobile } from "@/hooks/useIsMobile";
import { CommentBox } from "@/components/comments/CommentBox";
import type { CalendarEventOpenDetail } from "@/lib/calendar/deeplink";

interface BriefingsViewProps {
  onBridgeModeChange?: (mode: BridgeMode) => void;
  hudVisible?: boolean;
  onHudVisibleChange?: (visible: boolean) => void;
  onOpenCalendarEvent?: (detail: CalendarEventOpenDetail) => void;
  onOpenTask?: (taskId: string) => void;
}

/** Whole-briefing feedback — the shared CommentBox (labeled form), routed through postComment
 * to the briefing loop's feedback stream (the gate-B comment primitive; C2 → threads). */
function BriefingFeedbackButton({ date }: { date: string }) {
  return <CommentBox target={{ kind: "briefing", date }} />;
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
