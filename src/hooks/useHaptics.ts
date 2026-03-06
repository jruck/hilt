"use client";

import { useCallback, useRef, useEffect } from "react";

/**
 * Centralized haptic feedback hook for Hilt PWA.
 *
 * Wraps web-haptics with app-specific presets and graceful degradation.
 * Only triggers on devices that support the Vibration API (mobile).
 * On desktop, all calls are silent no-ops.
 *
 * Usage:
 *   const haptics = useHaptics();
 *   haptics.tap();        // light confirmation (tab switch, menu open)
 *   haptics.success();    // task completed, save confirmed
 *   haptics.nudge();      // pull-to-refresh trigger, drag threshold
 *   haptics.error();      // validation error, failed save
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
    // Skip on SSR; on client, always initialize —
    // web-haptics uses hidden checkbox toggles for iOS Safari haptics
    // even without the Vibration API
    if (typeof document === "undefined") {
      supported.current = false;
      return;
    }

    // Only enable on touch devices (mobile)
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

  /** Light single tap — tab switch, menu open, selection */
  const tap = useCallback(() => {
    trigger(10);
  }, [trigger]);

  /** Double-tap confirmation — task completed, checkbox toggled */
  const success = useCallback(() => {
    trigger("success");
  }, [trigger]);

  /** Strong tap + soft follow — pull-to-refresh, drag threshold crossed */
  const nudge = useCallback(() => {
    trigger("nudge");
  }, [trigger]);

  /** Three sharp taps — error, failed save */
  const error = useCallback(() => {
    trigger("error");
  }, [trigger]);

  return { tap, success, nudge, error, trigger };
}
