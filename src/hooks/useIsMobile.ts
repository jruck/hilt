"use client";

import { useState, useEffect } from "react";

const QUERY = "(pointer: coarse), (max-width: 639px)";

/**
 * Reactive hook for mobile layout detection.
 * A real phone should count because it has a coarse pointer; a narrow desktop
 * or Electron window should also count so responsive layouts are reachable.
 */
export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    setIsMobile(mql.matches);

    function onChange(e: MediaQueryListEvent) {
      setIsMobile(e.matches);
    }

    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}
