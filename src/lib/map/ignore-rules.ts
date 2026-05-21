import type { LocalSession, LocalSessionTrackingState } from "./local-types";

const DAY_MS = 24 * 60 * 60 * 1000;

export function classifyTrackingState(session: Pick<LocalSession,
  "observedState" | "lastActivityAt" | "workspaceRoot" | "cwd" | "eventCount" | "role"
> & {
  hasHumanSignal?: boolean;
  hasReadableTitle?: boolean;
  isWorkerLike?: boolean;
  hasForegroundParent?: boolean;
  automationReason?: string;
}): { trackingState: LocalSessionTrackingState; reasons: string[] } {
  const reasons: string[] = [];
  const now = Date.now();
  const ageMs = session.lastActivityAt ? now - session.lastActivityAt : Number.POSITIVE_INFINITY;

  if (session.observedState === "archived" && ageMs > 14 * DAY_MS) {
    reasons.push("archived older than 14 days");
    return { trackingState: "background", reasons };
  }

  if (ageMs > 90 * DAY_MS) {
    reasons.push("inactive older than 90 days");
    return { trackingState: "background", reasons };
  }

  if (!session.cwd) {
    reasons.push("missing cwd");
    return { trackingState: "background", reasons };
  }

  if (!session.workspaceRoot) {
    reasons.push("no workspace match");
    return { trackingState: "background", reasons };
  }

  if (session.eventCount <= 1 && ageMs > 30 * DAY_MS) {
    reasons.push("single-event old session");
    return { trackingState: "background", reasons };
  }

  if (session.isWorkerLike) {
    reasons.push(session.automationReason ?? "automation-like workspace");
    return { trackingState: "background", reasons };
  }

  if (session.role === "worker" && !session.hasForegroundParent) {
    reasons.push("worker/subtask session");
    return { trackingState: "background", reasons };
  }

  if (!session.hasHumanSignal) {
    reasons.push("no foreground human signal");
    return { trackingState: "background", reasons };
  }

  return { trackingState: "foreground", reasons };
}
