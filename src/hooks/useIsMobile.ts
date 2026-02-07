"use client";

import { useState, useEffect } from "react";

const QUERY = "(pointer: coarse)";

/**
 * Reactive hook for touch-device detection via (pointer: coarse).
 * Updates if the user connects/disconnects a pointing device.
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
