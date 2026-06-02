/**
 * Pure device-class -> GraphBudget mapping (no React, no DOM mutation).
 *
 * Detection signals are deliberate (plan "Device-adaptive budgets"):
 *  - NEVER navigator.deviceMemory (undefined in Safari) or GPU-string probes
 *    (identical across iOS models).
 *  - Electron/desktop: window.electronAPI?.isElectron === true.
 *  - Mobile: useIsMobile() ((pointer: coarse), (max-width: 639px)) — a narrow desktop
 *    window safely falls to mobile.
 *  - iPad/tablet: coarse pointer + large viewport.
 *  - DPR: window.devicePixelRatio, clamped per class (iOS guardrail: phone caps at 1.0).
 *
 * Default scope is decided here: GLOBAL on desktop (Decision 2), LOCAL on
 * mobile/tablet (jetsam — never ship the global buffer to a phone).
 */

import type { GraphScope } from "@/lib/graph/types";

export type DeviceClass = "desktop" | "tablet" | "mobile";

export interface GraphBudget {
  deviceClass: DeviceClass;
  /** Device default scope when the URL does not force one. */
  defaultScope: GraphScope;
  /** Clamped devicePixelRatio for the WebGL canvas. */
  pixelRatio: number;
  /** Render-only (mobile/tablet never simulate); desktop is frozen with live opt-in. */
  simulate: boolean;
  /** Aggressive label/visual LOD on small devices. */
  aggressiveLOD: boolean;
  /**
   * Whether the device may request the GLOBAL scope. FALSE on mobile (jetsam
   * guardrail — the global buffer must never ship to a phone). When false the
   * toolbar hides the Global control and any forced "global" scope (URL or click)
   * is coerced back to "local".
   */
  allowGlobal: boolean;
  /** Maximum BFS hops the device permits for a local neighborhood. */
  maxHops: number;
}

/** Inputs gathered in the component (kept impure-free so the mapping is testable). */
export interface DeviceSignals {
  isElectron: boolean;
  isMobile: boolean;
  viewportWidth: number;
  devicePixelRatio: number;
}

export function classifyDevice(signals: DeviceSignals): DeviceClass {
  if (signals.isElectron) return "desktop";
  // A coarse-pointer device with a large viewport is a tablet (iPad); otherwise mobile.
  if (signals.isMobile) {
    return signals.viewportWidth >= 768 ? "tablet" : "mobile";
  }
  return "desktop";
}

export function budgetForDevice(signals: DeviceSignals): GraphBudget {
  const deviceClass = classifyDevice(signals);
  const dpr = signals.devicePixelRatio || 1;
  switch (deviceClass) {
    case "desktop":
      return {
        deviceClass,
        defaultScope: "global",
        pixelRatio: clamp(dpr, 1, 2),
        simulate: false,
        aggressiveLOD: false,
        allowGlobal: true,
        maxHops: 3,
      };
    case "tablet":
      return {
        deviceClass,
        defaultScope: "local",
        pixelRatio: clamp(dpr, 1, 1.5),
        simulate: false,
        aggressiveLOD: true,
        // A tablet (iPad) has the memory headroom to opt into the global graph.
        allowGlobal: true,
        maxHops: 3,
      };
    case "mobile":
    default:
      return {
        deviceClass,
        defaultScope: "local",
        // iOS guardrail: DPR 1.0 caps the framebuffer memory footprint (jetsam).
        pixelRatio: 1,
        simulate: false,
        aggressiveLOD: true,
        // Jetsam guardrail: a phone never ships/holds the whole-vault buffer.
        allowGlobal: false,
        // Phone neighborhoods stay shallow (plan: mobile hops=2) to keep the
        // local payload under the mobile node cap the server enforces.
        maxHops: 2,
      };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
