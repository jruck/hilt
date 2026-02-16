"use client";

import { useBriefings } from "@/hooks/useBriefings";
import { useIsMobile } from "@/hooks/useIsMobile";
import { BriefingHeader } from "./BriefingHeader";
import { BriefingContent } from "./BriefingContent";
import { Loader2, Newspaper } from "lucide-react";

export function BriefingsView() {
  const {
    briefings,
    selectedDate,
    setSelectedDate,
    briefing,
    isLoadingList,
    isLoadingContent,
  } = useBriefings();
  const isMobile = useIsMobile();

  // Loading state
  if (isLoadingList) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
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
      <div className="flex-1 overflow-y-auto">
        <div className={`max-w-2xl mx-auto px-6 py-6 ${isMobile ? "pb-[100px]" : ""}`}>
          {/* Header with date selector */}
          {selectedDate && (
            <BriefingHeader
              selectedDate={selectedDate}
              title={briefing?.title || ""}
              availableDates={briefings.map((b) => ({ date: b.date, title: b.title }))}
              onDateChange={setSelectedDate}
            />
          )}

          {/* Content */}
          <div className="mt-6">
            {isLoadingContent ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="w-5 h-5 animate-spin text-[var(--text-tertiary)]" />
              </div>
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
