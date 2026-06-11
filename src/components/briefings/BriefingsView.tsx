"use client";

import { useBriefings } from "@/hooks/useBriefings";
import { BriefingHeader } from "./BriefingHeader";
import { BriefingContent } from "./BriefingContent";
import { BriefingFailureCard } from "./BriefingFailureCard";
import { Newspaper } from "lucide-react";
import { LoadingState } from "@/components/ui/LoadingState";
import { BridgeModeToggle, type BridgeMode } from "@/components/bridge/BridgeModeToggle";

interface BriefingsViewProps {
  onBridgeModeChange?: (mode: BridgeMode) => void;
}

export function BriefingsView({ onBridgeModeChange }: BriefingsViewProps) {
  const {
    briefings,
    selectedDate,
    setSelectedDate,
    briefing,
    isLoadingList,
    isLoadingContent,
    retryBriefing,
    retryStatus,
    retryMessage,
  } = useBriefings();
  // Loading state
  if (isLoadingList) {
    return (
      <LoadingState />
    );
  }

  // Empty state — no briefings exist
  if (briefings.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-[var(--text-tertiary)]">
        <Newspaper className="w-8 h-8" />
        <p className="text-sm">No briefings yet</p>
        <p className="text-xs max-w-[240px] text-center">
          Briefings will appear here once your agents start generating them.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Scrollable content */}
      <div data-mobile-scroll-chrome="bottom" className="hilt-mobile-scroll-clearance flex-1 overflow-y-auto [scrollbar-gutter:stable]">
        <div className="max-w-3xl mx-auto px-6 py-8 space-y-8 overflow-x-hidden">
          {/* Header with date selector */}
          {selectedDate && (
            <BriefingHeader
              selectedDate={selectedDate}
              title={briefing?.title || ""}
              availableDates={briefings.map((b) => ({ date: b.date, title: b.title }))}
              onDateChange={setSelectedDate}
              rightSlot={
                onBridgeModeChange ? (
                  <BridgeModeToggle mode="briefing" onModeChange={onBridgeModeChange} />
                ) : undefined
              }
            />
          )}

          {/* Content */}
          <div className="mt-6">
            {isLoadingContent ? (
              <LoadingState className="min-h-40 py-12" />
            ) : briefing?.status === "failed" && briefing.run ? (
              <BriefingFailureCard
                run={briefing.run}
                onRetry={retryBriefing}
                retryStatus={retryStatus}
                retryMessage={retryMessage}
              />
            ) : briefing ? (
              <BriefingContent content={briefing.content} />
            ) : (
              <div className="text-sm text-[var(--text-tertiary)] text-center py-12">
                Select a briefing to view
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
