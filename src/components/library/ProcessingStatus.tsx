"use client";

import { AlertTriangle, Check, Clock3, Loader2 } from "lucide-react";
import type { LibraryProcessingStage, LibraryProcessingState } from "@/lib/library/types";
import { processingStageLabel } from "@/lib/library/processing-state";

const STAGE_LABELS: Record<LibraryProcessingStage, string> = {
  metadata: "Metadata",
  capture: "Source",
  transcribe: "Transcript",
  digest: "Digest",
  reweave: "Connections",
};

function stagesFor(processing: LibraryProcessingState): LibraryProcessingStage[] {
  const capture: LibraryProcessingStage = processing.stage === "transcribe" || processing.completed_stages.includes("transcribe")
    ? "transcribe"
    : "capture";
  return ["metadata", capture, "digest", "reweave"];
}

export function ProcessingStatus({
  processing,
  compact = false,
  standalone = false,
}: {
  processing: LibraryProcessingState;
  compact?: boolean;
  standalone?: boolean;
}) {
  const deferredReweave = processing.state === "ready"
    && processing.stage === "reweave"
    && !processing.completed_stages.includes("reweave");
  if (processing.state === "ready") {
    if (!deferredReweave) return null;
    return (
      <div
        className={`${standalone ? "" : "border-t border-[var(--border-default)]"} ${standalone ? "" : compact ? "pt-2" : "pt-3"}`}
        role="status"
        data-processing-state="ready"
        data-processing-stage="reweave"
      >
        <div className="flex min-w-0 items-center gap-2 text-[var(--text-tertiary)]">
          <Clock3 className="h-4 w-4 shrink-0" />
          <span className="min-w-0 truncate text-xs font-medium">Ready · Connections pending</span>
        </div>
      </div>
    );
  }
  const blocked = processing.state === "blocked";
  const stageText = processing.state === "queued"
    ? `Queued · ${processingStageLabel(processing.stage)}`
    : `Processing · ${processingStageLabel(processing.stage)}`;

  return (
    <div
      className={`${standalone ? "" : "border-t border-[var(--border-default)]"} ${standalone ? "" : compact ? "pt-2" : "pt-3"}`}
      role="status"
      aria-live="polite"
      data-processing-state={processing.state}
      data-processing-stage={processing.stage}
    >
      <div className={`flex min-w-0 items-center gap-2 ${blocked ? "text-amber-600 dark:text-amber-300" : "text-[var(--text-secondary)]"}`}>
        {blocked
          ? <AlertTriangle className="h-4 w-4 shrink-0" />
          : <Loader2 className="h-4 w-4 shrink-0 motion-safe:animate-spin motion-reduce:animate-none" />}
        <span className="min-w-0 truncate text-xs font-medium">
          {blocked ? "Needs source" : stageText}
        </span>
      </div>
      {blocked && processing.last_error?.message && (
        <p className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--text-tertiary)]">{processing.last_error.message}</p>
      )}
      {!blocked && !compact && (
        <div className="mt-2 flex min-w-0 items-center gap-2" aria-label="Processing stages">
          {stagesFor(processing).map((stage) => {
            const complete = processing.completed_stages.includes(stage);
            const current = stage === processing.stage;
            return (
              <span
                key={stage}
                title={STAGE_LABELS[stage]}
                className={`inline-flex min-w-0 items-center gap-1 text-[10px] ${complete ? "text-emerald-600 dark:text-emerald-400" : current ? "text-[var(--text-secondary)]" : "text-[var(--text-tertiary)]"}`}
              >
                <span className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${complete ? "border-emerald-500/40 bg-emerald-500/10" : current ? "border-[var(--accent-primary)]" : "border-[var(--border-default)]"}`}>
                  {complete && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="hidden sm:inline">{STAGE_LABELS[stage]}</span>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
