import type { LibraryProcessingStage, LibraryProcessingState } from "./types";

const STATES = new Set(["queued", "active", "ready", "blocked"]);
const STAGES = new Set<LibraryProcessingStage>(["metadata", "capture", "transcribe", "digest", "reweave"]);

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function processingStateOf(value: unknown): LibraryProcessingState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const state = stringValue(input.state);
  const stage = stringValue(input.stage) as LibraryProcessingStage | null;
  const startedAt = stringValue(input.started_at);
  const updatedAt = stringValue(input.updated_at);
  if (!state || !STATES.has(state) || !stage || !STAGES.has(stage) || !startedAt || !updatedAt) return undefined;
  const completedStages = Array.isArray(input.completed_stages)
    ? input.completed_stages.filter((item): item is LibraryProcessingStage => typeof item === "string" && STAGES.has(item as LibraryProcessingStage))
    : [];
  const error = input.last_error && typeof input.last_error === "object"
    ? input.last_error as Record<string, unknown>
    : null;
  const code = stringValue(error?.code);
  const message = stringValue(error?.message);
  return {
    state: state as LibraryProcessingState["state"],
    stage,
    completed_stages: Array.from(new Set(completedStages)),
    started_at: startedAt,
    updated_at: updatedAt,
    attempt: Math.max(0, Number(input.attempt || 0)),
    next_retry_at: stringValue(input.next_retry_at),
    last_error: code && message ? { code, message, retryable: error?.retryable === true } : null,
    completed_at: stringValue(input.completed_at),
  };
}

export function processingIsActive(processing: LibraryProcessingState | null | undefined): boolean {
  return processing?.state === "queued" || processing?.state === "active";
}

export function processingStageLabel(stage: LibraryProcessingStage): string {
  if (stage === "metadata") return "Preparing details";
  if (stage === "capture") return "Capturing source";
  if (stage === "transcribe") return "Transcribing";
  if (stage === "digest") return "Writing digest";
  return "Weaving connections";
}

