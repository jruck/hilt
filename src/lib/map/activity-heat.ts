import type { ActivityHeat, ActivityWindow, LocalSession } from "./local-types";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function decay(ageMs: number, halfLifeMs: number): number {
  if (ageMs <= 0) return 1;
  return Math.pow(0.5, ageMs / halfLifeMs);
}

function scoreForWindow(
  lastActivityAt: number | undefined,
  volume: number,
  windowMs: number,
  now: number,
): number {
  if (!lastActivityAt) return 0;
  const ageMs = Math.max(0, now - lastActivityAt);
  if (ageMs > windowMs) return 0;
  return volume * decay(ageMs, windowMs / 2);
}

export function computeActivityHeat(input: {
  lastActivityAt?: number;
  eventCount?: number;
  tokenEstimate?: number;
  isArchived?: boolean;
  now?: number;
}): ActivityHeat {
  const now = input.now ?? Date.now();
  const events = Math.max(0, input.eventCount ?? 1);
  const tokens = Math.max(0, input.tokenEstimate ?? 0);
  const volume = 1 + Math.log1p(events) + Math.log1p(tokens / 1000);
  const archiveMultiplier = input.isArchived ? 0.2 : 1;

  return {
    heat24h: scoreForWindow(input.lastActivityAt, volume, DAY_MS, now) * archiveMultiplier,
    heat7d: scoreForWindow(input.lastActivityAt, volume, 7 * DAY_MS, now) * archiveMultiplier,
    heat30d: scoreForWindow(input.lastActivityAt, volume, 30 * DAY_MS, now) * archiveMultiplier,
    heatAll: input.lastActivityAt ? volume * decay(Math.max(0, now - input.lastActivityAt), 90 * DAY_MS) * archiveMultiplier : 0,
  };
}

export function emptyActivityHeat(): ActivityHeat {
  return { heat24h: 0, heat7d: 0, heat30d: 0, heatAll: 0 };
}

export function addActivityHeat(a: ActivityHeat, b: ActivityHeat): ActivityHeat {
  return {
    heat24h: a.heat24h + b.heat24h,
    heat7d: a.heat7d + b.heat7d,
    heat30d: a.heat30d + b.heat30d,
    heatAll: a.heatAll + b.heatAll,
  };
}

export function heatForWindow(activity: ActivityHeat, window: ActivityWindow): number {
  if (window === "24h") return activity.heat24h;
  if (window === "7d") return activity.heat7d;
  if (window === "30d") return activity.heat30d;
  return activity.heatAll;
}

export function sortSessionsByHeat(sessions: LocalSession[], window: ActivityWindow): LocalSession[] {
  return [...sessions].sort((a, b) => {
    const heatDelta = heatForWindow(b.activity, window) - heatForWindow(a.activity, window);
    if (heatDelta !== 0) return heatDelta;
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0);
  });
}
