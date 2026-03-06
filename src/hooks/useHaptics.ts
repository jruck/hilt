"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * Centralized haptic feedback hook for Hilt PWA.
 *
 * Wraps web-haptics with an app-specific haptic design language.
 * Uses hidden checkbox trick for iOS Safari support (no Vibration API needed).
 * On desktop, all calls are silent no-ops.
 *
 * Design language:
 *   selection — 8ms whisper: file picks, project cards, folder opens, list item selection
 *   light     — 15ms gentle: search opening, sections expanding, drawers opening
 *   rigid     — 10ms sharp snap: search clear, collapse, escape-close, dismiss
 *   medium    — 25ms moderate: read↔edit toggle, search submit, mode changes
 *   success   — double tap: task completion, save confirmed
 *   nudge     — strong+soft: pull-to-refresh threshold, drag reorder threshold
 *   soft      — 40ms gentle: briefing section expand, large content reveals
 *   error     — triple sharp: failed save, validation error
 *   tap       — 10ms: legacy/generic light tap
 */

type HapticsInstance = {
  trigger: (input?: unknown) => Promise<void>;
  cancel: () => void;
  destroy: () => void;
};

export function useHaptics() {
  const instanceRef = useRef<HapticsInstance | null>(null);
  const supported = useRef<boolean | null>(null);

  useEffect(() => {
    if (typeof document === "undefined") {
      supported.current = false;
      return;
    }

    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    if (!isTouch) {
      supported.current = false;
      return;
    }
    supported.current = true;

    let destroyed = false;
    import("web-haptics").then(({ WebHaptics }) => {
      if (destroyed) return;
      instanceRef.current = new WebHaptics() as unknown as HapticsInstance;
    });

    return () => {
      destroyed = true;
      instanceRef.current?.destroy();
      instanceRef.current = null;
    };
  }, []);

  const trigger = useCallback((input?: unknown) => {
    if (!supported.current || !instanceRef.current) return;
    instanceRef.current.trigger(input).catch(() => {});
  }, []);

  // ── Haptic Design Language ──

  /** Whisper — file select, project card tap, folder open, list navigation */
  const selection = useCallback(() => trigger("selection"), [trigger]);

  /** Gentle reveal — search open, section expand, drawer open */
  const light = useCallback(() => trigger("light"), [trigger]);

  /** Sharp snap — search clear, collapse, escape-close, dismiss */
  const rigid = useCallback(() => trigger("rigid"), [trigger]);

  /** Moderate — read↔edit toggle, search submit, mode change */
  const medium = useCallback(() => trigger("medium"), [trigger]);

  /** Double-tap confirmation — task complete, save confirmed */
  const success = useCallback(() => trigger("success"), [trigger]);

  /** Strong+soft — pull-to-refresh threshold, drag reorder threshold */
  const nudge = useCallback(() => trigger("nudge"), [trigger]);

  /** Gentle long — briefing section expand, large content reveal */
  const soft = useCallback(() => trigger("soft"), [trigger]);

  /** Triple sharp — failed save, validation error */
  const error = useCallback(() => trigger("error"), [trigger]);

  /** Generic light tap (10ms) — legacy/fallback */
  const tap = useCallback(() => trigger(10), [trigger]);

  return { selection, light, rigid, medium, success, nudge, soft, error, tap, trigger };
}
